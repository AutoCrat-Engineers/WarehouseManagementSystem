# ============================================================================
# MOCK DATA — Rich analytics data matching the SQL views
# ============================================================================

from typing import Optional
from .models import BOLineRaw

# ═══════════════════════════════════════════════════════════════════
# MOCK BO LINES (6 items, 2 customers)
# ═══════════════════════════════════════════════════════════════════

MOCK_BO_LINES: list[BOLineRaw] = [
    BOLineRaw(
        order_id="bo-uuid-1001", order_number="2026BO-1001",
        customer_name="Alpha Industries LLC",
        line_id="line-uuid-1001-a", item_id="item-uuid-ae001",
        item_code="ITEM-AE001", item_name="Precision Bearing Assembly — Type A",
        bo_quantity=60000, monthly_usage=2500,
        released_quantity=45000, delivered_quantity=42000,
        db_min_stock=10000, db_max_stock=15000, db_safety_stock=5000,
        order_multiple=500, packing_multiple=250,
        order_start_date="2026-01-01", order_end_date="2026-12-31",
    ),
    BOLineRaw(
        order_id="bo-uuid-1001", order_number="2026BO-1001",
        customer_name="Alpha Industries LLC",
        line_id="line-uuid-1001-b", item_id="item-uuid-ae002",
        item_code="ITEM-AE002", item_name="Hydraulic Valve Housing — Series H",
        bo_quantity=36000, monthly_usage=1500,
        released_quantity=20000, delivered_quantity=18000,
        db_min_stock=6000, db_max_stock=9000, db_safety_stock=3000,
        order_multiple=300, packing_multiple=150,
        order_start_date="2026-01-01", order_end_date="2026-12-31",
    ),
    BOLineRaw(
        order_id="bo-uuid-1001", order_number="2026BO-1001",
        customer_name="Alpha Industries LLC",
        line_id="line-uuid-1001-c", item_id="item-uuid-ae003",
        item_code="ITEM-AE003", item_name="Motor Drive Coupling — MK-III",
        bo_quantity=24000, monthly_usage=800,
        released_quantity=10000, delivered_quantity=8000,
        db_min_stock=3200, db_max_stock=4800, db_safety_stock=1600,
        order_multiple=200, packing_multiple=100,
        order_start_date="2026-01-01", order_end_date="2026-12-31",
    ),
    BOLineRaw(
        order_id="bo-uuid-1002", order_number="2026BO-1002",
        customer_name="Bravo Manufacturing Co.",
        line_id="line-uuid-1002-a", item_id="item-uuid-ae004",
        item_code="ITEM-AE004", item_name="Stainless Steel Flange — DN50",
        bo_quantity=15000, monthly_usage=1200,
        released_quantity=15000, delivered_quantity=15200,
        db_min_stock=4800, db_max_stock=7200, db_safety_stock=2400,
        order_multiple=400, packing_multiple=200,
        order_start_date="2025-06-01", order_end_date="2026-06-30",
    ),
    BOLineRaw(
        order_id="bo-uuid-1002", order_number="2026BO-1002",
        customer_name="Bravo Manufacturing Co.",
        line_id="line-uuid-1002-b", item_id="item-uuid-ae005",
        item_code="ITEM-AE005", item_name="Titanium Rod — Grade 5, 12mm",
        bo_quantity=40000, monthly_usage=2000,
        released_quantity=38000, delivered_quantity=35000,
        db_min_stock=8000, db_max_stock=12000, db_safety_stock=4000,
        order_multiple=500, packing_multiple=250,
        order_start_date="2025-06-01", order_end_date="2026-06-30",
    ),
    BOLineRaw(
        order_id="bo-uuid-1002", order_number="2026BO-1002",
        customer_name="Bravo Manufacturing Co.",
        line_id="line-uuid-1002-c", item_id="item-uuid-ae006",
        item_code="ITEM-AE006", item_name="Carbon Fiber Bracket — CFB-20",
        bo_quantity=30000, monthly_usage=1000,
        released_quantity=12000, delivered_quantity=10000,
        db_min_stock=4000, db_max_stock=6000, db_safety_stock=2000,
        order_multiple=250, packing_multiple=125,
        order_start_date="2025-06-01", order_end_date="2026-06-30",
    ),
]

# ═══════════════════════════════════════════════════════════════════
# MOCK: Warehouse stock (multi-warehouse per item)
# Matches v_planning_stock_by_warehouse
# ═══════════════════════════════════════════════════════════════════

