# ============================================================================
# TESTS — Unit tests for the Planning Engine (no DB required)
# ============================================================================
#
# Run:  python -m pytest planning_engine/tests.py -v
# ============================================================================

import math
from datetime import date

from .config import PlanningConfig
from .models import PlanningContext, EngineRunSummary, BOLineRaw
from .alerts import AlertEvaluator
from .forecast import ForecastGenerator
from .validators import BOLineValidator


# ═══════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════

def _make_line(
    mu: float = 1000,
    bo_qty: float = 12000,
    item_code: str = "ITEM-A",
    item_id: str = "uuid-item-a",
    delivered: float = 0.0,
) -> BOLineRaw:
    """Build a BOLineRaw for testing."""
    return BOLineRaw(
        order_id="order-001",
        order_number="BO-2026-001",
        customer_name="Acme Corp",
        line_id="line-001",
        item_id=item_id,
        item_code=item_code,
        item_name="Test Item A",
        bo_quantity=bo_qty,
        monthly_usage=mu,
        released_quantity=0,
        delivered_quantity=delivered,
    )


def _make_context(
    mu: float = 1000,
    bo_qty: float = 12000,
    us_stock: float = 3000,
    total_delivered: float = 6000,
    order_multiple: int = None,
    min_stock_override: float = None,
    max_stock_override: float = None,
) -> PlanningContext:
    """Build a PlanningContext with standard MU-derived values."""
    annual = mu * 12
    min_s = min_stock_override if min_stock_override is not None else mu * 4
    max_s = max_stock_override if max_stock_override is not None else mu * 6
    remaining_annual = max(0.0, annual - total_delivered)
    remaining_bo = max(0.0, bo_qty - total_delivered)
    coverage = (us_stock / mu) if mu > 0 else float("inf")

    return PlanningContext(
        order_id="order-001",
        order_number="BO-2026-001",
        customer_name="Acme Corp",
        line_id="line-001",
        item_id="uuid-item-a",
        item_code="ITEM-A",
        item_name="Test Item A",
        bo_quantity=bo_qty,
        monthly_usage=mu,
        annual_qty=annual,
        min_stock=min_s,
        max_stock=max_s,
        us_warehouse_stock=us_stock,
        total_delivered=total_delivered,
        remaining_annual=remaining_annual,
        remaining_bo=remaining_bo,
        months_coverage=coverage,
        order_multiple=order_multiple,
    )


# ═══════════════════════════════════════════════════════════════════
# TEST: DERIVED VALUES
# ═══════════════════════════════════════════════════════════════════

def test_derived_values():
    ctx = _make_context(mu=1000)
    assert ctx.annual_qty == 12000
    assert ctx.min_stock == 4000
    assert ctx.max_stock == 6000


def test_months_coverage():
    ctx = _make_context(mu=1000, us_stock=3000)
    assert ctx.months_coverage == 3.0


def test_months_coverage_mu_zero():
    ctx = _make_context(mu=0, us_stock=5000)
    assert ctx.months_coverage == float("inf")


# ═══════════════════════════════════════════════════════════════════
# TEST: PRODUCTION ALLOWED (Core Formula)
# ═══════════════════════════════════════════════════════════════════

def test_production_allowed_normal():
    """MIN(remaining=6000, gap=3000) = 3000"""
    ctx = _make_context(mu=1000, us_stock=3000, total_delivered=6000)
    assert ctx.production_allowed == 3000.0


def test_production_allowed_commitment_cap():
    """remaining=1000 < gap=3000 → 1000"""
    ctx = _make_context(mu=1000, us_stock=3000, total_delivered=11000)
    assert ctx.remaining_annual == 1000.0
    assert ctx.production_allowed == 1000.0


def test_production_allowed_zero_when_overstocked():
    ctx = _make_context(mu=1000, us_stock=7000, total_delivered=6000)
    assert ctx.production_allowed == 0.0


def test_production_allowed_zero_when_delivered_exceeds_annual():
    ctx = _make_context(mu=1000, us_stock=1000, total_delivered=13000)
    assert ctx.remaining_annual == 0.0
    assert ctx.production_allowed == 0.0


def test_production_allowed_with_order_multiple():
    """When order_multiple=500, raw=1200 → rounds up to 1500, capped by remaining."""
    ctx = _make_context(
        mu=1000, us_stock=4800, total_delivered=6000,
        order_multiple=500,
    )
    # gap = 6000 - 4800 = 1200
    # remaining = 6000
    # raw = min(6000, 1200) = 1200
    # rounded = ceil(1200/500)*500 = 1500
    # capped = min(1500, 6000) = 1500
    assert ctx.production_allowed == 1500.0


def test_production_allowed_order_multiple_capped_by_remaining():
    """Rounding should not exceed remaining_annual."""
    ctx = _make_context(
        mu=1000, us_stock=4800, total_delivered=11000,
        order_multiple=500,
    )
    # remaining = 1000
    # gap = 1200
    # raw = min(1000, 1200) = 1000
    # rounded = ceil(1000/500)*500 = 1000 (exact multiple)
    assert ctx.production_allowed == 1000.0


