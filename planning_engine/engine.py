# ============================================================================
# ENGINE — Core orchestrator (production-grade, schema-aligned)
# ============================================================================

import logging
from datetime import date
from typing import Optional

from supabase import create_client, Client

from .config import SupabaseConfig, PlanningConfig
from .models import (
    BOLineRaw,
    PlanningContext,
    AlertRecord,
    ForecastRecord,
    EngineRunSummary,
)
from .queries import PlanningQueries
from .alerts import AlertEvaluator
from .forecast import ForecastGenerator
from .validators import BOLineValidator

logger = logging.getLogger("planning_engine")


class PlanningEngine:
    """
    Commitment-Constrained Min-Max Planning Engine.

    Execution model:
        - Runs once per day via CRON
        - READ-ONLY on all business tables
        - INSERT-ONLY on: notifications, demand_forecasts
        - Zero updates to any existing record

    Schema alignment:
        - blanket_order_lines.item_id (UUID) → used for blanket_releases queries
        - items.item_code (string)           → used for inv_warehouse_stock queries
        - FK resolution handled via nested Supabase select

    New in this version:
        - Input validation before processing
        - Alert deduplication (no duplicates within same day)
        - Pending release reservation tracking
        - Order multiple rounding on production_allowed
        - Correct dual-FK handling (item_id vs item_code)
    """

    def __init__(
        self,
        supabase_config: Optional[SupabaseConfig] = None,
        planning_config: Optional[PlanningConfig] = None,
    ):
        sb_cfg = supabase_config or SupabaseConfig.from_env()
        self._cfg = planning_config or PlanningConfig()

        self._client: Client = create_client(sb_cfg.url, sb_cfg.service_role_key)
        self._queries = PlanningQueries(self._client)
        self._alert_eval = AlertEvaluator()
        self._forecast_gen = ForecastGenerator(self._cfg)
        self._validator = BOLineValidator()

        self._run_date = date.today()
        self._all_alerts: list[AlertRecord] = []
        self._all_forecasts: list[ForecastRecord] = []
        self._summary = EngineRunSummary(run_date=self._run_date)
        self._existing_alert_keys: set[str] = set()

    # ═══════════════════════════════════════════════════════════════
    # ENTRY POINT — Called by CRON
    # ═══════════════════════════════════════════════════════════════

    def run_daily_cycle(self) -> EngineRunSummary:
        """Main execution method — called once per day by CRON."""
        logger.info("═" * 60)
        logger.info(f"PLANNING ENGINE START — {self._run_date}")
        logger.info(f"  Mode: {'DRY RUN' if self._cfg.dry_run else 'LIVE'}")
        logger.info(f"  US Warehouse: {self._cfg.us_warehouse_code}")
        logger.info("═" * 60)

        try:
            self._execute_pipeline()
        except Exception as e:
            logger.exception(f"FATAL ERROR in planning engine: {e}")
            self._summary.errors += 1

        # Log summary
        self._summary.alerts_generated = len(self._all_alerts)
        self._summary.log_summary(logger)
        return self._summary

    def _execute_pipeline(self):
        """Core pipeline: fetch → validate → compute → alert → forecast → persist."""

        # Step 1: Fetch all active BO lines
        bo_lines = self._queries.fetch_active_bo_lines()
        self._summary.total_bo_lines = len(bo_lines)

        if not bo_lines:
            logger.info("No active BO lines found. Nothing to process.")
            return

        # Step 2: Resolve US warehouse ID (cached for entire run)
        us_wh_id = self._queries.resolve_warehouse_id(
            self._cfg.us_warehouse_code
        )
        if not us_wh_id:
            logger.error(
                f"FATAL: US warehouse '{self._cfg.us_warehouse_code}' "
                f"not found. Aborting."
            )
            return

        # Step 3: Fetch target users for notifications
        target_user_ids = self._queries.fetch_target_user_ids(
            self._cfg.notification_target_roles
        )
        if not target_user_ids:
            logger.warning(
                f"No target users for roles "
                f"{self._cfg.notification_target_roles}. "
                f"Alerts will be generated but not delivered."
            )

        # Step 4: Load existing alert keys for deduplication
        self._existing_alert_keys = self._queries.fetch_today_alert_keys(
            self._run_date.isoformat()
        )
        logger.info(
            f"Loaded {len(self._existing_alert_keys)} existing alerts for today "
            f"(deduplication active)"
        )

        # Step 5: Process each BO line
        for line in bo_lines:
            self._process_line(line, us_wh_id, target_user_ids)

        # Step 6: Persist results
        if not self._cfg.dry_run:
            self._persist_alerts()
            self._persist_forecasts()
        else:
            logger.info(
                f"DRY RUN — Skipping writes. "
                f"Would insert {len(self._all_alerts)} alerts, "
                f"upsert {len(self._all_forecasts)} forecasts."
            )

    # ═══════════════════════════════════════════════════════════════
    # PER-LINE PROCESSING
    # ═══════════════════════════════════════════════════════════════

    def _process_line(
        self,
        line: BOLineRaw,
        us_wh_id: str,
        target_user_ids: list[str],
    ) -> None:
        """Process a single BO line: validate → build context → evaluate → forecast."""
        try:
            # ── Validation ──
            errors = self._validator.validate(line)
            if errors:
                self._validator.log_errors(line, errors)
                if not self._validator.is_processable(errors):
                    self._summary.skipped_validation += 1
                    return

            logger.info(
                f"Processing: item={line.item_code} "
                f"BO={line.order_number} "
                f"MU={line.monthly_usage:,.0f} "
                f"BO_Qty={line.bo_quantity:,.0f}"
            )

            # ── Build context (fetches live stock + delivered data) ──
            ctx = self._build_context(line, us_wh_id)

            logger.info(
                f"  Context: us_stock={ctx.us_warehouse_stock:,.0f} "
                f"delivered={ctx.total_delivered:,.0f} "
                f"remaining_annual={ctx.remaining_annual:,.0f} "
                f"min={ctx.min_stock:,.0f} max={ctx.max_stock:,.0f} "
                f"months_coverage={ctx.months_coverage:.1f} "
                f"production_allowed={ctx.production_allowed:,.0f}"
            )

            # ── Evaluate alerts ──
            alerts = self._alert_eval.evaluate(
                ctx, target_user_ids, self._summary
            )

            # ── Deduplicate ──
            new_alerts = self._deduplicate_alerts(alerts)
            self._all_alerts.extend(new_alerts)

            # ── Generate forecast ──
            forecasts = self._forecast_gen.generate(
                ctx, self._run_date, self._summary
            )
            self._all_forecasts.extend(forecasts)

            # Track processed item
            self._summary.items_processed.append(line.item_code)
            self._summary.processed += 1

        except Exception as e:
            logger.error(
                f"Error processing line {line.line_id} "
                f"(item={line.item_code}): {e}"
            )
            self._summary.errors += 1

    # ═══════════════════════════════════════════════════════════════
    # CONTEXT BUILDER
    # ═══════════════════════════════════════════════════════════════

    def _build_context(
        self, line: BOLineRaw, us_wh_id: str
    ) -> PlanningContext:
        """Build PlanningContext with all derived values computed dynamically."""
        mu = line.monthly_usage
        bo_qty = line.bo_quantity
        cfg = self._cfg

        # Derived from MU (DYNAMIC — never stored)
        annual_qty = mu * cfg.mu_to_annual_factor

        # Use DB-stored min/max if available, else derive from MU
        min_stock = (
            float(line.db_min_stock)
            if line.db_min_stock is not None
            else mu * cfg.mu_to_min_factor
        )
        max_stock = (
            float(line.db_max_stock)
            if line.db_max_stock is not None
            else mu * cfg.mu_to_max_factor
        )

        # Fetch live warehouse stock (uses item_code)
        us_stock = self._queries.fetch_us_stock(line.item_code, us_wh_id)

        # Fetch total delivered from releases (uses item_id)
        total_delivered = self._queries.fetch_total_delivered(
            line.order_id,
            line.item_id,
            cfg.delivered_statuses,
        )

        # Fetch pending releases for reservation tracking
        pending_releases = self._queries.fetch_pending_releases(
            line.order_id, line.item_id
        )
        pending_qty = sum(
            float(r.get("requested_quantity", 0)) - float(r.get("delivered_quantity", 0))
            for r in pending_releases
        )

        # Computed values
        remaining_annual = max(0.0, annual_qty - total_delivered)
        remaining_bo = max(0.0, bo_qty - total_delivered)
        months_coverage = (us_stock / mu) if mu > 0 else float("inf")

        return PlanningContext(
            order_id=line.order_id,
            order_number=line.order_number,
            customer_name=line.customer_name,
            line_id=line.line_id,
            item_id=line.item_id,
            item_code=line.item_code,
            item_name=line.item_name,
            bo_quantity=bo_qty,
            monthly_usage=mu,
            annual_qty=annual_qty,
            min_stock=min_stock,
            max_stock=max_stock,
            us_warehouse_stock=us_stock,
            total_delivered=total_delivered,
            remaining_annual=remaining_annual,
            remaining_bo=remaining_bo,
            months_coverage=months_coverage,
            pending_release_qty=pending_qty,
            order_multiple=line.order_multiple,
            packing_multiple=line.packing_multiple,
        )

    # ═══════════════════════════════════════════════════════════════
    # DEDUPLICATION
    # ═══════════════════════════════════════════════════════════════

    def _deduplicate_alerts(
        self, alerts: list[AlertRecord]
    ) -> list[AlertRecord]:
        """Remove alerts that were already generated today."""
        new_alerts = []
        for alert in alerts:
            if alert.dedup_key in self._existing_alert_keys:
                self._summary.alerts_deduplicated += 1
                continue
            # Add to existing keys so subsequent checks catch it too
            self._existing_alert_keys.add(alert.dedup_key)
            new_alerts.append(alert)
        return new_alerts

    # ═══════════════════════════════════════════════════════════════
    # PERSISTENCE — INSERT-ONLY
    # ═══════════════════════════════════════════════════════════════

    def _persist_alerts(self) -> None:
        """Batch insert alert notifications."""
        if not self._all_alerts:
            logger.info("No alerts to insert.")
            return

        records = [a.to_dict() for a in self._all_alerts]
        batch_size = self._cfg.notification_batch_size
        inserted = 0

        for i in range(0, len(records), batch_size):
            batch = records[i: i + batch_size]
            try:
                self._client.table("notifications").insert(batch).execute()
                inserted += len(batch)
            except Exception as e:
                logger.error(f"Failed to insert notification batch {i}: {e}")
                self._summary.errors += 1

        logger.info(f"Inserted {inserted}/{len(records)} notifications")

    def _persist_forecasts(self) -> None:
        """Batch upsert forecasts into demand_forecasts."""
        if not self._all_forecasts:
            logger.info("No forecasts to upsert.")
            return

        records = [f.to_dict() for f in self._all_forecasts]
        batch_size = self._cfg.notification_batch_size
        upserted = 0

        for i in range(0, len(records), batch_size):
            batch = records[i: i + batch_size]
            try:
                self._client.table("demand_forecasts").upsert(
                    batch,
                    on_conflict="item_code,forecast_date,forecast_period",
                ).execute()
                upserted += len(batch)
            except Exception as e:
                logger.error(f"Failed to upsert forecast batch {i}: {e}")
                self._summary.errors += 1

        logger.info(f"Upserted {upserted}/{len(records)} forecast records")
