# ============================================================================
# ALERTS — Alert evaluation logic for all 5 conditions
# ============================================================================

import logging
from typing import Optional

from .models import PlanningContext, AlertRecord, EngineRunSummary

logger = logging.getLogger("planning_engine")


class AlertEvaluator:
    """
    Evaluates alert conditions against a PlanningContext.

    Alert priority order:
        1. BO Fully Consumed    → CRITICAL
        2. Low Stock            → HIGH
        3. Commitment Exhausted → HIGH
        4. Max Stock Reached    → LOW
        5. Healthy              → (no alert)
    """

    def evaluate(
        self,
        ctx: PlanningContext,
        target_user_ids: list[str],
        summary: EngineRunSummary,
    ) -> list[AlertRecord]:
        """
        Evaluate all alert conditions for a single BO line context.
        Returns a list of AlertRecords to be inserted.
        """
        alerts: list[AlertRecord] = []

        # Guard: MU = 0 → skip alerts (no demand defined)
        if ctx.monthly_usage <= 0:
            logger.warning(
                f"MU=0 for item={ctx.item_code} line={ctx.line_id}. "
                f"Skipping alert evaluation."
            )
            summary.skipped_mu_zero += 1
            return alerts

        # ── RULE 1: BLANKET ORDER FULLY CONSUMED ──
        if ctx.is_bo_consumed:
            alert = self._build_bo_consumed_alert(ctx)
            alerts.extend(self._fan_out(alert, target_user_ids))
            summary.alerts_by_type["bo_consumed"] += len(target_user_ids)
            logger.info(
                f"  ✘ BO CONSUMED — {ctx.item_code} "
                f"(delivered={ctx.total_delivered:,.0f} / BO={ctx.bo_quantity:,.0f})"
            )

        # ── RULE 2: LOW STOCK (commitment-constrained) ──
        if ctx.is_low_stock:
            alert = self._build_low_stock_alert(ctx)
            alerts.extend(self._fan_out(alert, target_user_ids))
            summary.alerts_by_type["low_stock"] += len(target_user_ids)
            logger.info(
                f"  ⚠ LOW STOCK — {ctx.item_code} "
                f"(stock={ctx.us_warehouse_stock:,.0f} ≤ min={ctx.min_stock:,.0f}, "
                f"production_allowed={ctx.production_allowed:,.0f})"
            )

        # ── RULE 3: ANNUAL COMMITMENT NEARLY EXHAUSTED ──
        elif ctx.is_commitment_near_exhausted:
            alert = self._build_commitment_warning_alert(ctx)
            alerts.extend(self._fan_out(alert, target_user_ids))
            summary.alerts_by_type["commitment_warning"] += len(target_user_ids)
            logger.info(
                f"  ⚠ COMMITMENT LOW — {ctx.item_code} "
                f"(remaining={ctx.remaining_annual:,.0f})"
            )

        # ── RULE 4: MAX STOCK / OVERSTOCK ──
        if ctx.is_max_stock:
            alert = self._build_max_stock_alert(ctx)
            alerts.extend(self._fan_out(alert, target_user_ids))
            summary.alerts_by_type["max_stock"] += len(target_user_ids)
            logger.info(
                f"  ✔ MAX STOCK — {ctx.item_code} "
                f"(stock={ctx.us_warehouse_stock:,.0f} ≥ max={ctx.max_stock:,.0f})"
            )

        return alerts

    # ─────────────────────────────────────────────────────────────
    # ALERT BUILDERS
    # ─────────────────────────────────────────────────────────────

    def _build_bo_consumed_alert(self, ctx: PlanningContext) -> AlertRecord:
        return AlertRecord(
            user_id="",  # will be set by fan_out
            title=f"Blanket Order Fully Consumed — {ctx.item_code}",
            message=(
                f"BO {ctx.order_number} for {ctx.customer_name} is fully consumed. "
                f"Total delivered: {ctx.total_delivered:,.0f} / "
                f"BO Qty: {ctx.bo_quantity:,.0f}. "
                f"Action required: Request new Blanket Order from customer."
            ),
            type="bo_consumed",
            module="planning",
            reference_id=ctx.line_id,
            priority="CRITICAL",
        )

    def _build_low_stock_alert(self, ctx: PlanningContext) -> AlertRecord:
        coverage_str = (
            f"{ctx.months_coverage:.1f} months"
            if ctx.months_coverage != float("inf")
            else "N/A (MU=0)"
        )
        return AlertRecord(
            user_id="",
            title=f"⚠ LOW STOCK — {ctx.item_code}",
            message=(
                f"US warehouse stock ({ctx.us_warehouse_stock:,.0f}) "
                f"≤ Min Stock ({ctx.min_stock:,.0f}). "
                f"Current stock can serve {coverage_str} "
                f"(MU={ctx.monthly_usage:,.0f}/month). "
                f"Annual commitment remaining: {ctx.remaining_annual:,.0f}. "
                f"Max production allowed (commitment-capped): "
                f"{ctx.production_allowed:,.0f}. "
                f"DO NOT produce beyond this quantity — "
                f"annual obligation governs replenishment."
            ),
            type="low_stock",
            module="planning",
            reference_id=ctx.line_id,
            priority="HIGH",
        )

    def _build_commitment_warning_alert(self, ctx: PlanningContext) -> AlertRecord:
        return AlertRecord(
            user_id="",
            title=f"Annual Commitment Nearly Exhausted — {ctx.item_code}",
            message=(
                f"Only {ctx.remaining_annual:,.0f} units remaining in annual commitment "
                f"(Annual Qty={ctx.annual_qty:,.0f}, "
                f"Delivered={ctx.total_delivered:,.0f}). "
                f"Max additional production: {ctx.production_allowed:,.0f}. "
                f"Do NOT plan standard min-max replenishment — "
                f"commitment cap overrides stock policy."
            ),
            type="commitment_warning",
            module="planning",
            reference_id=ctx.line_id,
            priority="HIGH",
        )

    def _build_max_stock_alert(self, ctx: PlanningContext) -> AlertRecord:
        coverage_str = (
            f"{ctx.months_coverage:.1f} months"
            if ctx.months_coverage != float("inf")
            else "N/A"
        )
        return AlertRecord(
            user_id="",
            title=f"Stock Sufficient — {ctx.item_code}",
            message=(
                f"US warehouse stock ({ctx.us_warehouse_stock:,.0f}) "
                f"≥ Max Stock ({ctx.max_stock:,.0f}). "
                f"Can serve {coverage_str}. "
                f"No production needed. Plan shipment timing accordingly."
            ),
            type="max_stock",
            module="planning",
            reference_id=ctx.line_id,
            priority="LOW",
        )

    # ─────────────────────────────────────────────────────────────
    # FAN-OUT: Duplicate alert for each target user
    # ─────────────────────────────────────────────────────────────

    @staticmethod
    def _fan_out(
        template: AlertRecord, user_ids: list[str]
    ) -> list[AlertRecord]:
        """Create one AlertRecord per target user."""
        records = []
        for uid in user_ids:
            records.append(AlertRecord(
                user_id=uid,
                title=template.title,
                message=template.message,
                type=template.type,
                module=template.module,
                reference_id=template.reference_id,
                priority=template.priority,
            ))
        return records
