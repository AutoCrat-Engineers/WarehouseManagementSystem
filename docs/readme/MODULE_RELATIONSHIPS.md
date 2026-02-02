# 🔗 Module Relationships & Data Flow

## Purpose of This Document

Explains **how each module connects**, **what tables they share**, and **why each module exists**.

This is required so new engineers can understand the system architecture.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      ENTERPRISE ERP SYSTEM                       │
│                                                                  │
│  Data Creation → Stock Management → Demand Planning → Delivery  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module 1: Item Master

### Purpose
**Master data management** for Finished Goods (FG).

### What It Does
- Create new FG items
- Define planning parameters (min/max/safety stock, lead time)
- Set status (active/inactive)
- Maintain item metadata

### Tables Owned
- `items` (Primary owner)

### Tables Referenced
- None (root entity)

### Connections to Other Modules

| Module | Relationship | How Connected |
|--------|-------------|---------------|
| Inventory | **1:1** | Each item has ONE inventory record |
| Forecasting | **1:M** | Each item can have many forecasts |
| Planning | **1:M** | Each item can have many recommendations |
| Blanket Orders | **1:M** | Each item can be in many orders |
| Stock Movements | **1:M** | Each item has many movements |

### Why It Exists
**Without Item Master:** No central definition of what products exist, their planning parameters, or their status.

**With Item Master:** Single source of truth for all products managed in the system.

---

## Module 2: Inventory Management

### Purpose
Track **real-time stock levels** for each item.

### What It Does
- Show current available stock
- Show reserved stock (for blanket orders)
- Show in-transit stock
- Display stock movements (ledger)
- Create manual adjustments

### Tables Owned
- `inventory` (Primary owner)
- `stock_movements` (Primary owner)

### Tables Referenced
- `items` (FK: item_id)

### Connections to Other Modules

| Module | Relationship | Data Flow |
|--------|-------------|-----------|
| Item Master | **Uses** | Reads item details (UOM, code, name) |
| Stock Movements | **Creates** | Every stock change creates a movement record |
| Blanket Releases | **Updates** | Release delivery → AUTO reduces stock |
| Forecasting | **Reads** | Inventory levels used in demand history |
| Planning | **Reads** | Current stock used in MRP calculation |

### Why It Exists
**Without Inventory:** No way to know how much stock we have, when we're out of stock, or where stock went.

**With Inventory:** Real-time visibility into stock levels with complete audit trail.

---

## Module 3: Forecasting

### Purpose
**Predict future demand** using statistical models.

### What It Does
- Analyze historical demand patterns
- Detect trends and seasonality
- Generate forecasts using Holt-Winters
- Calculate forecast accuracy
- Provide confidence intervals

### Tables Owned
- `demand_forecasts` (Primary owner)
- `demand_history` (Primary owner)

### Tables Referenced
- `items` (FK: item_id)

### Connections to Other Modules

| Module | Relationship | Data Flow |
|--------|-------------|-----------|
| Item Master | **Uses** | Forecast per item |
| Demand History | **Reads** | Historical data is input to forecast model |
| Planning | **Feeds** | Forecast output is input to MRP |
| Blanket Releases | **Populates** | Actual deliveries create demand history |
| Stock Movements | **Populates** | OUT movements populate demand history |

### Why It Exists
**Without Forecasting:** Planning is reactive, always catching up to demand, frequent stock-outs or overproduction.

**With Forecasting:** Proactive planning, optimized inventory levels, reduced costs.

### Data Flow

```
Historical Demand (past 24 months)
         ↓
Holt-Winters Algorithm
         ↓
Forecasted Demand (next 12 months)
         ↓
Planning Module (uses forecast to recommend actions)
```

---

## Module 4: Planning (MRP - Material Requirements Planning)

### Purpose
**Bridge between forecasting and execution** - tells you WHAT to produce, HOW MUCH, and WHEN.

### What It Does
- Takes forecasted demand
- Compares with current inventory
- Considers lead times
- Considers min/max/safety stock
- Generates actionable recommendations
- Prioritizes by criticality

### Tables Owned
- `planning_recommendations` (Primary owner)

### Tables Referenced
- `items` (FK: item_id)
- `inventory` (Read current stock)
- `demand_forecasts` (Read future demand)
- `blanket_order_lines` (Read reserved quantities)

### Connections to Other Modules

