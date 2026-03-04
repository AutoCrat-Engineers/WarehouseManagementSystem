# ============================================================================
# CONFIG — Environment & Constants
# ============================================================================

import os
import logging
from dataclasses import dataclass, field
from typing import Optional


def setup_logging(level: str = "INFO") -> logging.Logger:
    """Configure structured logging for the planning engine."""
    logger = logging.getLogger("planning_engine")
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    return logger


@dataclass(frozen=True)
class SupabaseConfig:
    """Supabase connection configuration."""
    url: str
    service_role_key: str

    @classmethod
    def from_env(cls) -> "SupabaseConfig":
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url or not key:
            raise EnvironmentError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
                "Create a .env file or export them as environment variables."
            )
        return cls(url=url, service_role_key=key)


@dataclass(frozen=True)
class PlanningConfig:
    """
    Planning engine parameters.

    Business rules:
        annual_qty  = MU × mu_to_annual_factor   (default: 12)
        min_stock   = MU × mu_to_min_factor      (default: 4)
        max_stock   = MU × mu_to_max_factor      (default: 6)
        forecast    = 12-month rolling horizon
    """
    # MU multipliers (from business requirements)
    mu_to_annual_factor: int = 12
    mu_to_min_factor: int = 4
    mu_to_max_factor: int = 6

    # Forecast horizon
    forecast_months: int = 12

    # Forecast confidence band (±15% by default)
    forecast_lower_pct: float = 0.85
    forecast_upper_pct: float = 1.15

    # US Warehouse code in inv_warehouses table
    us_warehouse_code: str = "WH-US-TRANSIT"

    # Notification batch size
    notification_batch_size: int = 100

    # Target roles for production team notifications
    notification_target_roles: list[str] = field(
        default_factory=lambda: ["L2", "L3"]
    )

    # Blanket release statuses that count as "delivered"
    delivered_statuses: list[str] = field(
        default_factory=lambda: ["DELIVERED", "IN_TRANSIT", "CONFIRMED"]
    )

    # Dry run mode — if True, don't insert anything, just log
    dry_run: bool = False
