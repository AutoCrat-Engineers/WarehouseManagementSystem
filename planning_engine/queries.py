# ============================================================================
# QUERIES — Read-only data access layer (schema-aligned)
# ============================================================================
#
# TABLE COLUMN REFERENCE (from actual Supabase schema):
#
#   blanket_orders:
#     id, order_number, customer_name, customer_code, order_date,
#     start_date, end_date, status, created_at, created_by
#
#   blanket_order_lines:
#     id, order_id (FK→blanket_orders.id), item_id (FK→items.item_id),
#     total_quantity, released_quantity, delivered_quantity,
#     pending_quantity (computed), unit_price, line_total (computed),
#     monthly_usage, min_stock, max_stock, safety_stock,
#     order_multiple, packing_multiple, delivery_schedule, item_quantity
#
#   blanket_releases:
#     id, release_number, order_id (FK→blanket_orders.id),
#     line_id (FK→blanket_order_lines.id), item_id (FK→items.item_id),
#     release_date, requested_delivery_date, actual_delivery_date,
#     requested_quantity, delivered_quantity, status,
#     shipment_number, tracking_number
#
#   inv_warehouse_stock:
#     id, warehouse_id (FK→inv_warehouses.id), item_code (string FK→items.item_code),
#     quantity_on_hand, is_active, last_receipt_date, last_issue_date
#
#   inv_warehouses:
#     id, warehouse_code, warehouse_name, is_active
#
#   items:
#     id (=item_id), item_code, item_name, ...
#
#   v_item_details (VIEW — joins items + blanket_orders + blanket_order_lines):
#     id, item_code, item_name, blanket_order_id, order_number,
#     customer_name, blanket_quantity, monthly_usage, min_stock, max_stock, ...
#
# ============================================================================

import logging
from typing import Optional

from supabase import Client

from .models import BOLineRaw

logger = logging.getLogger("planning_engine")


