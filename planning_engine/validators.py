# ============================================================================
# VALIDATORS — Data quality checks before processing
# ============================================================================
#
# Validates each BO line before the engine processes it.
# Returns validation errors that can be logged/skipped gracefully.
# ============================================================================

import logging
from datetime import date, datetime
from typing import Optional

from .models import BOLineRaw

logger = logging.getLogger("planning_engine")


class ValidationError:
    """A single validation issue."""
    def __init__(self, field: str, message: str, severity: str = "ERROR"):
        self.field = field
        self.message = message
        self.severity = severity  # ERROR (skip line), WARNING (process with caution)

    def __repr__(self):
        return f"[{self.severity}] {self.field}: {self.message}"


class BOLineValidator:
    """
    Validates a BOLineRaw before it enters the planning pipeline.

    Checks:
        1. item_code is not empty
        2. monthly_usage >= 0 (negative is invalid)
        3. bo_quantity > 0 (zero BO makes no sense)
        4. order dates are valid (not expired beyond tolerance)
        5. delivered_quantity <= bo_quantity (data integrity)
    """

    def __init__(self, run_date: Optional[date] = None):
        self._run_date = run_date or date.today()

    def validate(self, line: BOLineRaw) -> list[ValidationError]:
        """Returns list of validation errors. Empty list = valid."""
        errors: list[ValidationError] = []

        # 1. item_code must exist
        if not line.item_code or not line.item_code.strip():
            errors.append(ValidationError(
                "item_code",
                f"Missing item_code for line {line.line_id} "
                f"(item_id={line.item_id})",
            ))

        # 2. monthly_usage must be non-negative
        if line.monthly_usage < 0:
            errors.append(ValidationError(
                "monthly_usage",
                f"Negative MU ({line.monthly_usage}) for item {line.item_code}. "
                f"MU must be >= 0.",
            ))

        # 3. bo_quantity must be positive
        if line.bo_quantity <= 0:
            errors.append(ValidationError(
                "bo_quantity",
                f"BO quantity is {line.bo_quantity} for item {line.item_code}. "
                f"Must be > 0.",
            ))

        # 4. Order end date should not be far in the past
        if line.order_end_date:
            try:
                end_date = datetime.fromisoformat(
                    line.order_end_date.replace("Z", "+00:00")
                ).date()
                days_expired = (self._run_date - end_date).days
                if days_expired > 90:
                    errors.append(ValidationError(
                        "order_end_date",
                        f"BO {line.order_number} expired {days_expired} days ago "
                        f"(end_date={line.order_end_date}). "
                        f"Should be marked COMPLETED/CANCELLED.",
                        severity="WARNING",
                    ))
            except (ValueError, TypeError):
                pass  # Can't parse date — not a blocking error

        # 5. Delivered should not exceed BO qty (data integrity warning)
        if line.delivered_quantity > line.bo_quantity and line.bo_quantity > 0:
            errors.append(ValidationError(
                "delivered_quantity",
                f"Delivered ({line.delivered_quantity}) exceeds BO qty "
                f"({line.bo_quantity}) for item {line.item_code}. "
                f"Possible data integrity issue.",
                severity="WARNING",
            ))

        return errors

    def is_processable(self, errors: list[ValidationError]) -> bool:
        """Returns True if no blocking (ERROR-level) issues exist."""
        return not any(e.severity == "ERROR" for e in errors)

    def log_errors(self, line: BOLineRaw, errors: list[ValidationError]) -> None:
        """Log validation errors with appropriate severity."""
        for err in errors:
            if err.severity == "ERROR":
                logger.error(
                    f"VALIDATION ERROR — BO={line.order_number} "
                    f"item={line.item_code}: {err}"
                )
            else:
                logger.warning(
                    f"VALIDATION WARNING — BO={line.order_number} "
                    f"item={line.item_code}: {err}"
                )