MOCK_WAREHOUSE_STOCK: dict[str, list[dict]] = {
    "ITEM-AE001": [
        {"warehouse_code": "WH-US-MAIN", "warehouse_name": "US Main Warehouse", "warehouse_type": "FINISHED_GOODS",
         "on_hand": 500, "allocated": 200, "reserved": 100, "in_transit": 0, "available": 200},
        {"warehouse_code": "WH-US-TRANSIT", "warehouse_name": "US Transit Hub", "warehouse_type": "TRANSIT",
         "on_hand": 300, "allocated": 0, "reserved": 0, "in_transit": 800, "available": 300},
    ],
    "ITEM-AE002": [
        {"warehouse_code": "WH-US-MAIN", "warehouse_name": "US Main Warehouse", "warehouse_type": "FINISHED_GOODS",
         "on_hand": 3500, "allocated": 1500, "reserved": 500, "in_transit": 0, "available": 1500},
        {"warehouse_code": "WH-US-TRANSIT", "warehouse_name": "US Transit Hub", "warehouse_type": "TRANSIT",
         "on_hand": 1000, "allocated": 0, "reserved": 0, "in_transit": 1500, "available": 1000},
    ],
    "ITEM-AE003": [
        {"warehouse_code": "WH-US-MAIN", "warehouse_name": "US Main Warehouse", "warehouse_type": "FINISHED_GOODS",
         "on_hand": 4200, "allocated": 0, "reserved": 0, "in_transit": 0, "available": 4200},
        {"warehouse_code": "WH-US-TRANSIT", "warehouse_name": "US Transit Hub", "warehouse_type": "TRANSIT",
         "on_hand": 2000, "allocated": 0, "reserved": 0, "in_transit": 500, "available": 2000},
    ],
    "ITEM-AE004": [
        {"warehouse_code": "WH-US-MAIN", "warehouse_name": "US Main Warehouse", "warehouse_type": "FINISHED_GOODS",
         "on_hand": 2500, "allocated": 0, "reserved": 0, "in_transit": 0, "available": 2500},
        {"warehouse_code": "WH-US-TRANSIT", "warehouse_name": "US Transit Hub", "warehouse_type": "TRANSIT",
         "on_hand": 1000, "allocated": 0, "reserved": 0, "in_transit": 0, "available": 1000},
    ],
    "ITEM-AE005": [
        {"warehouse_code": "WH-US-MAIN", "warehouse_name": "US Main Warehouse", "warehouse_type": "FINISHED_GOODS",
         "on_hand": 6000, "allocated": 2000, "reserved": 1000, "in_transit": 0, "available": 3000},
        {"warehouse_code": "WH-US-TRANSIT", "warehouse_name": "US Transit Hub", "warehouse_type": "TRANSIT",
         "on_hand": 3000, "allocated": 0, "reserved": 0, "in_transit": 2000, "available": 3000},
    ],
    "ITEM-AE006": [
        {"warehouse_code": "WH-US-MAIN", "warehouse_name": "US Main Warehouse", "warehouse_type": "FINISHED_GOODS",
         "on_hand": 3500, "allocated": 500, "reserved": 250, "in_transit": 0, "available": 2750},
        {"warehouse_code": "WH-US-TRANSIT", "warehouse_name": "US Transit Hub", "warehouse_type": "TRANSIT",
         "on_hand": 1000, "allocated": 0, "reserved": 0, "in_transit": 500, "available": 1000},
    ],
}

# ═══════════════════════════════════════════════════════════════════
# MOCK: Release schedule per item
# Matches v_planning_release_schedule
# ═══════════════════════════════════════════════════════════════════

MOCK_RELEASE_SCHEDULE: dict[str, list[dict]] = {
    "ITEM-AE001": [
        {"release_number": "2026BO-1001-R12", "requested_delivery_date": "2026-03-15",
         "requested_quantity": 2500, "delivered_quantity": 0, "status": "CONFIRMED",
         "outstanding_qty": 2500, "days_until_delivery": 13, "is_overdue": False, "qty_reserved_from_stock": 500},
        {"release_number": "2026BO-1001-R13", "requested_delivery_date": "2026-04-10",
         "requested_quantity": 2500, "delivered_quantity": 0, "status": "PENDING",
         "outstanding_qty": 2500, "days_until_delivery": 39, "is_overdue": False, "qty_reserved_from_stock": 0},
    ],
    "ITEM-AE002": [
        {"release_number": "2026BO-1001-R8", "requested_delivery_date": "2026-03-20",
         "requested_quantity": 1500, "delivered_quantity": 0, "status": "CONFIRMED",
         "outstanding_qty": 1500, "days_until_delivery": 18, "is_overdue": False, "qty_reserved_from_stock": 1500},
        {"release_number": "2026BO-1001-R9", "requested_delivery_date": "2026-04-15",
         "requested_quantity": 1500, "delivered_quantity": 0, "status": "PENDING",
         "outstanding_qty": 1500, "days_until_delivery": 44, "is_overdue": False, "qty_reserved_from_stock": 0},
    ],
    "ITEM-AE003": [
        {"release_number": "2026BO-1001-R5", "requested_delivery_date": "2026-04-01",
         "requested_quantity": 800, "delivered_quantity": 0, "status": "PENDING",
         "outstanding_qty": 800, "days_until_delivery": 30, "is_overdue": False, "qty_reserved_from_stock": 0},
    ],
    "ITEM-AE004": [],
    "ITEM-AE005": [
        {"release_number": "2026BO-1002-R20", "requested_delivery_date": "2026-03-10",
         "requested_quantity": 2000, "delivered_quantity": 0, "status": "CONFIRMED",
         "outstanding_qty": 2000, "days_until_delivery": 8, "is_overdue": False, "qty_reserved_from_stock": 2000},
        {"release_number": "2026BO-1002-R21", "requested_delivery_date": "2026-02-28",
         "requested_quantity": 1500, "delivered_quantity": 0, "status": "PENDING",
         "outstanding_qty": 1500, "days_until_delivery": -2, "is_overdue": True, "qty_reserved_from_stock": 0},
    ],
    "ITEM-AE006": [
        {"release_number": "2026BO-1002-R10", "requested_delivery_date": "2026-03-25",
         "requested_quantity": 1000, "delivered_quantity": 0, "status": "PENDING",
         "outstanding_qty": 1000, "days_until_delivery": 23, "is_overdue": False, "qty_reserved_from_stock": 0},
    ],
}