# ═══════════════════════════════════════════════════════════════════
# TEST: FULFILLMENT PERCENTAGES
# ═══════════════════════════════════════════════════════════════════

def test_bo_fulfillment_pct():
    ctx = _make_context(bo_qty=10000, total_delivered=7500)
    assert ctx.bo_fulfillment_pct == 75.0


def test_annual_fulfillment_pct():
    ctx = _make_context(mu=1000, total_delivered=6000)
    assert ctx.annual_fulfillment_pct == 50.0


def test_effective_available():
    ctx = _make_context(us_stock=5000)
    ctx.pending_release_qty = 1200.0
    assert ctx.effective_available == 3800.0


# ═══════════════════════════════════════════════════════════════════
# TEST: ALERT CONDITIONS (Boolean Flags)
# ═══════════════════════════════════════════════════════════════════

def test_is_bo_consumed():
    ctx = _make_context(bo_qty=10000, total_delivered=10000)
    assert ctx.is_bo_consumed is True


def test_is_bo_not_consumed():
    ctx = _make_context(bo_qty=10000, total_delivered=5000)
    assert ctx.is_bo_consumed is False


def test_is_low_stock():
    ctx = _make_context(mu=1000, us_stock=3500, total_delivered=6000)
    assert ctx.min_stock == 4000
    assert ctx.is_low_stock is True


def test_is_not_low_stock_when_above_min():
    ctx = _make_context(mu=1000, us_stock=5000, total_delivered=6000)
    assert ctx.is_low_stock is False


def test_is_max_stock():
    ctx = _make_context(mu=1000, us_stock=6500)
    assert ctx.max_stock == 6000
    assert ctx.is_max_stock is True


def test_is_commitment_near_exhausted():
    ctx = _make_context(mu=1000, us_stock=5000, total_delivered=9000)
    assert ctx.remaining_annual == 3000.0
    assert ctx.min_stock == 4000
    assert ctx.is_commitment_near_exhausted is True


# ═══════════════════════════════════════════════════════════════════
# TEST: ALERT EVALUATOR
# ═══════════════════════════════════════════════════════════════════

def test_alert_low_stock_fires():
    ctx = _make_context(mu=1000, us_stock=3000, total_delivered=6000)
    evaluator = AlertEvaluator()
    summary = EngineRunSummary(run_date=date.today())
    alerts = evaluator.evaluate(ctx, ["user-1"], summary)

    low_alerts = [a for a in alerts if a.type == "low_stock"]
    assert len(low_alerts) == 1
    assert low_alerts[0].priority == "HIGH"
    assert "commitment-capped" in low_alerts[0].message.lower()


def test_alert_bo_consumed_fires():
    ctx = _make_context(bo_qty=10000, total_delivered=10000)
    evaluator = AlertEvaluator()
    summary = EngineRunSummary(run_date=date.today())
    alerts = evaluator.evaluate(ctx, ["user-1"], summary)

    critical = [a for a in alerts if a.type == "bo_consumed"]
    assert len(critical) == 1
    assert critical[0].priority == "CRITICAL"


def test_alert_mu_zero_skips():
    ctx = _make_context(mu=0, us_stock=0, total_delivered=0)
    evaluator = AlertEvaluator()
    summary = EngineRunSummary(run_date=date.today())
    alerts = evaluator.evaluate(ctx, ["user-1"], summary)
    assert len(alerts) == 0
    assert summary.skipped_mu_zero == 1


def test_alert_fan_out_multiple_users():
    ctx = _make_context(mu=1000, us_stock=2000, total_delivered=6000)
    evaluator = AlertEvaluator()
    summary = EngineRunSummary(run_date=date.today())
    alerts = evaluator.evaluate(ctx, ["user-1", "user-2", "user-3"], summary)

    low_alerts = [a for a in alerts if a.type == "low_stock"]
    assert len(low_alerts) == 3
    assert {a.user_id for a in low_alerts} == {"user-1", "user-2", "user-3"}


def test_alert_dedup_key():
    """Dedup key should combine type + reference_id."""
    from .models import AlertRecord
    alert = AlertRecord(
        user_id="u1", title="t", message="m",
        type="low_stock", module="planning",
        reference_id="line-001", priority="HIGH",
    )
    assert alert.dedup_key == "low_stock:line-001"


# ═══════════════════════════════════════════════════════════════════
# TEST: FORECAST GENERATOR
# ═══════════════════════════════════════════════════════════════════

def test_forecast_generates_12_months():
    ctx = _make_context(mu=1000, total_delivered=0)
    gen = ForecastGenerator(PlanningConfig())
    summary = EngineRunSummary(run_date=date.today())
    forecasts = gen.generate(ctx, date(2026, 3, 1), summary)
    assert len(forecasts) == 12