| Module | Relationship | Data Flow |
|--------|-------------|-----------|
| Forecasting | **Consumes** | Reads forecasted demand |
| Inventory | **Reads** | Current stock levels |
| Item Master | **Uses** | Min/max/safety stock, lead time |
| Blanket Orders | **Considers** | Reserved quantities reduce available stock |

### Why It Exists

**Problem Without Planning Module:**
- Forecasting shows demand, but doesn't tell you WHEN to act
- Inventory shows current stock, but doesn't project future
- Manual calculation required
- Inconsistent decision-making
- Reactive instead of proactive

**Solution With Planning Module:**
- Automatic MRP calculation
- Clear recommendations per item
- Priority-based action list
- Considers all factors (demand, stock, lead time, buffers)
- Proactive planning

### Business Logic

```python
For each item:
    1. Get current available stock
    2. Get reserved stock (blanket orders)
    3. Get forecasted demand (next N days)
    4. Calculate: Net Available = Available - Reserved
    5. Calculate: Projected Stock = Net Available - Forecasted Demand
    6. If Projected Stock < 0:
        → CRITICAL: Stock-out imminent
        → Recommend: Immediate production
    7. Elif Projected Stock < Min Stock:
        → HIGH: Below minimum
        → Recommend: Produce to Max Stock
    8. Elif Projected Stock < Safety Stock:
        → MEDIUM: Below safety buffer
        → Recommend: Produce to Max Stock
    9. Elif Projected Stock > Max Stock:
        → LOW: Overstock
        → Recommend: Hold current levels
    10. Else:
        → OK: Healthy levels
        → Recommend: No action
```

### Operational Use

1. **Planner Role** opens Planning Module daily
2. System shows **recommendations sorted by priority**
3. Planner reviews **CRITICAL** items first
4. Approves/modifies recommendations
5. Recommendations feed into **production scheduling system**
6. Production creates products
7. Stock movements (IN) update inventory
8. Cycle repeats

---

## Module 5: Blanket Orders

### Purpose
Manage **long-term supply agreements** with customers.

### What It Does
- Create blanket orders (umbrella contract)
- Add items with total quantities
- Track order dates (start/end)
- Monitor release status
- Track total vs released vs delivered quantities

### Tables Owned
- `blanket_orders` (Primary owner)
- `blanket_order_lines` (Primary owner)

### Tables Referenced
- `items` (FK: item_id)

### Connections to Other Modules

| Module | Relationship | Data Flow |
|--------|-------------|-----------|
| Item Master | **Uses** | Order lines reference items |
| Blanket Releases | **Creates** | Orders spawn multiple releases |
| Inventory | **Reserves** | Reserved stock allocated to orders |
| Planning | **Feeds** | Reserved quantities reduce available for planning |

### Why It Exists
**Without Blanket Orders:** No way to manage long-term customer commitments, no visibility into future demand.

**With Blanket Orders:** Clear visibility into customer commitments, structured release management.

---

## Module 6: Blanket Releases

### Purpose
Execute **delivery call-offs** against blanket orders.

### What It Does
- Create release against order line
- Request specific quantity and date
- Track shipment status
- Record delivery
- **Auto-deduct inventory** on delivery

### Tables Owned
- `blanket_releases` (Primary owner)

### Tables Referenced
- `blanket_orders` (FK: order_id)
- `blanket_order_lines` (FK: line_id)
- `items` (FK: item_id)

### Connections to Other Modules

| Module | Relationship | Data Flow |
|--------|-------------|-----------|
| Blanket Orders | **Child of** | Release belongs to order |
| Inventory | **Updates** | Delivery → AUTO creates stock movement (OUT) |
| Stock Movements | **Creates** | Delivery creates ledger entry |
| Demand History | **Populates** | Delivery records actual demand |
| Forecasting | **Feeds** | Actual demand used for future forecasts |

### Why It Exists
**Without Releases:** No phased delivery management, no tracking of partial shipments, no automatic stock deduction.

**With Releases:** Structured delivery management, full traceability, automatic inventory updates.

### Critical Auto-Deduction Logic

```
When Release Status → DELIVERED:
    1. Update order line delivered quantity
    2. Create stock movement (OUT)
    3. Stock movement trigger updates inventory (available_stock -= quantity)
    4. Record actual demand in demand_history
```

This is **fully automatic** via database triggers - no manual steps.

---

## Module 7: Stock Movements (Ledger)

### Purpose
**Complete audit trail** of all stock changes.