# ═══════════════════════════════════════════════════════════════════
# MOCK: Monthly activity (from inv_stock_ledger aggregation)
# Matches v_planning_monthly_activity
# ═══════════════════════════════════════════════════════════════════

def _generate_monthly_activity(item_code: str, mu: float) -> list[dict]:
    """Generate 6 months of realistic activity data."""
    import random
    random.seed(hash(item_code))
    months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]
    result = []
    balance = int(mu * 3)
    for m in months:
        inbound = int(mu * random.uniform(0.6, 1.4))
        outbound = int(mu * random.uniform(0.5, 1.2))
        net = inbound - outbound
        balance += net
        balance = max(0, balance)
        result.append({
            "activity_month": f"{m}-01",
            "inbound_qty": inbound,
            "outbound_qty": outbound,
            "net_change": net,
            "transaction_count": random.randint(4, 15),
            "ending_balance": balance,
        })
    return result


MOCK_MONTHLY_ACTIVITY: dict[str, list[dict]] = {
    line.item_code: _generate_monthly_activity(line.item_code, line.monthly_usage)
    for line in MOCK_BO_LINES
}

# ═══════════════════════════════════════════════════════════════════
# MOCK: US stock totals (for planning engine context)
# ═══════════════════════════════════════════════════════════════════

MOCK_US_STOCK: dict[str, float] = {}
for _code, _wh_list in MOCK_WAREHOUSE_STOCK.items():
    MOCK_US_STOCK[_code] = sum(w["on_hand"] for w in _wh_list)

MOCK_DELIVERED: dict[str, float] = {
    line.item_id: line.delivered_quantity for line in MOCK_BO_LINES
}

# ═══════════════════════════════════════════════════════════════════
# MockPlanningQueries — Drop-in replacement
# ═══════════════════════════════════════════════════════════════════

class MockPlanningQueries:
    def fetch_active_bo_lines(self) -> list[BOLineRaw]:
        return MOCK_BO_LINES.copy()

    def fetch_us_stock(self, item_code: str, warehouse_id: str) -> float:
        return MOCK_US_STOCK.get(item_code, 0.0)

    def fetch_total_delivered(self, order_id: str, item_id: str, delivered_statuses: list[str]) -> float:
        return MOCK_DELIVERED.get(item_id, 0.0)

    def fetch_pending_releases(self, order_id: str, item_id: str) -> list[dict]:
        code = next((l.item_code for l in MOCK_BO_LINES if l.item_id == item_id), None)
        if not code:
            return []
        return [
            {"id": r["release_number"], "requested_quantity": r["requested_quantity"],
             "delivered_quantity": r["delivered_quantity"], "status": r["status"],
             "requested_delivery_date": r["requested_delivery_date"]}
            for r in MOCK_RELEASE_SCHEDULE.get(code, [])
            if r["status"] in ("PENDING", "CONFIRMED")
        ]

    def resolve_warehouse_id(self, warehouse_code: str) -> Optional[str]:
        return "mock-wh-us-001"

    def fetch_target_user_ids(self, roles: list[str]) -> list[str]:
        return ["mock-user-supervisor-001"]

    def fetch_today_alert_keys(self, today_iso: str) -> set[str]:
        return set()

    def resolve_item_code(self, item_id: str) -> Optional[str]:
        return {l.item_id: l.item_code for l in MOCK_BO_LINES}.get(item_id)