class PlanningQueries:
    """
    Data Access Layer — READ-ONLY queries against the WMS database.

    Tables accessed (READ):
        blanket_orders, blanket_order_lines, blanket_releases,
        inv_warehouse_stock, inv_warehouses, items, profiles

    FK Resolution:
        blanket_order_lines uses item_id (UUID)
        inv_warehouse_stock uses item_code (string)
        → We fetch items.item_code via nested select to bridge them.
    """

    def __init__(self, supabase: Client):
        self._sb = supabase
        self._item_code_cache: dict[str, str] = {}  # item_id → item_code

    # ─────────────────────────────────────────────────────────────
    # Q1: Active Blanket Order Lines (with item_code resolution)
    # ─────────────────────────────────────────────────────────────

    def fetch_active_bo_lines(self) -> list[BOLineRaw]:
        """
        Fetch all lines from active blanket orders.

        Uses nested select to resolve item_id → item_code
        because inv_warehouse_stock uses item_code as FK.
        """
        result = (
            self._sb
            .table("blanket_orders")
            .select(
                "id, order_number, customer_name, status, "
                "start_date, end_date, "
                "blanket_order_lines ("
                "  id, item_id, total_quantity, "
                "  monthly_usage, released_quantity, delivered_quantity, "
                "  min_stock, max_stock, safety_stock, "
                "  order_multiple, packing_multiple, "
                "  items ( item_code, item_name )"
                ")"
            )
            .eq("status", "ACTIVE")
            .execute()
        )

        lines: list[BOLineRaw] = []
        for order in (result.data or []):
            for line in (order.get("blanket_order_lines") or []):
                # Resolve item_code from nested items join
                items_data = line.get("items") or {}
                item_code = items_data.get("item_code", "")
                item_name = items_data.get("item_name", "")
                item_id = line.get("item_id", "")

                if not item_code:
                    logger.warning(
                        f"Line {line.get('id')} has no item_code "
                        f"(item_id={item_id}). Skipping."
                    )
                    continue

                # Cache item_id → item_code mapping
                if item_id:
                    self._item_code_cache[item_id] = item_code

                lines.append(BOLineRaw(
                    order_id=order["id"],
                    order_number=order["order_number"],
                    customer_name=order["customer_name"],
                    line_id=line["id"],
                    item_id=item_id,
                    item_code=item_code,
                    item_name=item_name,
                    bo_quantity=float(line.get("total_quantity") or 0),
                    monthly_usage=float(line.get("monthly_usage") or 0),
                    released_quantity=float(line.get("released_quantity") or 0),
                    delivered_quantity=float(line.get("delivered_quantity") or 0),
                    db_min_stock=line.get("min_stock"),
                    db_max_stock=line.get("max_stock"),
                    db_safety_stock=line.get("safety_stock"),
                    order_multiple=line.get("order_multiple"),
                    packing_multiple=line.get("packing_multiple"),
                    order_start_date=order.get("start_date"),
                    order_end_date=order.get("end_date"),
                ))

        logger.info(
            f"Fetched {len(lines)} active BO lines "
            f"from {len(result.data or [])} orders"
        )
        return lines

    # ─────────────────────────────────────────────────────────────
    # Q2: US Warehouse Stock (uses item_code, not item_id)
    # ─────────────────────────────────────────────────────────────

    def fetch_us_stock(self, item_code: str, warehouse_id: str) -> float:
        """
        SELECT quantity_on_hand FROM inv_warehouse_stock
        WHERE warehouse_id = :wh_id AND item_code = :item_code AND is_active
        """
        result = (
            self._sb
            .table("inv_warehouse_stock")
            .select("quantity_on_hand")
            .eq("warehouse_id", warehouse_id)
            .eq("item_code", item_code)
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        if result.data:
            return float(result.data.get("quantity_on_hand", 0))
        return 0.0

    # ─────────────────────────────────────────────────────────────
    # Q3: Total Delivered via Blanket Releases (uses item_id)
    # ─────────────────────────────────────────────────────────────

    def fetch_total_delivered(
        self,
        order_id: str,
        item_id: str,
        delivered_statuses: list[str],
    ) -> float:
        """
        SUM(delivered_quantity) from blanket_releases
        for a given order + item combination.

        NOTE: blanket_releases uses item_id (UUID FK), not item_code.
        """
        result = (
            self._sb
            .table("blanket_releases")
            .select("delivered_quantity")
            .eq("order_id", order_id)
            .eq("item_id", item_id)
            .in_("status", delivered_statuses)
            .execute()
        )
        return sum(
            float(r.get("delivered_quantity") or 0)
            for r in (result.data or [])
        )

    # ─────────────────────────────────────────────────────────────
    # Q4: Pending Releases (not yet delivered)
    # ─────────────────────────────────────────────────────────────

    def fetch_pending_releases(
        self, order_id: str, item_id: str
    ) -> list[dict]:
        """
        Releases that are scheduled but not yet delivered.
        Used for planning: upcoming demand that's already committed.
        """
        result = (
            self._sb
            .table("blanket_releases")
            .select(
                "id, release_number, requested_quantity, "
                "delivered_quantity, status, "
                "requested_delivery_date"
            )
            .eq("order_id", order_id)
            .eq("item_id", item_id)
            .in_("status", ["PENDING", "CONFIRMED"])
            .order("requested_delivery_date")
            .execute()
        )
        return result.data or []

    # ─────────────────────────────────────────────────────────────
    # Q5: Stock Ledger — Recent movements for an item
    # ─────────────────────────────────────────────────────────────

    def fetch_recent_movements(
        self, item_code: str, warehouse_id: str, limit: int = 30
    ) -> list[dict]:
        """
        Recent stock ledger entries for trend analysis.
        """
        result = (
            self._sb
            .table("inv_stock_ledger")
            .select(
                "transaction_type, quantity_change, "
                "quantity_before, quantity_after, "
                "created_at, notes"
            )
            .eq("warehouse_id", warehouse_id)
            .eq("item_code", item_code)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    # ─────────────────────────────────────────────────────────────
    # WAREHOUSE RESOLUTION
    # ─────────────────────────────────────────────────────────────

    def resolve_warehouse_id(self, warehouse_code: str) -> Optional[str]:
        """Resolve warehouse_code → warehouse UUID."""
        result = (
            self._sb
            .table("inv_warehouses")
            .select("id")
            .eq("warehouse_code", warehouse_code)
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        if result.data:
            wh_id = result.data.get("id")
            logger.info(f"Resolved warehouse '{warehouse_code}' → {wh_id}")
            return wh_id
        logger.error(f"Warehouse '{warehouse_code}' not found or inactive")
        return None

    # ─────────────────────────────────────────────────────────────
    # TARGET USERS FOR NOTIFICATIONS
    # ─────────────────────────────────────────────────────────────

    def fetch_target_user_ids(self, roles: list[str]) -> list[str]:
        """Fetch user IDs for supervisors/managers (notification targets)."""
        result = (
            self._sb
            .table("profiles")
            .select("id")
            .in_("role", roles)
            .execute()
        )
        user_ids = [u["id"] for u in (result.data or []) if u.get("id")]
        logger.info(f"Found {len(user_ids)} target users for roles {roles}")
        return user_ids

    # ─────────────────────────────────────────────────────────────
    # DEDUPLICATION — Check existing alerts for today
    # ─────────────────────────────────────────────────────────────

    def fetch_today_alert_keys(self, today_iso: str) -> set[str]:
        """
        Fetch (type, reference_id) pairs of alerts already created today.
        Prevents duplicate alerts when engine runs multiple times per day.
        """
        result = (
            self._sb
            .table("notifications")
            .select("type, reference_id")
            .eq("module", "planning")
            .gte("created_at", f"{today_iso}T00:00:00")
            .lte("created_at", f"{today_iso}T23:59:59")
            .execute()
        )
        return {
            f"{r['type']}:{r['reference_id']}"
            for r in (result.data or [])
            if r.get("type") and r.get("reference_id")
        }

    # ─────────────────────────────────────────────────────────────
    # ITEM CODE LOOKUP
    # ─────────────────────────────────────────────────────────────

    def resolve_item_code(self, item_id: str) -> Optional[str]:
        """Resolve item_id (UUID) → item_code (string). Uses cache."""
        if item_id in self._item_code_cache:
            return self._item_code_cache[item_id]

        result = (
            self._sb
            .table("items")
            .select("item_code")
            .eq("id", item_id)
            .maybe_single()
            .execute()
        )
        if result.data:
            code = result.data.get("item_code", "")
            self._item_code_cache[item_id] = code
            return code
        return None
