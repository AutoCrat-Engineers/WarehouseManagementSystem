# ============================================================================
# DEMO — Generate comprehensive analytics JSON for the frontend dashboard
# ============================================================================

import json
import math
import sys
from pathlib import Path
from datetime import date

from .config import PlanningConfig, setup_logging
from .models import PlanningContext, EngineRunSummary
from .mock_data import (
    MockPlanningQueries, MOCK_BO_LINES,
    MOCK_WAREHOUSE_STOCK, MOCK_RELEASE_SCHEDULE, MOCK_MONTHLY_ACTIVITY,
)
from .alerts import AlertEvaluator
from .forecast import ForecastGenerator
from .validators import BOLineValidator


def run_demo() -> dict:
    """Run planning engine with mock data → comprehensive analytics JSON."""
    logger = setup_logging("INFO")
    cfg = PlanningConfig(dry_run=True)
    run_date = date.today()

    queries = MockPlanningQueries()
    alert_eval = AlertEvaluator()
    forecast_gen = ForecastGenerator(cfg)
    validator = BOLineValidator(run_date)
    summary = EngineRunSummary(run_date=run_date)

    bo_lines = queries.fetch_active_bo_lines()
    us_wh_id = queries.resolve_warehouse_id(cfg.us_warehouse_code)
    target_users = queries.fetch_target_user_ids(cfg.notification_target_roles)
    summary.total_bo_lines = len(bo_lines)

    items_data = []
    all_alerts = []
    all_forecasts = []

    for line in bo_lines:
        errors = validator.validate(line)
        if errors and not validator.is_processable(errors):
            summary.skipped_validation += 1
            continue

        mu = line.monthly_usage
        bo_qty = line.bo_quantity
        annual_qty = mu * cfg.mu_to_annual_factor

        # Use DB-stored min/max (from blanket_order_items) or derive from MU
        min_stock = float(line.db_min_stock) if line.db_min_stock else mu * cfg.mu_to_min_factor
        max_stock = float(line.db_max_stock) if line.db_max_stock else mu * cfg.mu_to_max_factor
        safety_stock = float(line.db_safety_stock) if line.db_safety_stock else mu * 2

        # Warehouse stock
        wh_stock_list = MOCK_WAREHOUSE_STOCK.get(line.item_code, [])
        total_on_hand = sum(w["on_hand"] for w in wh_stock_list)
        total_allocated = sum(w["allocated"] for w in wh_stock_list)
        total_reserved = sum(w["reserved"] for w in wh_stock_list)
        total_in_transit = sum(w["in_transit"] for w in wh_stock_list)
        total_available = sum(w["available"] for w in wh_stock_list)

        # Delivery tracking
        total_delivered = queries.fetch_total_delivered(
            line.order_id, line.item_id, cfg.delivered_statuses
        )

        # Releases
        releases = MOCK_RELEASE_SCHEDULE.get(line.item_code, [])
        pending_releases = [r for r in releases if r["status"] in ("PENDING", "CONFIRMED")]
        pending_qty = sum(r["outstanding_qty"] for r in pending_releases)
        reserved_for_releases = sum(r["qty_reserved_from_stock"] for r in pending_releases)

        # Core calculations
        remaining_annual = max(0.0, annual_qty - total_delivered)
        remaining_bo = max(0.0, bo_qty - total_delivered)
        months_coverage = round(total_on_hand / mu, 1) if mu > 0 else None

        # Production allowed (with order multiple rounding)
        capacity_gap = max(0.0, max_stock - total_on_hand)
        production_raw = min(remaining_annual, capacity_gap)
        if line.order_multiple and line.order_multiple > 0 and production_raw > 0:
            production_allowed = min(
                math.ceil(production_raw / line.order_multiple) * line.order_multiple,
                remaining_annual,
            )
        else:
            production_allowed = production_raw

        # Stock status
        if bo_qty > 0 and total_delivered >= bo_qty:
            stock_status = "BO_CONSUMED"
        elif total_on_hand <= min_stock and remaining_annual > 0:
            stock_status = "LOW_STOCK"
        elif 0 < remaining_annual <= min_stock and total_on_hand > min_stock:
            stock_status = "COMMITMENT_LOW"
        elif total_on_hand >= max_stock:
            stock_status = "MAX_STOCK"
        else:
            stock_status = "HEALTHY"

        bo_pct = min(100.0, total_delivered / bo_qty * 100) if bo_qty > 0 else 0
        annual_pct = min(100.0, total_delivered / annual_qty * 100) if annual_qty > 0 else 0

        # Months remaining in BO
        try:
            end_dt = date.fromisoformat(line.order_end_date) if line.order_end_date else None
            months_remaining_in_bo = max(0, (end_dt.year - run_date.year) * 12 + end_dt.month - run_date.month) if end_dt else 0
        except Exception:
            months_remaining_in_bo = 0

        # Required monthly rate
        required_monthly_rate = round(remaining_annual / max(1, months_remaining_in_bo)) if months_remaining_in_bo > 0 else 0

        # Monthly activity
        activity = MOCK_MONTHLY_ACTIVITY.get(line.item_code, [])

        # Build item result
        item_result = {
            "item_code": line.item_code,
            "item_name": line.item_name,
            "order_number": line.order_number,
            "customer_name": line.customer_name,
            "uom": "PCS",
            "lead_time_days": 14,

            # Planning parameters
            "monthly_usage": mu,
            "bo_quantity": bo_qty,
            "annual_qty": annual_qty,
            "min_stock": min_stock,
            "max_stock": max_stock,
            "safety_stock": safety_stock,
            "order_multiple": line.order_multiple,
            "packing_multiple": line.packing_multiple,

            # Multi-warehouse stock position
            "total_on_hand": total_on_hand,
            "total_allocated": total_allocated,
            "total_reserved": total_reserved,
            "total_in_transit": total_in_transit,
            "total_available": total_available,
            "warehouse_stock": wh_stock_list,

            # Delivery / commitment tracking
            "total_delivered": total_delivered,
            "remaining_annual": remaining_annual,
            "remaining_bo": remaining_bo,
            "months_coverage": months_coverage,
            "production_allowed": production_allowed,

            # Release tracking
            "pending_release_qty": pending_qty,
            "reserved_for_releases": reserved_for_releases,
            "effective_available": max(0, total_available - reserved_for_releases),
            "releases": releases,

            # Status & fulfillment
            "stock_status": stock_status,
            "bo_fulfillment_pct": round(bo_pct, 1),
            "annual_fulfillment_pct": round(annual_pct, 1),

            # Commitment tracker
            "months_remaining_in_bo": months_remaining_in_bo,
            "required_monthly_rate": required_monthly_rate,
            "bo_start_date": line.order_start_date,
            "bo_end_date": line.order_end_date,

            # Monthly activity (for trend chart)
            "monthly_activity": activity,
        }
        items_data.append(item_result)

        # Build context for alert evaluation
        ctx = PlanningContext(
            order_id=line.order_id, order_number=line.order_number,
            customer_name=line.customer_name, line_id=line.line_id,
            item_id=line.item_id, item_code=line.item_code,
            item_name=line.item_name, bo_quantity=bo_qty,
            monthly_usage=mu, annual_qty=annual_qty,
            min_stock=min_stock, max_stock=max_stock,
            us_warehouse_stock=total_on_hand, total_delivered=total_delivered,
            remaining_annual=remaining_annual, remaining_bo=remaining_bo,
            months_coverage=months_coverage if months_coverage else float("inf"),
            pending_release_qty=pending_qty, order_multiple=line.order_multiple,
        )

        alerts = alert_eval.evaluate(ctx, target_users, summary)
        for a in alerts:
            all_alerts.append({
                "title": a.title, "message": a.message, "type": a.type,
                "priority": a.priority, "item_code": line.item_code,
                "item_name": line.item_name, "reference_id": a.reference_id,
            })

        forecasts = forecast_gen.generate(ctx, run_date, summary)
        for f in forecasts:
            all_forecasts.append({
                "item_code": f.item_code, "forecast_date": f.forecast_date,
                "forecasted_quantity": f.forecasted_quantity,
                "lower_bound": round(f.lower_bound, 0),
                "upper_bound": round(f.upper_bound, 0),
            })

        summary.processed += 1

    summary.alerts_generated = len(all_alerts)

    return {
        "run_date": run_date.isoformat(),
        "engine_version": "2.0.0",
        "mode": "MOCK_DATA",
        "summary": {
            "total_bo_lines": summary.total_bo_lines,
            "processed": summary.processed,
            "skipped_mu_zero": summary.skipped_mu_zero,
            "skipped_validation": summary.skipped_validation,
            "alerts_generated": summary.alerts_generated,
            "forecasts_generated": summary.forecasts_generated,
            "alerts_by_type": summary.alerts_by_type,
        },
        "items": items_data,
        "alerts": all_alerts,
        "forecasts": all_forecasts,
    }


def main():
    result = run_demo()
    project_root = Path(__file__).parent.parent
    output_path = project_root / "public" / "planning_demo.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"✅ Generated {output_path}")
    print(f"   Items: {len(result['items'])}")
    print(f"   Alerts: {len(result['alerts'])}")
    print(f"   Forecasts: {len(result['forecasts'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