### What It Does
- Record every stock IN/OUT/ADJUSTMENT
- Track balance after each transaction
- Link to reference documents (releases, production orders, etc.)
- Provide searchable history
- Support inventory reconciliation

### Tables Owned
- `stock_movements` (Primary owner)

### Tables Referenced
- `items` (FK: item_id)

### Connections to Other Modules

| Module | Relationship | Data Flow |
|--------|-------------|-----------|
| Inventory | **Updates** | Movement triggers inventory update |
| Blanket Releases | **Created by** | Delivery creates OUT movement |
| Manual Adjustments | **Created by** | User adjustments create movements |
| All Modules | **Audit** | Provides complete history for all stock changes |

### Why It Exists
**Without Stock Movements:** No audit trail, no reconciliation, no accountability, no traceability.

**With Stock Movements:** Complete history, full traceability, easy reconciliation, regulatory compliance.

---

## Module 8: Dashboard

### Purpose
**Executive overview** of system health.

### What It Does
- Show KPIs (total items, inventory value, stock status)
- Highlight critical items
- Show alerts (stock-outs, planning recommendations)
- Provide quick navigation

### Tables Referenced
- All tables (read-only aggregations)

### Why It Exists
**Without Dashboard:** No quick visibility into system health, manual reporting required.

**With Dashboard:** Real-time KPIs, instant visibility, proactive alerts.

---

## Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATA CREATION                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Item Master    │ ← Create FG items
                    └────────┬────────┘
                             │
                             │ (Auto-creates)
                             ▼
                    ┌─────────────────┐
                    │   Inventory     │ ← Stock = 0 initially
                    └────────┬────────┘
                             │
┌────────────────────────────┼────────────────────────────┐
│                            │                            │
│  ┌─────────────────────────▼──────────┐                │
│  │    Stock Movement (IN)              │                │
│  │    - Production completion          │                │
│  │    - Purchase receipt               │                │
│  │    - Manual adjustment              │                │
│  └─────────────────┬───────────────────┘                │
│                    │                                     │
│                    │ (Increases stock)                   │
│                    ▼                                     │
│           ┌─────────────────┐                           │
│           │   Inventory     │ ← Available stock updated │
│           └────────┬────────┘                           │
│                    │                                     │
│  ┌─────────────────┼─────────────────┐                 │
│  │                 │                 │                  │
│  ▼                 ▼                 ▼                  │
│ ┌──────────┐  ┌──────────┐  ┌─────────────┐           │
│ │ Demand   │  │Blanket   │  │ Planning    │           │
│ │ History  │  │ Orders   │  │ Module      │           │
│ └────┬─────┘  └────┬─────┘  └──────┬──────┘           │
│      │             │                │                   │
│      │             │ (Creates)      │                   │
│      │             ▼                │                   │
│      │      ┌──────────────┐        │                   │
│      │      │  Blanket     │        │                   │
│      │      │  Releases    │        │                   │
│      │      └──────┬───────┘        │                   │
│      │             │                │                   │
│      │             │ (Delivery)     │                   │
│      │             ▼                │                   │
│      │    ┌─────────────────┐       │                   │
│      │    │ Stock Movement  │       │                   │
│      │    │     (OUT)       │       │                   │
│      │    └────────┬────────┘       │                   │
│      │             │                │                   │
│      │             │ (Reduces)      │                   │
│      │             ▼                │                   │
│      │    ┌─────────────────┐       │                   │
│      │    │   Inventory     │───────┘                   │
│      │    │  (Available ↓)  │                           │
│      │    └─────────────────┘                           │
│      │                                                   │
│      │ (Populates)                                      │
│      ▼                                                   │
│  ┌──────────────┐                                       │
│  │ Forecasting  │                                       │
│  │  (Predicts   │                                       │
│  │   future)    │                                       │
│  └──────┬───────┘                                       │
│         │                                                │
│         │ (Feeds)                                       │
│         ▼                                                │
│  ┌──────────────┐                                       │
│  │  Planning    │                                       │
│  │  (MRP Logic) │                                       │
│  └──────┬───────┘                                       │
│         │                                                │
│         │ (Recommends)                                  │
│         ▼                                                │
│  ┌──────────────┐                                       │
│  │  Production  │ ← Execute recommendations            │
│  │  Scheduling  │                                       │
│  └──────────────┘                                       │
│         │                                                │
│         └────────────────────────────────────────────────┘
│                  (Cycle repeats)
```

---

## Shared Tables & Relationships

### Table: `items`
**Owned by:** Item Master  
**Referenced by:**
- inventory (FK: item_id)
- stock_movements (FK: item_id)
- blanket_order_lines (FK: item_id)
- blanket_releases (FK: item_id)
- demand_forecasts (FK: item_id)
- demand_history (FK: item_id)
- planning_recommendations (FK: item_id)

**Why Shared:** Central master data for all modules

---

### Table: `inventory`
**Owned by:** Inventory Management  
**Referenced by:**
- Planning (reads current stock)
- Dashboard (reads for KPIs)

**Why Shared:** Real-time stock data needed across modules

---

### Table: `stock_movements`
**Owned by:** Inventory Management  
**Created by:**
- Manual adjustments (Inventory module)
- Blanket release deliveries (auto-trigger)
- Production completion (future)
- Purchase receipts (future)

**Why Shared:** Audit trail for all stock changes

---

### Table: `blanket_order_lines`
**Owned by:** Blanket Orders  
**Referenced by:**
- blanket_releases (FK: line_id)
- Planning (reads reserved quantities)

**Why Shared:** Order data needed for releases and planning

---

### Table: `demand_forecasts`
**Owned by:** Forecasting  
**Referenced by:**
- Planning (reads forecasted demand)
- Dashboard (shows forecast accuracy)

**Why Shared:** Forecast output used by planning

---

### Table: `demand_history`
**Owned by:** Forecasting  
**Populated by:**
- Blanket release deliveries
- Stock movements (OUT)

**Why Shared:** Actual demand data from multiple sources

---

## Dependency Graph

```
Item Master (root)
    ↓
