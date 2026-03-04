# ============================================================================
# MODELS — Domain data classes (schema-aligned)
# ============================================================================

from dataclasses import dataclass, field
from datetime import date
from typing import Optional


@dataclass
class BOLineRaw:
    """
    Raw blanket order line data as fetched from DB.

    Column mapping:
        blanket_orders.id           → order_id
        blanket_orders.order_number → order_number
        blanket_orders.customer_name→ customer_name
        blanket_order_lines.id      → line_id
        blanket_order_lines.item_id → item_id  (UUID FK to items)
        items.item_code             → item_code (resolved via join)
        items.item_name             → item_name
        blanket_order_lines.total_quantity → bo_quantity
        blanket_order_lines.monthly_usage → monthly_usage
    """
    order_id: str
    order_number: str
    customer_name: str
    line_id: str
    item_id: str                    # UUID FK → items.id
    item_code: str                  # Resolved string FK → inv_warehouse_stock
    item_name: str
    bo_quantity: float              # blanket_order_lines.total_quantity
    monthly_usage: float            # blanket_order_lines.monthly_usage
    released_quantity: float = 0.0
    delivered_quantity: float = 0.0
    db_min_stock: Optional[float] = None
    db_max_stock: Optional[float] = None
    db_safety_stock: Optional[float] = None
    order_multiple: Optional[int] = None
    packing_multiple: Optional[int] = None
    order_start_date: Optional[str] = None
    order_end_date: Optional[str] = None


@dataclass
class PlanningContext:
    """
    Fully computed planning context for a single BO line.
    All derived values are calculated at runtime — nothing is persisted.

    Core identifiers:
        item_id   — UUID, used for blanket_releases queries
        item_code — string, used for inv_warehouse_stock queries
    """
    # ── Source identifiers ──
    order_id: str
    order_number: str
    customer_name: str
    line_id: str
    item_id: str
    item_code: str
    item_name: str

    # ── From BO line ──
    bo_quantity: float
    monthly_usage: float

    # ── Dynamically derived (MU-based) ──
    annual_qty: float           # MU × 12
    min_stock: float            # MU × 4  (or DB override)
    max_stock: float            # MU × 6  (or DB override)

    # ── Fetched from live data ──
    us_warehouse_stock: float   # inv_warehouse_stock.quantity_on_hand
    total_delivered: float      # SUM(blanket_releases.delivered_quantity)

    # ── Computed ──
    remaining_annual: float     # MAX(0, annual_qty - total_delivered)
    remaining_bo: float         # MAX(0, bo_quantity - total_delivered)
    months_coverage: float      # us_warehouse_stock / MU  (inf if MU=0)

    # ── Optional: pending releases ──
    pending_release_qty: float = 0.0    # SUM of PENDING/CONFIRMED releases
    order_multiple: Optional[int] = None
    packing_multiple: Optional[int] = None

    @property
    def production_allowed(self) -> float:
        """
        Core replenishment formula:
            MIN(remaining_annual, MAX(0, max_stock - us_stock))

        Caps production at the lesser of:
        1. What the annual commitment still requires
        2. How much capacity gap exists to reach max stock
        """
        if self.remaining_annual <= 0:
            return 0.0
        capacity_gap = max(0.0, self.max_stock - self.us_warehouse_stock)
        raw = min(self.remaining_annual, capacity_gap)

        # Apply order multiple rounding if configured
        if self.order_multiple and self.order_multiple > 0 and raw > 0:
            import math
            rounded = math.ceil(raw / self.order_multiple) * self.order_multiple
            # Don't exceed remaining commitment after rounding
            return min(rounded, self.remaining_annual)

        return raw

    @property
    def effective_available(self) -> float:
        """Stock available after subtracting pending release reservations."""
        return max(0.0, self.us_warehouse_stock - self.pending_release_qty)

    @property
    def is_bo_consumed(self) -> bool:
        return self.bo_quantity > 0 and self.total_delivered >= self.bo_quantity

    @property
    def is_low_stock(self) -> bool:
        return self.us_warehouse_stock <= self.min_stock and self.remaining_annual > 0

    @property
    def is_commitment_near_exhausted(self) -> bool:
        return (
            0 < self.remaining_annual <= self.min_stock
            and self.us_warehouse_stock > self.min_stock
        )

    @property
    def is_max_stock(self) -> bool:
        return self.us_warehouse_stock >= self.max_stock

    @property
    def bo_fulfillment_pct(self) -> float:
        """BO completion percentage."""
        if self.bo_quantity <= 0:
            return 0.0
        return min(100.0, (self.total_delivered / self.bo_quantity) * 100)

    @property
    def annual_fulfillment_pct(self) -> float:
        """Annual commitment completion percentage."""
        if self.annual_qty <= 0:
            return 0.0
        return min(100.0, (self.total_delivered / self.annual_qty) * 100)


