# 📦 Enterprise Multi-Warehouse Inventory Management System

## Database Architecture Documentation

**Version:** 1.0.0  
**Author:** Database Architecture Team  
**Last Updated:** 2026-02-06

---

## 📋 Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Philosophy](#architecture-philosophy)
3. [Schema Overview](#schema-overview)
4. [Tables Deep Dive](#tables-deep-dive)
5. [Views Deep Dive](#views-deep-dive)
6. [Functions & Stored Procedures](#functions--stored-procedures)
7. [Data Flow Diagrams](#data-flow-diagrams)
8. [Net Available Calculation](#net-available-calculation)
9. [Performance Optimizations](#performance-optimizations)
10. [Security & RLS](#security--rls)
11. [Migration Guide](#migration-guide)
12. [Best Practices](#best-practices)

---

## 📊 Executive Summary

The **Enterprise Multi-Warehouse Inventory Management Extension** transforms the existing single-warehouse inventory system into a globally-distributed, multi-location inventory management solution. This extension maintains full backward compatibility while introducing:

- **Multi-warehouse stock tracking** across Production, In-Transit, S&V, US Transit, and Distribution centers
- **Lot/Batch traceability** for quality control and regulatory compliance
- **Real-time Net Available** calculations incorporating blanket release reservations
- **Full audit trail** via an append-only stock ledger
- **Approval workflows** for controlled stock movements
- **Optimistic concurrency control** for transactional safety

### Key Business Benefits

| Benefit | Description |
|---------|-------------|
| **Global Visibility** | See stock levels across all warehouses in real-time |
| **Accurate ATP** | Net Available considers all reservations and in-transit stock |
| **Traceability** | Every stock movement is recorded with full context |
| **Compliance Ready** | Lot/batch tracking meets regulatory requirements |
| **Scalable** | Designed to handle millions of stock transactions |

---

## 🏗️ Architecture Philosophy

### Design Principles

1. **Additive Evolution**: No breaking changes to existing tables. All new tables use the `inv_` prefix.

2. **Data Integrity First**: Use of constraints, triggers, and enums to prevent invalid data states.

3. **Audit Everything**: The stock ledger is append-only - history is never modified.

4. **Denormalize for Read Performance**: Views pre-calculate complex aggregations for fast frontend queries.

5. **Security by Default**: Row-Level Security (RLS) enabled on all tables.

### Table Naming Convention

| Prefix | Purpose |
|--------|---------|
| `inv_` | All new inventory extension tables |
| `vw_` | View for frontend consumption |
| `fn_` | Function for API endpoints |

---

## 📐 Schema Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MASTER DATA LAYER                                 │
├─────────────────────────────────────────────────────────────────────┤
│  inv_warehouse_types    │  inv_warehouses     │  inv_reason_codes   │
│  (Type definitions)      │  (Physical locations) │  (Movement reasons)  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    TRANSACTIONAL LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│  inv_warehouse_stock    │  inv_movement_headers │ inv_movement_lines │
│  (Current balances)      │  (Movement documents)   │ (Movement details)   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      AUDIT LAYER                                     │
├─────────────────────────────────────────────────────────────────────┤
│  inv_stock_ledger                                                   │
│  (Immutable transaction history - append only)                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    INTEGRATION LAYER                                 │
├─────────────────────────────────────────────────────────────────────┤
│  inv_blanket_release_stock  │  inv_approvals  │  inv_reference_docs │
│  (Links to blanket orders)    │  (Approval workflow) │  (External docs)      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📑 Tables Deep Dive

### 1. `inv_warehouse_types` - Warehouse Type Master

**Purpose:** Defines the categories of warehouses in the supply chain. Each warehouse must belong to exactly one type.

**Why This Design:**
- Separates warehouse classification from warehouse instances
- Allows adding new warehouse types without schema changes
- Enables category-based reporting and stock calculations

```sql
CREATE TABLE inv_warehouse_types (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    type_code VARCHAR(20) NOT NULL UNIQUE,     -- e.g., 'SNV', 'PROD', 'INTRANS'
    type_name VARCHAR(100) NOT NULL,            -- Display name
    category warehouse_category NOT NULL,       -- Enum: PRODUCTION, IN_TRANSIT, SNV, etc.
    description TEXT,
    is_transit_point BOOLEAN DEFAULT false,     -- Stock here is "in motion"
    is_production_site BOOLEAN DEFAULT false,   -- Can produce finished goods
    can_ship_external BOOLEAN DEFAULT false,    -- Can ship to customers
    sort_order INTEGER DEFAULT 0,               -- Display ordering
    is_active BOOLEAN DEFAULT true
);
```

**Warehouse Categories (Enum):**

| Category | Description | Available for Sale? |
|----------|-------------|---------------------|
| `PRODUCTION` | Manufacturing floor | ❌ No |
| `IN_TRANSIT` | Between warehouses | ⚠️ Partial |
| `SNV` | S&V (Sales & Verification) | ✅ Yes |
| `US_TRANSIT` | US-based transit hub | ✅ Yes |
| `DISTRIBUTION` | Regional distribution center | ✅ Yes |
| `QUARANTINE` | Quality hold | ❌ No |
| `RETURNS` | Customer returns | ❌ No |

**Seeded Data:**
- `PROD` - Production Warehouse
- `INTRANS` - In-Transit Warehouse  
- `SNV` - S&V Warehouse
- `USTRANS` - US Transit Warehouse
- `DIST` - Distribution Center
- `RETURN` - Returns Warehouse
- `QUAR` - Quarantine Warehouse

---

### 2. `inv_warehouses` - Warehouse Master

**Purpose:** Represents physical or logical warehouse locations where inventory is stored.

**Why This Design:**
- Supports global operations with country/region/city hierarchy
- Hierarchical warehouses via `parent_warehouse_id` (e.g., zones within a facility)
- Manager assignment for operational accountability
- Capacity tracking for warehouse utilization

```sql
CREATE TABLE inv_warehouses (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_code VARCHAR(20) NOT NULL UNIQUE,  -- Business identifier
    warehouse_name VARCHAR(100) NOT NULL,
    warehouse_type_id uuid NOT NULL REFERENCES inv_warehouse_types(id),
    country_code VARCHAR(3) NOT NULL,            -- ISO country code
    region VARCHAR(50),
    city VARCHAR(100),
    address TEXT,
    postal_code VARCHAR(20),
    timezone VARCHAR(50) DEFAULT 'UTC',
    manager_user_id uuid REFERENCES profiles(id),
    parent_warehouse_id uuid REFERENCES inv_warehouses(id),  -- Self-reference
    capacity_units INTEGER,                       -- Max storage capacity
    current_utilization_pct NUMERIC(5,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    is_deleted BOOLEAN DEFAULT false              -- Soft delete
);
```

**Example Warehouses:**

| Code | Name | Type | Country | Purpose |
|------|------|------|---------|---------|
| `WH-SNV-MAIN` | Main S&V Warehouse | SNV | IND | Primary shipping location |
| `WH-US-TRANSIT` | US Transit Warehouse | USTRANS | USA | US distribution hub |
| `WH-INTRANSIT` | In Transit Storage | INTRANS | - | Virtual transit location |
| `WH-PROD-FLOOR` | Production Floor | PROD | IND | Manufacturing output |

---

### 3. `inv_warehouse_stock` - Multi-Warehouse Inventory Balance

**Purpose:** The core inventory table that tracks stock quantities per warehouse, per item, with optional lot/batch tracking.

**Why This Design:**
- **Per-warehouse tracking**: Each row represents stock of one item in one warehouse
- **Lot/Batch support**: Optional tracking for industries requiring traceability
- **Computed column**: `quantity_available` is auto-calculated, preventing inconsistencies
- **Optimistic locking**: `row_version` prevents concurrent update conflicts

```sql
CREATE TABLE inv_warehouse_stock (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id uuid NOT NULL REFERENCES inv_warehouses(id),
    item_code VARCHAR NOT NULL REFERENCES items(item_code),
    lot_number VARCHAR(50),              -- Optional lot tracking
    batch_number VARCHAR(50),            -- Optional batch tracking
    serial_number VARCHAR(100),          -- Optional serial tracking
    
    -- Quantity Breakdown
    quantity_on_hand INTEGER NOT NULL DEFAULT 0,      -- Physical count
    quantity_allocated INTEGER NOT NULL DEFAULT 0,    -- Assigned to orders
    quantity_reserved INTEGER NOT NULL DEFAULT 0,     -- Held for future
    quantity_in_transit INTEGER NOT NULL DEFAULT 0,   -- Coming from transfers
    
    -- Auto-calculated: Available = OnHand - Allocated - Reserved
    quantity_available INTEGER GENERATED ALWAYS AS (
        quantity_on_hand - quantity_allocated - quantity_reserved
    ) STORED,
    
    -- Valuation
    unit_cost NUMERIC(18,4),
    
    -- Tracking Dates
    last_receipt_date TIMESTAMPTZ,
    last_issue_date TIMESTAMPTZ,
    expiry_date DATE,
    manufacture_date DATE,
    
    -- Quality & Location
    quality_status VARCHAR(20) DEFAULT 'GOOD',
    storage_location VARCHAR(50),
    bin_number VARCHAR(20),
    
    -- Concurrency Control
    row_version INTEGER DEFAULT 1,
    
    CONSTRAINT qty_positive CHECK (quantity_on_hand >= 0),
    CONSTRAINT available_positive CHECK (quantity_available >= 0)
);

-- Unique index for composite key (handles NULL values properly)
CREATE UNIQUE INDEX idx_inv_warehouse_stock_unique 
    ON inv_warehouse_stock (
        warehouse_id, 
        item_code, 
        COALESCE(lot_number, ''), 
        COALESCE(batch_number, '')
    );
```

**Quantity Relationship:**

```
┌────────────────────────────────────────────────────────────────┐
│                    quantity_on_hand (Physical Stock)            │
├────────────────────┬───────────────────┬───────────────────────┤
│  quantity_allocated │  quantity_reserved │ quantity_available   │
│  (Committed to      │  (Held for future  │  (Free to sell)      │
│   current orders)   │   demand)          │                      │
└────────────────────┴───────────────────┴───────────────────────┘

Formula: quantity_available = quantity_on_hand - quantity_allocated - quantity_reserved
```

---

### 4. `inv_stock_ledger` - Immutable Stock Transaction History

**Purpose:** Append-only audit trail capturing every stock movement with full context. This table is **never updated or deleted** - only INSERT operations are allowed.

**Why This Design:**
- **Regulatory compliance**: Full traceability for audits
- **Point-in-time queries**: Can reconstruct stock at any historical date
- **Immutability**: Uses INSERT-only RLS policy
- **Reference linking**: Connects to source documents (blanket releases, transfers, etc.)

```sql
CREATE TABLE inv_stock_ledger (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    ledger_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    warehouse_id uuid NOT NULL REFERENCES inv_warehouses(id),
    item_code VARCHAR NOT NULL REFERENCES items(item_code),
    lot_number VARCHAR(50),
    batch_number VARCHAR(50),
    
    -- Transaction Details
    transaction_type stock_transaction_type NOT NULL,  -- Enum
    transaction_id uuid,
    transaction_number VARCHAR(50),
    
    -- Quantity Change
    quantity_change INTEGER NOT NULL,      -- +/- change amount
    quantity_before INTEGER NOT NULL,      -- Stock before
    quantity_after INTEGER NOT NULL,       -- Stock after
    
    -- Valuation
    unit_cost NUMERIC(18,4),
    total_value NUMERIC(18,4),
    
    -- Reference Document
    reference_type VARCHAR(30),            -- e.g., 'BLANKET_RELEASE'
    reference_id uuid,
    reference_number VARCHAR(50),
    
    -- Transfer Details
    source_warehouse_id uuid REFERENCES inv_warehouses(id),
    destination_warehouse_id uuid REFERENCES inv_warehouses(id),
    
    -- Audit
    reason_code VARCHAR(20),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by uuid
);
```

**Transaction Types (Enum):**

| Type | Direction | Description |
|------|-----------|-------------|
| `RECEIPT` | ➕ IN | Stock received from production/purchase |
| `ISSUE` | ➖ OUT | Stock issued for consumption |
| `TRANSFER_OUT` | ➖ OUT | Stock leaving for another warehouse |
| `TRANSFER_IN` | ➕ IN | Stock arriving from another warehouse |
| `ADJUSTMENT_PLUS` | ➕ IN | Inventory adjustment (increase) |
| `ADJUSTMENT_MINUS` | ➖ OUT | Inventory adjustment (decrease) |
| `BLANKET_RELEASE` | ➖ OUT | Stock shipped for blanket order |
| `RETURN` | ➕ IN | Customer return |
| `SCRAP` | ➖ OUT | Write-off |
| `CYCLE_COUNT` | ±️ | Physical count adjustment |

---

### 5. `inv_movement_headers` & `inv_movement_lines` - Stock Movement Documents

**Purpose:** Formal document structure for stock movements that require approval, planning, or documentation.

**Why Two Tables:**
- **Header/Line pattern**: Standard for transactional documents
- **Approval workflow**: Header contains approval status
- **Partial execution**: Lines can be processed independently
- **Document reference**: Links to external documents (POs, shipments, etc.)

```sql
-- HEADER: Document-level information
CREATE TABLE inv_movement_headers (
    id uuid PRIMARY KEY,
    movement_number VARCHAR(30) NOT NULL UNIQUE,   -- Auto-generated
    movement_date DATE NOT NULL,
    movement_type VARCHAR(30) NOT NULL,             -- TRANSFER, ADJUSTMENT, etc.
    source_warehouse_id uuid REFERENCES inv_warehouses(id),
    destination_warehouse_id uuid REFERENCES inv_warehouses(id),
    status movement_status NOT NULL DEFAULT 'DRAFT',
    approval_status approval_status DEFAULT 'PENDING',
    priority VARCHAR(10) DEFAULT 'NORMAL',
    
    -- Reference to source document
    reference_document_type VARCHAR(30),
    reference_document_id uuid,
    
    -- Workflow tracking
    requested_by uuid NOT NULL REFERENCES profiles(id),
    requested_at TIMESTAMPTZ,
    approved_by uuid REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,
    completed_by uuid,
    completed_at TIMESTAMPTZ
);

-- LINES: Item-level details
CREATE TABLE inv_movement_lines (
    id uuid PRIMARY KEY,
    header_id uuid NOT NULL REFERENCES inv_movement_headers(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    item_code VARCHAR NOT NULL REFERENCES items(item_code),
    lot_number VARCHAR(50),
    batch_number VARCHAR(50),
    requested_quantity INTEGER NOT NULL,
    approved_quantity INTEGER,             -- May differ from requested
    actual_quantity INTEGER,               -- What was actually moved
    unit_cost NUMERIC(18,4),
    line_status VARCHAR(20) DEFAULT 'PENDING',
    UNIQUE (header_id, line_number)
);
```

**Movement Status Workflow:**

```
DRAFT → PENDING_APPROVAL → APPROVED → IN_PROGRESS → COMPLETED
                  ↓                           ↓
              REJECTED                   CANCELLED
```

---

### 6. `inv_approvals` - Multi-Level Approval Workflow

**Purpose:** Implements flexible, multi-level approval routing for stock movements and adjustments.

**Why This Design:**
- **Multi-level**: Supports sequential approval chains (L1 → L2 → L3)
- **Role-based**: Approver assigned by role, not just user
- **Escalation**: Overdue approvals can escalate
- **Entity-agnostic**: Can approve any entity type

```sql
CREATE TABLE inv_approvals (
    id uuid PRIMARY KEY,
    entity_type VARCHAR(30) NOT NULL,     -- 'MOVEMENT', 'ADJUSTMENT', etc.
    entity_id uuid NOT NULL,              -- ID of the entity being approved
    approval_level INTEGER NOT NULL DEFAULT 1,
    approval_sequence INTEGER NOT NULL DEFAULT 1,
    approver_role VARCHAR(10) NOT NULL,   -- 'L1', 'L2', 'L3'
    approver_user_id uuid REFERENCES profiles(id),
    status approval_status NOT NULL DEFAULT 'PENDING',
    comments TEXT,
    approved_at TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    escalated_to uuid REFERENCES profiles(id),
    escalated_at TIMESTAMPTZ,
    UNIQUE (entity_type, entity_id, approval_level, approval_sequence)
);
```

---

### 7. `inv_blanket_release_stock` - Blanket Order Integration

**Purpose:** Links blanket release shipments to actual stock deductions, providing traceability from customer order to inventory.

**Why This Design:**
- **Validation**: Ensures stock exists before release
- **Traceability**: Links release → stock → ledger
- **Status tracking**: Pending → Validated → Released
- **Supports FIFO**: Can specify lot for expiry-based allocation

```sql
CREATE TABLE inv_blanket_release_stock (
    id uuid PRIMARY KEY,
    release_id uuid NOT NULL REFERENCES blanket_releases(id),
    warehouse_id uuid NOT NULL REFERENCES inv_warehouses(id),
    item_code VARCHAR NOT NULL REFERENCES items(item_code),
    lot_number VARCHAR(50),
    batch_number VARCHAR(50),
    quantity_released INTEGER NOT NULL,
    stock_ledger_id uuid REFERENCES inv_stock_ledger(id),  -- Links to audit
    release_status VARCHAR(20) DEFAULT 'PENDING',
    validated_at TIMESTAMPTZ,
    validated_by uuid,
    released_at TIMESTAMPTZ,
    released_by uuid,
    CONSTRAINT qty_positive CHECK (quantity_released > 0)
);
```

---

### 8. `inv_reason_codes` - Movement Reason Standardization

**Purpose:** Provides standardized reason codes for stock movements, enabling consistent reporting and potential approval requirements.

```sql
CREATE TABLE inv_reason_codes (
    id uuid PRIMARY KEY,
    reason_code VARCHAR(20) NOT NULL UNIQUE,   -- e.g., 'DAMAGE', 'CYCLE_CNT'
    reason_category VARCHAR(30) NOT NULL,       -- RECEIPT, ISSUE, ADJUSTMENT, TRANSFER
    description VARCHAR(200) NOT NULL,
    requires_approval BOOLEAN DEFAULT false,    -- Some reasons need approval
    is_active BOOLEAN DEFAULT true
);
```

**Seeded Reason Codes:**

| Code | Category | Description | Approval Required |
|------|----------|-------------|-------------------|
| `PROD_RECV` | RECEIPT | Production receipt | ❌ |
| `PURCH_RECV` | RECEIPT | Purchase order receipt | ❌ |
| `RETURN_RECV` | RECEIPT | Customer return receipt | ✅ |
| `SALES_OUT` | ISSUE | Sales order shipment | ❌ |
| `DAMAGE` | ADJUSTMENT | Damage write-off | ✅ |
| `SCRAP` | ADJUSTMENT | Scrap write-off | ✅ |
| `CYCLE_CNT` | ADJUSTMENT | Cycle count adjustment | ✅ |

---

## 👁️ Views Deep Dive

### View 1: `vw_item_stock_distribution`

**Purpose:** The master view that pivots warehouse stock by category and calculates Net Available.

**Key Calculations:**

```sql
-- Net Available = S&V Available + US Transit Available + In Transit - Next Month Reserved
net_available_for_customer = 
    snv_available + 
    us_transit_available + 
    in_transit_available - 
    blanket_next_month_reserved

-- Warehouse Available = All customer-facing warehouses
warehouse_available = snv_available + us_transit_available + distribution_available
```

**Output Columns:**
- `item_code`, `item_name`, `part_number`, `master_serial_no`, `revision`, `uom`
- `production_on_hand`, `production_available`, `production_reserved`
- `in_transit_qty`, `in_transit_available`
- `snv_on_hand`, `snv_available`, `snv_reserved`, `snv_allocated`
- `us_transit_on_hand`, `us_transit_available`, `us_transit_reserved`
- `distribution_on_hand`, `distribution_available`
- `quarantine_qty`, `returns_qty`
- `blanket_pending_qty`, `blanket_next_month_reserved`
- `net_available_for_customer`, `warehouse_available`, `total_customer_reserved`

---

### View 2: `vw_item_stock_dashboard`

**Purpose:** Simplified view optimized for the frontend dashboard UI cards.

**Used By:** InventoryGrid component, StockDistributionCard

**Output Columns:**
- Item identifiers: `item_code`, `item_name`, `part_number`, `master_serial_no`, `revision`
- Dashboard metrics: `warehouse_available`, `warehouse_reserved`, `in_transit_quantity`, `production_finished_stock`, `net_available_for_customer`
- Calculation details: `snv_stock`, `us_transit_stock`, `in_transit_stock`, `reserved_next_month`
- Display helpers: `calculation_formula`, `stock_status` (CRITICAL/LOW/MEDIUM/HEALTHY)
- Totals: `total_on_hand`, `total_available`, `quality_hold_qty`

---

### View 3: `vw_item_warehouse_detail`

**Purpose:** Drill-down view showing stock in each specific warehouse with lot/batch details.

**Use Case:** When user clicks "View" on an item in the grid, shows breakdown by warehouse.

---

### View 4: `vw_item_stock_summary`

**Purpose:** Grid summary view with health indicators for the main inventory listing.

---

### View 5: `vw_blanket_release_reservations`

**Purpose:** Shows pending blanket release reservations categorized by delivery timing.

**Time Categories:**
- `OVERDUE` - Past due date
- `CURRENT_MONTH` - Due this month
- `NEXT_MONTH` - Due next month (impacts Net Available)
- `FUTURE` - Beyond next month

---

### View 6: `vw_recent_stock_movements`

**Purpose:** Transaction history from the ledger for movement display.

---

## ⚙️ Functions & Stored Procedures

### `inv_validate_stock_for_release()`

Validates if sufficient stock exists before allowing a blanket release.

```sql
SELECT inv_validate_stock_for_release(
    'warehouse-uuid',
    'ITEM-001',
    100,           -- quantity needed
    'LOT-123'      -- optional lot
);
-- Returns: TRUE or FALSE
```

### `inv_execute_blanket_release()`

Executes a full stock deduction for a blanket release in a single transaction:
1. Validates stock availability
2. Locks the stock record
3. Deducts quantity
4. Creates ledger entry
5. Creates release-stock link record
6. Returns the release stock ID

---

## 📈 Net Available Calculation

The **Net Available for Customer** is the key metric showing how much stock can actually be sold:

```
┌─────────────────────────────────────────────────────────────────┐
│                   NET AVAILABLE FORMULA                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   NET AVAILABLE = S&V Available                                  │
│                 + US Transit Available                           │
│                 + In Transit Available                           │
│                 − Next Month Blanket Reserved                    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│   EXCLUDES:                                                      │
│   • Production stock (not yet transferred)                       │
│   • Quarantine stock (quality hold)                              │
│   • Already allocated stock                                      │
│   • Already reserved stock                                       │
│   • Returns (needs inspection)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Performance Optimizations

### Indexes Created

| Index | Table | Purpose |
|-------|-------|---------|
| `idx_inv_warehouses_type` | inv_warehouses | Fast type filtering |
| `idx_inv_warehouse_stock_wh` | inv_warehouse_stock | Warehouse queries |
| `idx_inv_warehouse_stock_item` | inv_warehouse_stock | Item queries |
| `idx_inv_warehouse_stock_avail` | inv_warehouse_stock | Available stock filter |
| `idx_inv_stock_ledger_wh_item` | inv_stock_ledger | Movement history |
| `idx_inv_stock_ledger_date` | inv_stock_ledger | Date range queries |
| `idx_inv_approvals_pending` | inv_approvals | Pending approval queue |
| `idx_blanket_releases_delivery_date` | blanket_releases | Next month calculation |

---

## 🔒 Security & RLS

All tables have Row-Level Security enabled:

```sql
-- Read access for authenticated users
CREATE POLICY "Auth read inv_warehouse_stock" 
    ON inv_warehouse_stock 
    FOR SELECT TO authenticated USING (true);

-- Write access controlled by application
CREATE POLICY "Auth modify inv_warehouse_stock" 
    ON inv_warehouse_stock 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Ledger is INSERT-ONLY (no updates/deletes for audit integrity)
CREATE POLICY "Auth insert inv_stock_ledger" 
    ON inv_stock_ledger 
    FOR INSERT TO authenticated WITH CHECK (true);
```

---

## 📝 Migration Guide

### Step 1: Run Extension Script
```sql
-- Creates all tables, triggers, indexes, RLS policies
\i inventory_extension.sql
```

### Step 2: Run Views Script
```sql
-- Creates all frontend views and functions
\i inventory_views.sql
```

### Step 3: Run View Update (for item details)
```sql
-- Adds part_number, master_serial_no, revision to views
\i inventory_views_update.sql
```

### Step 4: Insert Sample Data (Development Only)
```sql
-- Populates warehouses and sample stock for testing
\i inventory_sample_data.sql
```

---

## ✅ Best Practices

### DO:
- ✅ Always use `inv_execute_blanket_release()` for stock deductions
- ✅ Include `row_version` in updates for optimistic locking
- ✅ Use reason codes for all adjustments
- ✅ Filter by `is_active = true` and `is_deleted = false`
- ✅ Query views instead of base tables for frontend

### DON'T:
- ❌ Never UPDATE or DELETE from `inv_stock_ledger`
- ❌ Don't bypass RLS with service role for normal operations
- ❌ Don't allow negative `quantity_on_hand`
- ❌ Don't skip approval workflow for controlled movements
- ❌ Don't hardcode warehouse IDs in application code

---

## 📊 Entity Relationship Diagram

```
┌──────────────────┐     ┌──────────────────┐
│ inv_warehouse_   │────<│ inv_warehouses   │
│ types            │     │                  │
└──────────────────┘     └────────┬─────────┘
                                  │
                                  │
                         ┌────────▼─────────┐
                         │ inv_warehouse_   │
                         │ stock            │
                         └────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
     ┌────────▼────────┐ ┌────────▼────────┐ ┌────────▼────────┐
     │ inv_stock_      │ │ inv_movement_   │ │ inv_blanket_    │
     │ ledger          │ │ headers/lines   │ │ release_stock   │
     └─────────────────┘ └─────────────────┘ └─────────────────┘
                                  │
                         ┌────────▼────────┐
                         │ inv_approvals   │
                         └─────────────────┘
```

---

## 📞 Support

For questions about this schema design, contact the Database Architecture Team.

**Related Files:**
- `inventory_extension.sql` - Core tables and triggers
- `inventory_views.sql` - Frontend views
- `inventory_views_update.sql` - Item detail additions
- `inventory_sample_data.sql` - Development seed data