Inventory (depends on Item Master)
    ↓
├─→ Stock Movements (depends on Inventory)
│       ↓
│   Demand History (populated by Stock Movements)
│       ↓
│   Forecasting (reads Demand History)
│       ↓
│   Planning (reads Forecasting + Inventory)
│
└─→ Blanket Orders (depends on Item Master)
        ↓
    Blanket Order Lines (depends on Orders)
        ↓
    Blanket Releases (depends on Lines)
        ↓
    Stock Movements (OUT) ← Auto-created on delivery
        ↓
    Inventory Update ← Auto-triggered
```

---

## Integration Points

### 1. Blanket Release → Inventory (Automatic)

```
Trigger: Release status changes to DELIVERED
Actions:
    1. Update blanket_order_lines.delivered_quantity
    2. Create stock_movements record (OUT)
    3. Trigger updates inventory.available_stock
    4. Create demand_history record
```

**Result:** Fully automatic stock deduction, no manual steps.

---

### 2. Forecasting → Planning (Data Flow)

```
Planning Module calls:
    forecasts = forecastingService.getForecast(itemId, horizonDays)
    
Planning Module uses:
    forecasts.forecasted_quantity → Calculate projected stock
```

**Result:** Planning recommendations based on predicted demand.

---

### 3. Stock Movement → Inventory (Trigger)

```
Trigger: New stock_movements record inserted
Actions:
    IF movement_type = 'IN':
        inventory.available_stock += quantity
    IF movement_type = 'OUT':
        inventory.available_stock -= quantity
```

**Result:** Inventory always in sync with movements.

---

## Module Isolation Boundaries

Each module has:
1. **Clear responsibility** - One primary job
2. **Owned tables** - Primary data owner
3. **Service layer** - Business logic encapsulation
4. **API routes** - External interface
5. **Database constraints** - Data integrity

Modules communicate through:
1. **Foreign keys** - Database relationships
2. **Service calls** - Business logic layer
3. **Triggers** - Automatic updates
4. **Read-only queries** - Data consumption

---

## Summary

| Module | Primary Purpose | Key Tables | Main Integrations |
|--------|----------------|-----------|-------------------|
| Item Master | Master data | items | All modules (FK) |
| Inventory | Stock tracking | inventory, stock_movements | All modules (reads) |
| Forecasting | Demand prediction | demand_forecasts, demand_history | Planning (feeds) |
| Planning | MRP calculation | planning_recommendations | Forecasting, Inventory |
| Blanket Orders | Customer contracts | blanket_orders, blanket_order_lines | Releases |
| Blanket Releases | Delivery execution | blanket_releases | Inventory (auto-update) |
| Stock Movements | Audit trail | stock_movements | Inventory (updates) |
| Dashboard | KPIs & alerts | (reads all) | All (visualization) |

---

This document must be reviewed and understood by all engineers working on the system.