@dataclass
class AlertRecord:
    """
    Alert to be inserted into the `notifications` table.

    Schema mapping:
        user_id      → notifications.user_id
        title        → notifications.title
        message      → notifications.message
        type         → notifications.type
        module       → notifications.module ('planning')
        reference_id → notifications.reference_id (line_id for navigation)
    """
    user_id: str
    title: str
    message: str
    type: str               # 'low_stock', 'max_stock', 'bo_consumed', 'commitment_warning'
    module: str             # 'planning'
    reference_id: str       # blanket_order_line ID
    priority: str           # 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'

    @property
    def dedup_key(self) -> str:
        """Key for deduplication: same alert type + reference = same alert."""
        return f"{self.type}:{self.reference_id}"

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "title": self.title,
            "message": self.message,
            "type": self.type,
            "module": self.module,
            "reference_id": self.reference_id,
            "is_read": False,
        }


@dataclass
class ForecastRecord:
    """
    Forecast row to upsert into `demand_forecasts`.

    Schema mapping:
        item_code           → demand_forecasts.item_code (via items FK)
        forecast_date       → demand_forecasts.forecast_date
        forecast_period     → demand_forecasts.forecast_period
        forecasted_quantity → demand_forecasts.forecasted_quantity
        model_type          → demand_forecasts.model_type
        lower/upper_bound   → demand_forecasts.lower_bound / upper_bound
    """
    item_code: str
    forecast_date: str
    forecast_period: str
    forecasted_quantity: float
    lower_bound: float
    upper_bound: float
    model_type: str

    def to_dict(self) -> dict:
        return {
            "item_code": self.item_code,
            "forecast_date": self.forecast_date,
            "forecast_period": self.forecast_period,
            "forecasted_quantity": round(self.forecasted_quantity, 2),
            "lower_bound": round(self.lower_bound, 2),
            "upper_bound": round(self.upper_bound, 2),
            "model_type": self.model_type,
        }


@dataclass
class EngineRunSummary:
    """Execution summary for logging, monitoring and audit."""
    run_date: date
    total_bo_lines: int = 0
    processed: int = 0
    skipped_mu_zero: int = 0
    skipped_duplicate: int = 0
    skipped_validation: int = 0
    errors: int = 0
    alerts_generated: int = 0
    alerts_deduplicated: int = 0
    forecasts_generated: int = 0
    items_processed: list = field(default_factory=list)
    alerts_by_type: dict = field(default_factory=lambda: {
        "bo_consumed": 0,
        "low_stock": 0,
        "commitment_warning": 0,
        "max_stock": 0,
    })

    def log_summary(self, logger) -> None:
        logger.info("═" * 60)
        logger.info("EXECUTION SUMMARY")
        logger.info("═" * 60)
        logger.info(f"  Run Date:             {self.run_date}")
        logger.info(f"  Total BO Lines:       {self.total_bo_lines}")
        logger.info(f"  Processed:            {self.processed}")
        logger.info(f"  Skipped (MU=0):       {self.skipped_mu_zero}")
        logger.info(f"  Skipped (duplicate):  {self.skipped_duplicate}")
        logger.info(f"  Skipped (validation): {self.skipped_validation}")
        logger.info(f"  Errors:               {self.errors}")
        logger.info(f"  Alerts Generated:     {self.alerts_generated}")
        logger.info(f"  Alerts Deduplicated:  {self.alerts_deduplicated}")
        logger.info(f"  Forecasts Generated:  {self.forecasts_generated}")
        logger.info(f"  Alert Breakdown:")
        for k, v in self.alerts_by_type.items():
            logger.info(f"    {k:25s}: {v}")
        logger.info("═" * 60)
