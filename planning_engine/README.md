# WMS Planning Engine

**Commitment-Constrained Min-Max Periodic Review Engine**

A read-only Python computation engine that runs as a daily CRON job to evaluate inventory levels, generate demand forecasts, and emit actionable alerts for the Warehouse Management System.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  main.py  (CRON entry + CLI)                         │
│    └── PlanningEngine.run_daily_cycle()               │
│          │                                            │
│          ├── [VALIDATE]  BOLineValidator              │
│          │   Checks: item_code, MU≥0, BO_qty>0,      │
│          │   order dates, delivery integrity          │
│          │                                            │
│          ├── [READ]  PlanningQueries                  │
│          │   Q1: Active BO lines + item_code resolve  │
│          │   Q2: US warehouse stock (item_code FK)    │
│          │   Q3: Total delivered (item_id FK)         │
│          │   Q4: Pending releases                     │
│          │   Q5: Today's existing alerts (dedup)      │
│          │                                            │
│          ├── [COMPUTE]  PlanningContext                │
│          │   annual_qty = MU × 12                     │
│          │   min_stock  = MU × 4  (or DB override)    │
│          │   max_stock  = MU × 6  (or DB override)    │
│          │   production_allowed = MIN(remaining,gap)  │
│          │                                            │
│          ├── [ALERT]  AlertEvaluator                  │
│          │   1. BO Consumed      → CRITICAL           │
│          │   2. Low Stock        → HIGH               │
│          │   3. Commitment Low   → HIGH               │
│          │   4. Max Stock        → LOW                │
│          │   5. Healthy          → (skip)             │
│          │   + Deduplication (no repeats same day)    │
│          │                                            │
│          └── [FORECAST]  ForecastGenerator            │
│              12-month rolling, commitment-capped      │
│                                                       │
│  WRITES:  notifications (INSERT), demand_forecasts    │
│  READS:   blanket_orders, blanket_order_lines,        │
│           blanket_releases, inv_warehouse_stock,      │
│           inv_warehouses, items, profiles              │
└──────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Install dependencies
pip install -r planning_engine/requirements.txt

# 2. Configure environment
cp planning_engine/.env.example planning_engine/.env
# Edit .env with your Supabase credentials

# 3. Run tests (no DB required)
python -m pytest planning_engine/tests.py -v

# 4. Dry run (preview mode, no DB writes)
python -m planning_engine.main --dry-run

# 5. Live run
python -m planning_engine.main

# 6. Debug mode
python -m planning_engine.main --dry-run --log-level DEBUG
```

## CRON Setup

```bash
# Daily at 2:00 AM UTC
0 2 * * * cd /path/to/WarehouseManagementSystem && python -m planning_engine.main >> /var/log/planning_engine.log 2>&1
```

## Core Business Rule

```
production_allowed = MIN(
    remaining_annual_commitment,     # (MU × 12) − total_delivered
    MAX(0, max_stock − us_stock)     # max capacity gap
)
```

This prevents overproduction, commitment breach, and artificial replenishment.

## DB Schema Alignment

| Engine Field | DB Table | DB Column | FK Type |
|---|---|---|---|
| `item_id` | `blanket_order_lines` | `item_id` | UUID |
| `item_code` | `items` | `item_code` | String |
| `bo_quantity` | `blanket_order_lines` | `total_quantity` | — |
| `monthly_usage` | `blanket_order_lines` | `monthly_usage` | — |
| `us_stock` | `inv_warehouse_stock` | `quantity_on_hand` | item_code FK |
| `total_delivered` | `blanket_releases` | `delivered_quantity` | item_id FK |

## File Structure

```
planning_engine/
├── __init__.py          # Package init
├── __main__.py          # Module runner (python -m planning_engine)
├── config.py            # SupabaseConfig + PlanningConfig
├── models.py            # Domain models (PlanningContext, AlertRecord, etc.)
├── queries.py           # Read-only data access layer
├── validators.py        # Input validation before processing
├── alerts.py            # Alert evaluation engine (5 conditions)
├── forecast.py          # 12-month commitment-capped forecast
├── engine.py            # Core orchestrator
├── main.py              # CLI entry point with argparse
├── tests.py             # Unit tests (38 tests)
├── requirements.txt     # Python dependencies
├── .env.example         # Environment template
└── README.md            # This file
```

## Constraints

- **READ-ONLY** on all business tables
- **INSERT-ONLY** on `notifications` and `demand_forecasts`
- Zero updates to any existing database record
- Phase 1: US Warehouse only (`WH-US-TRANSIT`)
