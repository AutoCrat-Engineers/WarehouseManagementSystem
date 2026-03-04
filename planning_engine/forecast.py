# ============================================================================
# FORECAST — Commitment-capped 12-month rolling forecast generator
# ============================================================================

import logging
from datetime import date
from typing import Optional

from .config import PlanningConfig
from .models import PlanningContext, ForecastRecord, EngineRunSummary

logger = logging.getLogger("planning_engine")


class ForecastGenerator:
    """
    Generates a 12-month rolling demand forecast for each BO line,
    constrained by the remaining annual commitment.

    Forecast Rule:
        For each future month:
            forecast_qty = MIN(MU, remaining_commitment_left)
            remaining_commitment_left -= forecast_qty

    This ensures the total forecasted demand never exceeds the
    contractual obligation.
    """

    def __init__(self, config: PlanningConfig):
        self._cfg = config

    def generate(
        self,
        ctx: PlanningContext,
        run_date: date,
        summary: EngineRunSummary,
    ) -> list[ForecastRecord]:
        """
        Generate commitment-capped monthly forecasts.

        Returns list of ForecastRecords to upsert into demand_forecasts.
        """
        # Guard: no forecast if MU = 0
        if ctx.monthly_usage <= 0:
            return []

        remaining = ctx.remaining_annual
        forecasts: list[ForecastRecord] = []

        for month_offset in range(1, self._cfg.forecast_months + 1):
            forecast_date = self._compute_forecast_date(run_date, month_offset)

            # Commitment-capped: never forecast more than what remains
            forecast_qty = min(ctx.monthly_usage, remaining)
            forecast_qty = max(0.0, forecast_qty)

            # Decrement remaining for next month
            remaining = max(0.0, remaining - forecast_qty)

            forecasts.append(ForecastRecord(
                item_code=ctx.item_code,
                forecast_date=forecast_date.isoformat(),
                forecast_period="MONTHLY",
                forecasted_quantity=forecast_qty,
                lower_bound=forecast_qty * self._cfg.forecast_lower_pct,
                upper_bound=forecast_qty * self._cfg.forecast_upper_pct,
                model_type="MU_COMMITMENT_CONSTRAINED",
            ))

        summary.forecasts_generated += len(forecasts)

        logger.debug(
            f"  Forecast for {ctx.item_code}: "
            f"{len(forecasts)} months, "
            f"total={sum(f.forecasted_quantity for f in forecasts):,.0f} "
            f"(annual_remaining was {ctx.remaining_annual:,.0f})"
        )

        return forecasts

    @staticmethod
    def _compute_forecast_date(base_date: date, month_offset: int) -> date:
        """
        Compute the 1st day of the month that is `month_offset` months
        ahead of `base_date`.
        """
        raw_month = base_date.month + month_offset
        year = base_date.year + (raw_month - 1) // 12
        month = (raw_month - 1) % 12 + 1
        return date(year, month, 1)
