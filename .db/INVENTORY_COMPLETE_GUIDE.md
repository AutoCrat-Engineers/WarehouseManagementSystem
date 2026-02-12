# 📦 Complete Inventory System Guide
## Warehouse Management System - Database Architecture

**Written For:** Developers, DBAs, and Technical Team Members  
**Language:** Simple Indian English  
**Last Updated:** 2026-02-07  
**Prepared By:** Solution Architecture Team

---

## 📌 Quick Summary - What Is This System?

This is a **Multi-Warehouse Inventory Management System**. In simple words:
- We track stock (items/products) across **multiple warehouse locations**
- We know exactly **kya available hai, kya reserved hai, kya transit mein hai**
- Every stock movement is recorded - **full history maintained**
- When customer orders ke liye stock nikalna hai, system will tell if sufficient stock hai ya nahi

---

## 📊 Table of Contents

1. [All Tables - Complete List](#1-all-tables---complete-list)
2. [Table-wise Detailed Explanation](#2-table-wise-detailed-explanation)
3. [All Views - Complete List](#3-all-views---complete-list)
4. [View-wise Detailed Explanation](#4-view-wise-detailed-explanation)
5. [How Tables Are Connected (Relationships)](#5-how-tables-are-connected-relationships)
6. [Stock Movement - Which Tables Get Updated](#6-stock-movement---which-tables-get-updated)
7. [Stock Addition/Deduction - Flow Diagram](#7-stock-additiondeduction---flow-diagram)
8. [Complete Data Flow](#8-complete-data-flow)
9. [Common Queries - What Information Can We Pull](#9-common-queries---what-information-can-we-pull)
10. [FAQs - Common Doubts](#10-faqs---common-doubts)

---

## 1. All Tables - Complete List

### 📋 New Inventory Tables (inv_ prefix)

| Serial No | Table Name | Simple Description |
|-----------|------------|-------------------|
| 1 | `inv_warehouse_types` | Types of warehouses (Production, S&V, Transit, etc.) |
| 2 | `inv_warehouses` | Actual warehouse locations (Chennai, US Hub, etc.) |
| 3 | `inv_warehouse_stock` | **MAIN TABLE** - Stock quantity in each warehouse |
| 4 | `inv_stock_ledger` | History of all stock movements (like bank statement) |
| 5 | `inv_movement_headers` | Stock transfer documents (header info) |
| 6 | `inv_movement_lines` | Stock transfer documents (item details) |
| 7 | `inv_approvals` | Approval records for movements |
| 8 | `inv_reason_codes` | Why stock was moved (damage, sale, transfer, etc.) |
| 9 | `inv_blanket_release_stock` | Links blanket order releases to stock deductions |
| 10 | `inv_reference_documents` | External document references |

### 📋 Existing Related Tables

| Serial No | Table Name | Simple Description |
|-----------|------------|-------------------|
| 1 | `items` | Master list of all products/items |
| 2 | `inventory` | Old single-warehouse stock (legacy) |
| 3 | `blanket_orders` | Customer blanket/annual orders |
| 4 | `blanket_order_items` | Items in blanket orders |
| 5 | `blanket_order_lines` | Line details of blanket orders |
| 6 | `blanket_releases` | Individual releases from blanket orders |
| 7 | `stock_movements` | Old movement history (legacy) |

---

## 2. Table-wise Detailed Explanation

### 📦 Table 1: `inv_warehouse_types`

**Simple Explanation:**  
Yeh table batata hai ki hamare paas **kitne type ke warehouses hai**. Jaise school mein different sections hote hai (Science, Commerce, Arts), waise hi warehouses ke types hai.

**Why We Need This Table:**
- Different warehouses have different purposes
- Some can ship to customers, some cannot
- Some are for production, some for storage
- This helps us categorize warehouses

**What Information We Store:**

| Column Name | Meaning | Example |
|-------------|---------|---------|
| `id` | Unique identifier | abc123-uuid |
| `type_code` | Short code | PROD, SNV, INTRANS |
| `type_name` | Full name | Production Warehouse |
| `category` | Category type | PRODUCTION, IN_TRANSIT, SNV |
| `description` | What it is for | Manufacturing floor warehouse |
| `is_transit_point` | Is it for transit? | Yes/No |
| `is_production_site` | Manufacturing happens here? | Yes/No |
| `can_ship_external` | Can ship to customers? | Yes/No |
| `sort_order` | Display order | 1, 2, 3, etc. |
| `is_active` | Active ya band hai? | Yes/No |

**Pre-loaded Warehouse Types:**

| Type Code | Type Name | Can Ship to Customer? | Purpose |
|-----------|-----------|----------------------|---------|
| `PROD` | Production Warehouse | ❌ No | Where items are manufactured |
| `INTRANS` | In-Transit Warehouse | ⚠️ Limited | Items moving between locations |
| `SNV` | S&V Warehouse | ✅ Yes | Main shipping warehouse |
| `USTRANS` | US Transit Warehouse | ✅ Yes | US-based storage point |
| `DIST` | Distribution Center | ✅ Yes | Regional distribution |
| `RETURN` | Returns Warehouse | ❌ No | Customer returns go here |
| `QUAR` | Quarantine Warehouse | ❌ No | Quality hold items |

**What We Can Pull From This Table:**
```sql
-- Get all active warehouse types
SELECT type_code, type_name, can_ship_external 
FROM inv_warehouse_types 
WHERE is_active = true;

-- Count warehouses by type
SELECT type_name, COUNT(*) as warehouse_count
FROM inv_warehouses w
JOIN inv_warehouse_types wt ON w.warehouse_type_id = wt.id
GROUP BY type_name;
```

---

### 📦 Table 2: `inv_warehouses`

**Simple Explanation:**  
Yeh table mein **actual warehouse locations** ka data hai. Jaise type code "SNV" hai, par actual warehouse "Chennai S&V Warehouse" hai - that detail is here.

**Why We Need This Table:**
- Store physical location details
- Track which manager handles which warehouse
- Know country/city for each warehouse
- Link each warehouse to its type

**What Information We Store:**

| Column Name | Meaning | Example |
|-------------|---------|---------|
| `id` | Unique identifier | uuid |
| `warehouse_code` | Business code | WH-SNV-MAIN |
| `warehouse_name` | Full name | Main S&V Warehouse |
| `warehouse_type_id` | Links to type table | Points to inv_warehouse_types |
| `country_code` | Country | IND, USA |
| `region` | Region/State | Tamil Nadu |
| `city` | City | Chennai |
| `address` | Full address | 123 Industrial Park |
| `timezone` | Time zone | UTC, IST |
| `manager_user_id` | Who manages | Links to profiles table |
| `parent_warehouse_id` | Parent warehouse (if any) | For zones within warehouse |
| `capacity_units` | Max storage capacity | 10000 units |
| `current_utilization_pct` | How full is it? | 65.5% |

**Current Warehouses:**

| Code | Name | Type | Location | Purpose |
|------|------|------|----------|---------|
| `WH-SNV-MAIN` | Main S&V Warehouse | SNV | Chennai, India | Main shipping point |
| `WH-US-TRANSIT` | US Transit Warehouse | USTRANS | Houston, USA | US distribution |
| `WH-INTRANSIT` | In Transit Storage | INTRANS | Various | Virtual transit location |
| `WH-PROD-FLOOR` | Production Floor | PROD | Chennai, India | Manufacturing output |

**What We Can Pull:**
```sql
-- Get all warehouse details with type
SELECT 
    w.warehouse_code,
    w.warehouse_name,
    wt.type_name,
    w.city,
    w.country_code
FROM inv_warehouses w
JOIN inv_warehouse_types wt ON w.warehouse_type_id = wt.id
WHERE w.is_active = true;

-- Find warehouse by country
SELECT * FROM inv_warehouses WHERE country_code = 'IND';
```

---

### 📦 Table 3: `inv_warehouse_stock` ⭐ (MOST IMPORTANT TABLE)

**Simple Explanation:**  
Yeh table batata hai **kis warehouse mein kaunsa item kitna hai**. Jaise bank account balance dikhata hai kitna paisa hai, yeh table dikhata hai kitna stock hai.

**Why We Need This Table:**
- Track exact quantity in each warehouse
- Know what is available to sell
- Know what is reserved for future orders
- Know what is allocated to current orders
- Track lot/batch for quality control

**What Information We Store:**

| Column Name | Meaning | Example |
|-------------|---------|---------|
| `id` | Unique identifier | uuid |
| `warehouse_id` | Which warehouse | Links to inv_warehouses |
| `item_code` | Which item | PROD-001 |
| `lot_number` | Lot tracking | LOT-2026-001 |
| `batch_number` | Batch tracking | BATCH-A1 |
| `serial_number` | Serial (if applicable) | SN-123456 |
| `quantity_on_hand` | **Total physical stock** | 500 |
| `quantity_allocated` | Given to current orders | 50 |
| `quantity_reserved` | Held for future orders | 100 |
| `quantity_in_transit` | Coming from other warehouse | 25 |
| `quantity_available` | **Free to sell** | 350 (auto-calculated) |
| `unit_cost` | Cost per unit | 150.00 |
| `expiry_date` | When it expires | 2026-12-31 |
| `quality_status` | Quality check status | GOOD, HOLD, REJECT |
| `storage_location` | Rack/Shelf location | AISLE-A-RACK-5 |
| `bin_number` | Bin number | BIN-001 |
| `row_version` | For concurrency control | 1, 2, 3 (increments) |

**🎯 Understanding the Quantities:**

```
┌─────────────────────────────────────────────────────────────┐
│           QUANTITY ON HAND (Total Physical Stock)            │
│                        = 500 units                           │
├─────────────────┬─────────────────┬────────────────────────┤
│   ALLOCATED     │    RESERVED     │     AVAILABLE          │
│   (50 units)    │   (100 units)   │    (350 units)         │
│                 │                 │                        │
│  Given to       │  Held for       │  Free to sell          │
│  current orders │  blanket orders │  right now             │
└─────────────────┴─────────────────┴────────────────────────┘

FORMULA: Available = On Hand - Allocated - Reserved
         350       = 500      - 50        - 100
```

**What Each Quantity Means:**

| Quantity | Simple Meaning | Example |
|----------|---------------|---------|
| `quantity_on_hand` | Total stock physically present | 500 boxes in warehouse |
| `quantity_allocated` | Promised to current running orders | 50 boxes for today's shipment |
| `quantity_reserved` | Kept aside for future blanket releases | 100 boxes for next month's order |
| `quantity_in_transit` | Coming from another warehouse | 25 boxes arriving tomorrow |
| `quantity_available` | What we can promise to new customers | 350 boxes we can sell |

**What We Can Pull:**
```sql
-- Stock of specific item across all warehouses
SELECT 
    w.warehouse_name,
    ws.quantity_on_hand,
    ws.quantity_available,
    ws.quantity_reserved
FROM inv_warehouse_stock ws
JOIN inv_warehouses w ON ws.warehouse_id = w.id
WHERE ws.item_code = 'PROD-001';

-- Total available stock across company
SELECT 
    item_code,
    SUM(quantity_on_hand) as total_on_hand,
    SUM(quantity_available) as total_available
FROM inv_warehouse_stock
GROUP BY item_code;

-- Low stock items
SELECT item_code, warehouse_id, quantity_available
FROM inv_warehouse_stock
WHERE quantity_available < 50;
```

---

### 📦 Table 4: `inv_stock_ledger` (History Table - APPEND ONLY)

**Simple Explanation:**  
Yeh table hai **stock movements ki diary**. Jaise bank passbook mein har transaction recorded hota hai, waise har stock movement yahan record hota hai. **This table is never updated or deleted** - only new entries are added.

**Why We Need This Table:**
- Complete audit trail of all stock changes
- Trace back what happened to any item
- Calculate stock at any past date
- Regulatory compliance and audits
- Find out who did what and when

**What Information We Store:**

| Column Name | Meaning | Example |
|-------------|---------|---------|
| `id` | Unique identifier | uuid |
| `ledger_date` | When movement happened | 2026-02-07 10:30:00 |
| `warehouse_id` | Which warehouse | Links to inv_warehouses |
| `item_code` | Which item | PROD-001 |
| `lot_number` | Lot if applicable | LOT-2026-001 |
| `transaction_type` | What type of movement | RECEIPT, ISSUE, TRANSFER |
| `quantity_change` | How much changed | +50 or -30 |
| `quantity_before` | Stock before movement | 500 |
| `quantity_after` | Stock after movement | 550 |
| `reference_type` | What caused this | BLANKET_RELEASE, MANUAL |
| `reference_id` | Link to source document | uuid of release |
| `reference_number` | Document number | REL-2026-001 |
| `source_warehouse_id` | From where (transfers) | uuid |
| `destination_warehouse_id` | To where (transfers) | uuid |
| `reason_code` | Why this happened | DAMAGE, SALE, TRANSFER |
| `notes` | Additional comments | Free text |
| `created_by` | Who did this | User ID |

**Transaction Types:**

| Type | Direction | Meaning |
|------|-----------|---------|
| `RECEIPT` | ➕ PLUS | Stock received (production/purchase) |
| `ISSUE` | ➖ MINUS | Stock issued (consumption) |
| `TRANSFER_OUT` | ➖ MINUS | Stock sent to another warehouse |
| `TRANSFER_IN` | ➕ PLUS | Stock received from another warehouse |
| `ADJUSTMENT_PLUS` | ➕ PLUS | Correction (found extra) |
| `ADJUSTMENT_MINUS` | ➖ MINUS | Correction (found less) |
| `BLANKET_RELEASE` | ➖ MINUS | Shipped for blanket order |
| `RETURN` | ➕ PLUS | Customer return received |
| `SCRAP` | ➖ MINUS | Written off as scrap |
| `CYCLE_COUNT` | ±️ BOTH | Physical count adjustment |

**What We Can Pull:**
```sql
-- All movements for an item today
SELECT 
    ledger_date,
    transaction_type,
    quantity_change,
    quantity_before,
    quantity_after,
    notes
FROM inv_stock_ledger
WHERE item_code = 'PROD-001'
  AND ledger_date >= CURRENT_DATE
ORDER BY ledger_date DESC;

-- Summary of movements by type
SELECT 
    transaction_type,
    COUNT(*) as count,
    SUM(quantity_change) as total_qty
FROM inv_stock_ledger
WHERE ledger_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY transaction_type;

-- Find who made stock adjustments
SELECT 
    sl.*,
    p.full_name as user_name
FROM inv_stock_ledger sl
JOIN profiles p ON sl.created_by = p.id
WHERE sl.transaction_type IN ('ADJUSTMENT_PLUS', 'ADJUSTMENT_MINUS');
```

---

### 📦 Table 5 & 6: `inv_movement_headers` + `inv_movement_lines`

**Simple Explanation:**  
Jab stock ek warehouse se dusre mein transfer karna hai, toh ek **official document** banta hai. Header mein overall info hai, Lines mein item-wise detail hai.

**Why Two Tables (Header + Lines):**
- One movement can have many items
- Header has common info (date, warehouses, approval)
- Lines have item-specific info (qty, lot)
- This is standard document pattern

**Header Table - What We Store:**

| Column Name | Meaning | Example |
|-------------|---------|---------|
| `movement_number` | Document number | MOV2602-00001 |
| `movement_date` | Date of movement | 2026-02-07 |
| `movement_type` | Type | TRANSFER, ADJUSTMENT |
| `source_warehouse_id` | From where | uuid |
| `destination_warehouse_id` | To where | uuid |
| `status` | Current status | DRAFT, APPROVED, COMPLETED |
| `approval_status` | Approval status | PENDING, APPROVED |
| `requested_by` | Who requested | User ID |
| `approved_by` | Who approved | User ID |

**Lines Table - What We Store:**

| Column Name | Meaning | Example |
|-------------|---------|---------|
| `header_id` | Links to header | uuid |
| `line_number` | Line number | 1, 2, 3 |
| `item_code` | Which item | PROD-001 |
| `lot_number` | Lot if applicable | LOT-001 |
| `requested_quantity` | How much to move | 100 |
| `approved_quantity` | Approved qty | 100 |
| `actual_quantity` | Actually moved | 100 |
| `line_status` | Status | PENDING, COMPLETED |

**Movement Status Flow:**
```
DRAFT → PENDING_APPROVAL → APPROVED → IN_PROGRESS → COMPLETED
             ↓                              ↓
         REJECTED                       CANCELLED
```

---

### 📦 Table 7: `inv_approvals`

**Simple Explanation:**  
Jab koi stock movement ko approval chahiye, toh approval ka record yahan aata hai. Multiple level approval supported hai (L1 → L2 → L3).

**What We Store:**

| Column Name | Meaning |
|-------------|---------|
| `entity_type` | What needs approval (MOVEMENT, ADJUSTMENT) |
| `entity_id` | ID of that entity |
| `approval_level` | Level 1, 2, 3 |
| `approver_role` | L1, L2, L3 |
| `status` | PENDING, APPROVED, REJECTED |
| `comments` | Approver comments |

---

### 📦 Table 8: `inv_reason_codes`

**Simple Explanation:**  
Standardized reasons for stock movements. Ensures everyone uses same codes.

**Pre-loaded Reason Codes:**

| Code | Category | Description | Needs Approval? |
|------|----------|-------------|-----------------|
| `PROD_RECV` | RECEIPT | Production receipt | ❌ No |
| `PURCH_RECV` | RECEIPT | Purchase order receipt | ❌ No |
| `RETURN_RECV` | RECEIPT | Customer return | ✅ Yes |
| `SALES_OUT` | ISSUE | Sales shipment | ❌ No |
| `DAMAGE` | ADJUSTMENT | Damage write-off | ✅ Yes |
| `SCRAP` | ADJUSTMENT | Scrap write-off | ✅ Yes |
| `CYCLE_CNT` | ADJUSTMENT | Cycle count | ✅ Yes |

---

### 📦 Table 9: `inv_blanket_release_stock`

**Simple Explanation:**  
Jab blanket order ka release hota hai aur stock nikalta hai, toh yeh table link karta hai ki kaunsa release se kaunsa stock gaya.

**Why We Need This:**
- Track which release consumed which stock
- Validate stock before release
- Link release → stock → ledger entry
- Complete traceability

**What We Store:**

| Column Name | Meaning |
|-------------|---------|
| `release_id` | Links to blanket_releases |
| `warehouse_id` | From which warehouse |
| `item_code` | Which item |
| `quantity_released` | How much was taken |
| `stock_ledger_id` | Links to ledger entry |
| `release_status` | PENDING, VALIDATED, RELEASED |

---

## 3. All Views - Complete List

**What is a View?**  
View is like a pre-made report. Instead of writing complex SQL every time, view does it for us. Jaise Excel mein formula lagake summary banate ho, waise hi views hai.

| Serial | View Name | Simple Purpose |
|--------|-----------|----------------|
| 1 | `vw_item_stock_distribution` | Stock breakup by warehouse type |
| 2 | `vw_item_stock_dashboard` | Dashboard cards data |
| 3 | `vw_item_warehouse_detail` | Detailed stock per warehouse |
| 4 | `vw_item_stock_summary` | Grid listing summary |
| 5 | `vw_blanket_release_reservations` | Pending blanket releases |
| 6 | `vw_recent_stock_movements` | Movement history |
| 7 | `vw_inv_warehouse_stock_summary` | Internal stock summary |
| 8 | `vw_inv_pending_approvals` | Pending approvals list |

---

## 4. View-wise Detailed Explanation

### 👁️ View 1: `vw_item_stock_distribution` (Master View)

**Simple Explanation:**  
Yeh view **ek item ka stock sab jagah kahan kahan hai** yeh dikhata hai. Ek row mein poori picture mil jati hai.

**What Information We Get:**

| Column | Meaning |
|--------|---------|
| `item_code` | Item code |
| `item_name` | Item name |
| `part_number` | Part number |
| `master_serial_no` | MSN number |
| `production_on_hand` | Stock in production |
| `in_transit_qty` | Stock moving between warehouses |
| `snv_on_hand` | Stock in S&V warehouse |
| `snv_available` | Available in S&V |
| `snv_reserved` | Reserved in S&V |
| `us_transit_on_hand` | Stock in US Transit |
| `distribution_on_hand` | Stock in Distribution |
| `quarantine_qty` | Stock in quality hold |
| `blanket_next_month_reserved` | Reserved for next month |
| `net_available_for_customer` | **FINAL: What we can sell** |

**Net Available Calculation:**
```
Net Available = S&V Available 
              + US Transit Available 
              + In Transit Available 
              - Next Month Reserved

Example:
Net Available = 200 + 50 + 30 - 80 = 200 units
```

---

### 👁️ View 2: `vw_item_stock_dashboard`

**Simple Explanation:**  
Frontend dashboard ke cards ke liye data. Simple numbers for display.

**What Information We Get:**

| Column | Meaning | Used For |
|--------|---------|----------|
| `warehouse_available` | Available in customer-facing warehouses | Warehouse Card |
| `warehouse_reserved` | Reserved qty | Warehouse Card |
| `in_transit_quantity` | In transit stock | In Transit Card |
| `production_finished_stock` | Ready stock in production | Production Card |
| `net_available_for_customer` | Final sellable qty | Net Available Card |
| `stock_status` | CRITICAL/LOW/MEDIUM/HEALTHY | Color coding |
| `calculation_formula` | Shows formula used | Tooltip |

**Stock Status Logic:**
```
If net_available < 0      → CRITICAL (Red)
If net_available < 50     → LOW (Orange)
If net_available < 200    → MEDIUM (Yellow)
Else                      → HEALTHY (Green)
```

---

### 👁️ View 3: `vw_item_warehouse_detail`

**Simple Explanation:**  
Jab user item pe click karta hai aur detail dekhna hai, toh yeh view use hota hai. Shows stock **per warehouse with lot/batch details**.

**What Information We Get:**
- Item details (code, name, part number)
- Warehouse details (code, name, type, city)
- Stock quantities (on_hand, allocated, reserved, available)
- Location details (storage location, bin number)
- Dates (last receipt, last issue, expiry)
- Values (unit cost, total value)

---

### 👁️ View 4: `vw_item_stock_summary`

**Simple Explanation:**  
Main inventory grid ke liye. All items with summary metrics.

**What Information We Get:**
- Production stock
- In transit stock
- Warehouse stock (combined)
- Available quantity
- Reserved quantity
- Quality hold qty
- Net available
- Availability percentage
- Health indicator (success/warning/danger)

---

### 👁️ View 5: `vw_blanket_release_reservations`

**Simple Explanation:**  
Pending blanket releases ko dikhata hai with timing categories.

**Time Categories:**

| Category | Meaning |
|----------|---------|
| `OVERDUE` | Past delivery date |
| `CURRENT_MONTH` | Due this month |
| `NEXT_MONTH` | Due next month (affects Net Available) |
| `FUTURE` | Beyond next month |

---

### 👁️ View 6: `vw_recent_stock_movements`

**Simple Explanation:**  
Stock movement history for display. Shows what happened, when, and who did it.

---

## 5. How Tables Are Connected (Relationships)

```
┌──────────────────────────────────────────────────────────────────────┐
│                         TABLE RELATIONSHIPS                           │
└──────────────────────────────────────────────────────────────────────┘

                        ┌─────────────────┐
                        │     items       │
                        │ (Master Items)  │
                        └────────┬────────┘
                                 │
                                 │ item_code
                                 ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│inv_warehouse_   │───▶│  inv_warehouse_     │◀───│                 │
│    types        │    │      stock          │    │     (other)     │
│                 │    │  (MAIN STOCK TABLE) │    │                 │
└────────┬────────┘    └──────────┬──────────┘    └─────────────────┘
         │                        │
         │                        │
         │ warehouse_type_id      │ warehouse_id
         ▼                        ▼
┌─────────────────┐    ┌─────────────────────┐
│ inv_warehouses  │◀───│  inv_stock_ledger   │
│                 │    │  (Movement History) │
└────────┬────────┘    └──────────┬──────────┘
         │                        │
         │                        │
         ▼                        ▼
┌─────────────────┐    ┌─────────────────────┐
│ inv_movement_   │───▶│ inv_movement_lines  │
│    headers      │    │                     │
└────────┬────────┘    └─────────────────────┘
         │
         │
         ▼
┌─────────────────┐    ┌─────────────────────┐
│ inv_approvals   │    │ inv_reason_codes    │
└─────────────────┘    └─────────────────────┘


┌─────────────────────────────────────────────────────────────────────┐
│                     BLANKET ORDER INTEGRATION                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│ blanket_orders  │───▶│ blanket_order_lines │    │ blanket_releses │
│                 │    │                     │───▶│                 │
└─────────────────┘    └─────────────────────┘    └────────┬────────┘
                                                           │
                                                           │ release_id
                                                           ▼
                                                  ┌─────────────────────┐
                                                  │inv_blanket_release_ │
                                                  │       stock         │
                                                  └──────────┬──────────┘
                                                             │
                                                          links to
                                                             │
                                           ┌─────────────────┴─────────────────┐
                                           ▼                                   ▼
                                  ┌─────────────────┐               ┌─────────────────┐
                                  │inv_warehouse_   │               │inv_stock_ledger │
                                  │     stock       │               │                 │
                                  └─────────────────┘               └─────────────────┘
```

---

## 6. Stock Movement - Which Tables Get Updated

### 🔄 Scenario 1: Stock Receipt (Production/Purchase)

**Situation:** 100 units of PROD-001 received in S&V Warehouse from production.

**Tables Updated:**

| Table | What Happens |
|-------|--------------|
| `inv_warehouse_stock` | `quantity_on_hand` increases by 100 |
| `inv_stock_ledger` | New row with `RECEIPT`, +100 |

```sql
-- inv_warehouse_stock
UPDATE: quantity_on_hand = quantity_on_hand + 100
        last_receipt_date = NOW()

-- inv_stock_ledger (INSERT)
INSERT: transaction_type = 'RECEIPT'
        quantity_change = +100
        quantity_before = 400
        quantity_after = 500
```

---

### 🔄 Scenario 2: Stock Transfer (Warehouse to Warehouse)

**Situation:** 50 units of PROD-001 transferred from S&V to US Transit.

**Tables Updated:**

| Table | What Happens |
|-------|--------------|
| `inv_movement_headers` | New movement document created |
| `inv_movement_lines` | Item line added |
| `inv_approvals` | Approval record (if required) |
| `inv_warehouse_stock` (Source) | `quantity_on_hand` decreases |
| `inv_warehouse_stock` (Dest) | `quantity_on_hand` increases |
| `inv_stock_ledger` | TWO rows: TRANSFER_OUT and TRANSFER_IN |

```sql
-- Source warehouse (S&V)
inv_warehouse_stock: quantity_on_hand = quantity_on_hand - 50
inv_stock_ledger: transaction_type = 'TRANSFER_OUT', qty_change = -50

-- Destination warehouse (US Transit)
inv_warehouse_stock: quantity_on_hand = quantity_on_hand + 50
inv_stock_ledger: transaction_type = 'TRANSFER_IN', qty_change = +50
```

---

### 🔄 Scenario 3: Blanket Release Shipment

**Situation:** Customer order release - ship 30 units of PROD-001.

**Tables Updated:**

| Table | What Happens |
|-------|--------------|
| `blanket_releases` | Status updated, delivered_quantity increased |
| `inv_warehouse_stock` | `quantity_on_hand` decreases |
| `inv_stock_ledger` | New row with `BLANKET_RELEASE` |
| `inv_blanket_release_stock` | New row linking release to stock |

```sql
-- inv_warehouse_stock
UPDATE: quantity_on_hand = quantity_on_hand - 30
        quantity_reserved = quantity_reserved - 30 (if was reserved)
        last_issue_date = NOW()

-- inv_stock_ledger (INSERT)
INSERT: transaction_type = 'BLANKET_RELEASE'
        quantity_change = -30
        reference_type = 'BLANKET_RELEASE'
        reference_id = release_id

-- inv_blanket_release_stock (INSERT)
INSERT: release_id = xxx
        quantity_released = 30
        stock_ledger_id = ledger_entry_id
```

---

### 🔄 Scenario 4: Stock Adjustment (Damage/Scrap)

**Situation:** 10 units damaged, need to write off.

**Tables Updated:**

| Table | What Happens |
|-------|--------------|
| `inv_movement_headers` | Adjustment document (if formal) |
| `inv_approvals` | Approval needed (damage requires approval) |
| `inv_warehouse_stock` | `quantity_on_hand` decreases |
| `inv_stock_ledger` | New row with `ADJUSTMENT_MINUS` |

---

### 🔄 Scenario 5: Reserve Stock for Future Order

**Situation:** Customer places blanket order for next month - reserve 100 units.

**Tables Updated:**

| Table | What Happens |
|-------|--------------|
| `inv_warehouse_stock` | `quantity_reserved` increases |

```sql
-- inv_warehouse_stock
UPDATE: quantity_reserved = quantity_reserved + 100
-- Note: quantity_on_hand stays same
-- But quantity_available = on_hand - allocated - reserved
-- So available DECREASES automatically
```

---

## 7. Stock Addition/Deduction - Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STOCK ADDITION FLOW                               │
└─────────────────────────────────────────────────────────────────────┘

   ┌─────────────┐
   │ User Action │
   │  (Add Stock)│
   └──────┬──────┘
          │
          ▼
   ┌─────────────────────┐
   │ Validate:           │
   │ - Item exists?      │
   │ - Warehouse valid?  │
   │ - Quantity > 0?     │
   └──────┬──────────────┘
          │
          ▼
   ┌─────────────────────┐
   │ Get Current Stock   │
   │ inv_warehouse_stock │
   │ (with row lock)     │
   └──────┬──────────────┘
          │
          ▼
   ┌─────────────────────┐
   │ Update Stock        │
   │ quantity_on_hand    │
   │ += new quantity     │
   └──────┬──────────────┘
          │
          ▼
   ┌─────────────────────┐
   │ Create Ledger Entry │
   │ inv_stock_ledger    │
   │ (RECEIPT)           │
   └──────┬──────────────┘
          │
          ▼
   ┌─────────────────────┐
   │ Commit Transaction  │
   │ (All or Nothing)    │
   └─────────────────────┘


┌─────────────────────────────────────────────────────────────────────┐
│                    STOCK DEDUCTION FLOW                              │
└─────────────────────────────────────────────────────────────────────┘

   ┌─────────────┐
   │ User Action │
   │(Deduct Stock│
   └──────┬──────┘
          │
          ▼
   ┌─────────────────────┐
   │ Validate:           │
   │ - Item exists?      │
   │ - Sufficient stock? │
   │ - Reason code?      │
   └──────┬──────────────┘
          │
          ▼
   ┌─────────────────────┐     ┌─────────────────────┐
   │ Approval Required?  │─Yes─▶│ Create Approval    │
   │ (Check reason code) │     │ inv_approvals      │
   └──────┬──────────────┘     └──────────┬──────────┘
          │ No                            │
          ▼                               │
   ┌─────────────────────┐                │
   │ Lock Stock Record   │◀───────────────┘
   │ inv_warehouse_stock │      (After approval)
   │ (SELECT FOR UPDATE) │
   └──────┬──────────────┘
          │
          ▼
   ┌─────────────────────┐
   │ Check Available >=  │
   │ Requested Quantity  │
   └──────┬──────────────┘
          │
          ▼
   ┌─────────────────────┐
   │ Deduct Stock        │
   │ quantity_on_hand    │
   │ -= quantity         │
   └──────┬──────────────┘
          │
          ▼
   ┌─────────────────────┐
   │ Create Ledger Entry │
   │ inv_stock_ledger    │
   │ (ISSUE/BLANKET_REL) │
   └──────┬──────────────┘
          │
          ▼
   ┌─────────────────────┐
   │ Commit Transaction  │
   └─────────────────────┘
```

---

## 8. Complete Data Flow

### 🔄 Complete Flow: From Production to Customer

```
Step 1: PRODUCTION COMPLETE
        └─▶ inv_warehouse_stock (PROD warehouse) - quantity_on_hand increases
        └─▶ inv_stock_ledger - RECEIPT entry

Step 2: TRANSFER TO S&V WAREHOUSE
        └─▶ inv_movement_headers - Transfer document created
        └─▶ inv_movement_lines - Item details
        └─▶ inv_warehouse_stock (PROD) - quantity_on_hand decreases
        └─▶ inv_warehouse_stock (S&V) - quantity_on_hand increases
        └─▶ inv_stock_ledger - TRANSFER_OUT and TRANSFER_IN entries

Step 3: CUSTOMER BLANKET ORDER RECEIVED
        └─▶ blanket_orders - Order created
        └─▶ blanket_order_lines - Items added
        └─▶ inv_warehouse_stock - quantity_reserved increases

Step 4: RELEASE CREATED
        └─▶ blanket_releases - Release created with delivery date

Step 5: SHIPMENT EXECUTED
        └─▶ blanket_releases - Status updated to SHIPPED
        └─▶ inv_warehouse_stock - quantity_on_hand decreases
        └─▶ inv_warehouse_stock - quantity_reserved decreases
        └─▶ inv_stock_ledger - BLANKET_RELEASE entry
        └─▶ inv_blanket_release_stock - Link record created
```

---

## 9. Common Queries - What Information Can We Pull

### 📊 Query 1: Item Stock Across All Warehouses
```sql
SELECT 
    i.item_code,
    i.item_name,
    w.warehouse_name,
    ws.quantity_on_hand,
    ws.quantity_available,
    ws.quantity_reserved
FROM inv_warehouse_stock ws
JOIN inv_warehouses w ON ws.warehouse_id = w.id
JOIN items i ON ws.item_code = i.item_code
WHERE i.item_code = 'PROD-001'
ORDER BY w.warehouse_name;
```

### 📊 Query 2: Total Stock Summary by Item
```sql
SELECT * FROM vw_item_stock_dashboard;
```

### 📊 Query 3: Low Stock Alert
```sql
SELECT 
    item_code,
    net_available_for_customer,
    stock_status
FROM vw_item_stock_dashboard
WHERE stock_status IN ('CRITICAL', 'LOW')
ORDER BY net_available_for_customer;
```

### 📊 Query 4: Stock Movement History
```sql
SELECT 
    ledger_date,
    transaction_type,
    quantity_change,
    quantity_after,
    notes
FROM inv_stock_ledger
WHERE item_code = 'PROD-001'
ORDER BY ledger_date DESC
LIMIT 50;
```

### 📊 Query 5: Pending Blanket Releases
```sql
SELECT * FROM vw_blanket_release_reservations
WHERE delivery_period = 'NEXT_MONTH';
```

### 📊 Query 6: Warehouse Utilization
```sql
SELECT 
    w.warehouse_name,
    COUNT(ws.id) as item_count,
    SUM(ws.quantity_on_hand) as total_stock,
    SUM(ws.quantity_available) as available_stock
FROM inv_warehouses w
LEFT JOIN inv_warehouse_stock ws ON ws.warehouse_id = w.id
GROUP BY w.warehouse_name;
```

### 📊 Query 7: Stock Value by Warehouse
```sql
SELECT 
    w.warehouse_name,
    SUM(ws.quantity_on_hand * COALESCE(ws.unit_cost, 0)) as total_value
FROM inv_warehouse_stock ws
JOIN inv_warehouses w ON ws.warehouse_id = w.id
GROUP BY w.warehouse_name
ORDER BY total_value DESC;
```

---

## 10. FAQs - Common Doubts

### ❓ Q1: Why do we have both `inventory` and `inv_warehouse_stock` tables?

**Answer:**  
- `inventory` is the OLD table - single warehouse only
- `inv_warehouse_stock` is the NEW table - multi-warehouse support
- We keep both for backward compatibility
- New features use `inv_warehouse_stock`

---

### ❓ Q2: What is the difference between `allocated` and `reserved`?

**Answer:**
| Allocated | Reserved |
|-----------|----------|
| For CURRENT running orders | For FUTURE planned orders |
| Already committed | Soft hold for blanket orders |
| Will ship soon | May not ship this month |

---

### ❓ Q3: Why is `inv_stock_ledger` append-only?

**Answer:**
- **Audit compliance** - regulators may need history
- **Cannot tamper** - no one can change past records
- **Point-in-time queries** - can calculate stock at any past date
- **Investigation** - if something wrong, can trace back

---

### ❓ Q4: How is `quantity_available` calculated?

**Answer:**
```
quantity_available = quantity_on_hand 
                   - quantity_allocated 
                   - quantity_reserved

Example:
On Hand = 500
Allocated = 50
Reserved = 100
Available = 500 - 50 - 100 = 350
```

This is a **GENERATED column** - automatically calculated by database.

---

### ❓ Q5: What happens if someone tries to deduct more than available?

**Answer:**
- Trigger `inv_check_stock_balance` will REJECT the transaction
- Error message: "Stock quantity cannot be negative"
- Transaction will ROLLBACK
- No partial updates

---

### ❓ Q6: How to find stock at a specific past date?

**Answer:**
```sql
-- Calculate stock as of a specific date
SELECT 
    item_code,
    SUM(quantity_change) as stock_as_of_date
FROM inv_stock_ledger
WHERE item_code = 'PROD-001'
  AND warehouse_id = 'your-warehouse-id'
  AND ledger_date <= '2026-01-15'
GROUP BY item_code;
```

---

### ❓ Q7: Which tables get affected when blanket release is shipped?

**Answer:**
1. `blanket_releases` - delivered_quantity updated
2. `inv_warehouse_stock` - quantity_on_hand reduced
3. `inv_stock_ledger` - BLANKET_RELEASE entry
4. `inv_blanket_release_stock` - link record created

---

### ❓ Q8: What is `row_version` used for?

**Answer:**
- **Optimistic concurrency control**
- Prevents two users from updating same record simultaneously
- Version increments on every update
- If versions don't match, transaction fails

---

## 📚 Glossary

| Term | Hindi/Simple Meaning |
|------|---------------------|
| On-Hand | Physical stock present in warehouse |
| Available | Stock that can be sold/promised |
| Allocated | Stock assigned to current orders |
| Reserved | Stock kept for future orders |
| In-Transit | Stock moving between locations |
| Ledger | History record (like passbook) |
| FIFO | First In First Out - oldest stock goes first |
| Lot | Group of items made together |
| Batch | Production batch number |
| RLS | Row Level Security |
| Trigger | Automatic action on database event |

---

## 📞 Support

For technical questions about this schema:
- Refer to: `.db/inventory_extension.sql`
- Views: `.db/inventory_views.sql`, `.db/inventory_views_update.sql`
- Sample Data: `.db/inventory_sample_data.sql`

---

**Document Version:** 2.0  
**Created:** 2026-02-07  
**Author:** Solution Architecture Team