def test_forecast_commitment_capped():
    """remaining_annual=3000, MU=1000 → only 3 months non-zero."""
    ctx = _make_context(mu=1000, total_delivered=9000)
    assert ctx.remaining_annual == 3000.0

    gen = ForecastGenerator(PlanningConfig())
    summary = EngineRunSummary(run_date=date.today())
    forecasts = gen.generate(ctx, date(2026, 3, 1), summary)

    non_zero = [f for f in forecasts if f.forecasted_quantity > 0]
    assert len(non_zero) == 3
    assert sum(f.forecasted_quantity for f in non_zero) == 3000.0



def test_forecast_mu_zero_returns_empty():
    ctx = _make_context(mu=0)
    gen = ForecastGenerator(PlanningConfig())
    summary = EngineRunSummary(run_date=date.today())
    forecasts = gen.generate(ctx, date(2026, 3, 1), summary)
    assert len(forecasts) == 0


def test_forecast_total_never_exceeds_remaining():
    ctx = _make_context(mu=2000, total_delivered=10000)
    gen = ForecastGenerator(PlanningConfig())
    summary = EngineRunSummary(run_date=date.today())
    forecasts = gen.generate(ctx, date(2026, 3, 1), summary)

    total_forecast = sum(f.forecasted_quantity for f in forecasts)
    assert total_forecast <= ctx.remaining_annual


def test_forecast_dates_are_sequential():
    ctx = _make_context(mu=1000)
    gen = ForecastGenerator(PlanningConfig())
    summary = EngineRunSummary(run_date=date.today())
    forecasts = gen.generate(ctx, date(2026, 3, 1), summary)

    dates = [f.forecast_date for f in forecasts]
    assert dates[0] == "2026-04-01"
    assert dates[1] == "2026-05-01"
    assert dates[11] == "2027-03-01"


def test_forecast_confidence_bands():
    ctx = _make_context(mu=1000, total_delivered=0)
    gen = ForecastGenerator(PlanningConfig())
    summary = EngineRunSummary(run_date=date.today())
    forecasts = gen.generate(ctx, date(2026, 3, 1), summary)

    f = forecasts[0]
    assert abs(f.lower_bound - 850.0) < 0.01
    assert abs(f.upper_bound - 1150.0) < 0.01


# ═══════════════════════════════════════════════════════════════════
# TEST: VALIDATORS
# ═══════════════════════════════════════════════════════════════════

def test_validator_valid_line():
    """A normal line should pass validation."""
    v = BOLineValidator()
    line = _make_line(mu=1000, bo_qty=12000)
    errors = v.validate(line)
    assert v.is_processable(errors)


def test_validator_missing_item_code():
    """Missing item_code should fail."""
    v = BOLineValidator()
    line = _make_line(item_code="")
    errors = v.validate(line)
    assert not v.is_processable(errors)
    assert any(e.field == "item_code" for e in errors)


def test_validator_negative_mu():
    """Negative MU should fail."""
    v = BOLineValidator()
    line = _make_line(mu=-100)
    errors = v.validate(line)
    assert not v.is_processable(errors)


def test_validator_zero_bo_qty():
    """Zero BO qty should fail."""
    v = BOLineValidator()
    line = _make_line(bo_qty=0)
    errors = v.validate(line)
    assert not v.is_processable(errors)


def test_validator_overdelivery_is_warning():
    """Overdelivery should be a WARNING, not an ERROR (still processable)."""
    v = BOLineValidator()
    line = _make_line(bo_qty=10000, delivered=12000)
    errors = v.validate(line)
    warnings = [e for e in errors if e.severity == "WARNING"]
    assert len(warnings) >= 1
    assert v.is_processable(errors)  # warnings don't block


# ═══════════════════════════════════════════════════════════════════
# TEST: EDGE CASES
# ═══════════════════════════════════════════════════════════════════

def test_edge_overdelivery():
    ctx = _make_context(bo_qty=10000, total_delivered=12000)
    assert ctx.remaining_bo == 0.0
    assert ctx.is_bo_consumed is True


def test_edge_no_releases():
    ctx = _make_context(mu=1000, total_delivered=0)
    assert ctx.remaining_annual == 12000.0
    assert ctx.production_allowed == min(12000.0, max(0, 6000.0 - ctx.us_warehouse_stock))


def test_edge_zero_stock():
    ctx = _make_context(mu=1000, us_stock=0, total_delivered=0)
    assert ctx.is_low_stock is True
    assert ctx.production_allowed == min(12000.0, 6000.0)  # 6000


def test_edge_db_min_max_override():
    """If DB stores min/max, those should be used instead of MU-derived."""
    ctx = _make_context(
        mu=1000, us_stock=2500, total_delivered=6000,
        min_stock_override=3000, max_stock_override=8000,
    )
    assert ctx.min_stock == 3000
    assert ctx.max_stock == 8000
    assert ctx.is_low_stock is True  # 2500 <= 3000
    # production = min(6000, max(0, 8000-2500)) = min(6000, 5500) = 5500
    assert ctx.production_allowed == 5500.0
