# 🏭 Warehouse Stock Attributes Guide

## Understanding Stock Attributes by Warehouse Type

**Version:** 1.0.0  
**Last Updated:** 2026-02-06  
**Author:** Enterprise Database Architecture Team

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Warehouse Types in the System](#warehouse-types-in-the-system)
3. [Stock Attributes by Warehouse](#stock-attributes-by-warehouse)
   - [S&V (Main Warehouse)](#sv-main-warehouse)
   - [Production Warehouse](#production-warehouse)
   - [In Transit](#in-transit)
   - [US Transit Warehouse](#us-transit-warehouse)
   - [Distribution Warehouse](#distribution-warehouse)
   - [Special Warehouses](#special-warehouses-quarantine--returns)
4. [Attribute Summary Matrix](#attribute-summary-matrix)
5. [Stock Flow Between Warehouses](#stock-flow-between-warehouses)
6. [Calculated Totals & Aggregations](#calculated-totals--aggregations)
7. [View Reference: vw_item_stock_distribution](#view-reference-vw_item_stock_distribution)
8. [Finding Exact Stock Information](#finding-exact-stock-information)
9. [Why Different Warehouses Have Different Attributes](#why-different-warehouses-have-different-attributes)

---

## 🎯 Overview

Your system tracks inventory across **multiple warehouse types**, each serving a different purpose in the supply chain. Different warehouses track different stock attributes based on their operational role.

### Key Warehouse Prefixes

| Prefix | Warehouse | Purpose |
|--------|-----------|---------|
| `snv_` | **S&V** | Main warehouse - primary storage and order fulfillment |
| `production_` | **Production** | Manufacturing floor - finished goods awaiting transfer |
| `in_transit_` | **In Transit** | Virtual location for goods being moved between warehouses |
| `us_transit_` | **US Transit** | US-based transit hub for faster US deliveries |
| `distribution_` | **Distribution** | Regional distribution centers |
| `quarantine_` | **Quarantine** | Stock under quality hold |
| `returns_` | **Returns** | Customer returns awaiting inspection |

---

## 🏢 Warehouse Types in the System

### Warehouse Category Classification

| Category | Type Code | Can Ship to Customers? | Purpose |
|----------|-----------|------------------------|---------|
| `SNV` | SNV | ✅ Yes | Main warehouse for order fulfillment |
| `PRODUCTION` | PROD | ❌ No | Manufacturing output storage |
| `IN_TRANSIT` | INTRANS | ⚠️ Partial | Goods in movement |
| `US_TRANSIT` | USTRANS | ✅ Yes | US distribution hub |
| `DISTRIBUTION` | DIST | ✅ Yes | Regional fulfillment centers |
| `QUARANTINE` | QUAR | ❌ No | Quality hold items |
| `RETURNS` | RETURN | ❌ No | Customer returns |

---

## 📊 Stock Attributes by Warehouse

---

### 🏢 S&V (Main Warehouse)

> **Your primary warehouse** where inventory is stored and orders are fulfilled.

#### Attributes Available

| Attribute | Column Name | Description |
|-----------|-------------|-------------|
| **On Hand** | `snv_on_hand` | Total physical stock in the S&V warehouse |
| **Available** | `snv_available` | Stock free to sell (not committed) |
| **Reserved** | `snv_reserved` | Stock held for future orders (blanket releases, schedules) |
| **Allocated** | `snv_allocated` | Stock assigned to active orders being processed |

#### Quantity Formula

```
snv_available = snv_on_hand - snv_allocated - snv_reserved
```

#### Why S&V Has All Four Attributes

S&V is your **main operational warehouse** where:
- 📦 Orders are **picked and packed** → needs `allocated`
- 📅 Future orders are **planned** → needs `reserved`
- 📊 Full inventory tracking → needs `on_hand` and `available`

#### Visual Breakdown

```
┌──────────────────────────────────────────────────────────────┐
│                 S&V ON HAND (Total Physical)                  │
├────────────────┬─────────────────┬───────────────────────────┤
│   ALLOCATED    │    RESERVED     │        AVAILABLE          │
│                │                 │                           │
│ Active orders: │ Future orders:  │ Free to sell:             │
│ • Being picked │ • Blanket order │ • New orders              │
│ • Being packed │ • Next month    │ • Can transfer            │
│ • Ready ship   │ • Scheduled     │ • Not committed           │
└────────────────┴─────────────────┴───────────────────────────┘
```

#### Example

```
Item: WIDGET-001 in S&V Warehouse

snv_on_hand:     1000 units (physically in warehouse)
snv_allocated:    200 units (5 orders being packed)
snv_reserved:     300 units (blanket release next month)
──────────────────────────────────────────────────────
snv_available:    500 units ← Can promise to new customers
```

---

### 🏭 Production Warehouse

> **Manufacturing facility** where finished goods are produced and stored before transfer.

#### Attributes Available

| Attribute | Column Name | Description |
|-----------|-------------|-------------|
| **On Hand** | `production_on_hand` | Total finished goods at production facility |
| **Available** | `production_available` | Stock ready to transfer out of production |
| **Reserved** | `production_reserved` | Stock reserved/set aside (e.g., quality testing) |

#### Quantity Formula

```
production_available = production_on_hand - production_reserved
```

#### Key Points

- ❌ **No `allocated`** because orders are not fulfilled directly from production
- 🚫 Production stock is **NOT included** in net available for customers
- 📦 Stock must be **transferred** to S&V or Distribution before it can be sold

#### Visual Breakdown

```
┌──────────────────────────────────────────────────────────────┐
│            PRODUCTION ON HAND (Finished Goods)                │
├─────────────────────────────┬────────────────────────────────┤
│         RESERVED            │          AVAILABLE             │
│                             │                                │
│ • Quality testing           │ • Ready to transfer            │
│ • Held for inspection       │ • Can move to S&V              │
│ • Set aside                 │ • Waiting for shipment order   │
└─────────────────────────────┴────────────────────────────────┘
```

#### Example

```
Item: WIDGET-001 in Production

production_on_hand:     800 units (finished manufacturing)
production_reserved:    100 units (quality hold/testing)
────────────────────────────────────────────────────────
production_available:   700 units ← Ready to transfer to S&V
```

#### Why Production Stock Isn't Sellable

```
Production → Transfer → S&V → Customer

Stock at production has NOT completed this flow yet!
```

---

### 🚚 In Transit

> **Virtual location** representing stock that is currently being moved between warehouses.

#### Attributes Available

| Attribute | Column Name | Description |
|-----------|-------------|-------------|
| **Quantity** | `in_transit_qty` | Total quantity of stock currently in transit |
| **Available** | `in_transit_available` | In-transit stock that's available (not pre-allocated) |

#### Key Points

- 🚛 Represents **goods in shipment** between locations
- ⚠️ Stock is counted in net available but with **caution** (delivery pending)
- ❌ No `on_hand` because it's not physically at a warehouse
- ❌ No `allocated` or `reserved` because allocation happens at destination

#### Visual Breakdown

```
┌──────────────────────────────────────────────────────────────┐
│                    IN TRANSIT QUANTITY                        │
│                                                              │
│    [===== Truck/Ship ====>]                                  │
│                                                              │
│  • Left source warehouse                                     │
│  • Not yet at destination                                    │
│  • ETA tracking available                                    │
│  • Counts toward available (with delivery risk)              │
└──────────────────────────────────────────────────────────────┘
```

#### Example

```
Item: WIDGET-001 In Transit

in_transit_qty:       200 units (on truck/ship)
in_transit_available: 200 units ← All can be promised (with ETA disclaimer)

Route: Production India → S&V Warehouse
ETA: 3-5 business days
```

---

### 🇺🇸 US Transit Warehouse

> **US-based transit hub** for faster delivery to US customers.

#### Attributes Available

| Attribute | Column Name | Description |
|-----------|-------------|-------------|
| **On Hand** | `us_transit_on_hand` | Total physical stock at US transit location |
| **Available** | `us_transit_available` | Stock free to sell from US location |
| **Reserved** | `us_transit_reserved` | Stock reserved for future US orders |

#### Quantity Formula

```
us_transit_available = us_transit_on_hand - us_transit_reserved
```

#### Key Points

- ✅ Stock here **CAN ship directly** to US customers
- ✅ Included in net available calculation
- 🚀 Faster delivery for US orders (already in-country)
- ❌ No `allocated` because picking may happen at partner facility

#### Visual Breakdown

```
┌──────────────────────────────────────────────────────────────┐
│             US TRANSIT ON HAND (In United States)             │
├─────────────────────────────┬────────────────────────────────┤
│         RESERVED            │          AVAILABLE             │
│                             │                                │
│ • US blanket orders         │ • Ready for US customers       │
│ • Scheduled US deliveries   │ • Can ship within USA          │
│ • US customer commitments   │ • Fast fulfillment             │
└─────────────────────────────┴────────────────────────────────┘
```

#### Example

```
Item: WIDGET-001 at US Transit

us_transit_on_hand:     500 units (at US warehouse)
us_transit_reserved:    100 units (reserved for US customer)
──────────────────────────────────────────────────────────────
us_transit_available:   400 units ← Available for new US orders
```

---

### 📦 Distribution Warehouse

> **Regional distribution centers** for local deliveries.

#### Attributes Available

| Attribute | Column Name | Description |
|-----------|-------------|-------------|
| **On Hand** | `distribution_on_hand` | Total physical stock at distribution centers |
| **Available** | `distribution_available` | Stock free to sell from distribution |

#### Key Points

- ✅ Can ship directly to customers
- ✅ Included in `warehouse_available` calculation
- 📍 Multiple distribution centers may exist
- Simplified tracking (no reserved/allocated breakdown)

#### Example

```
Item: WIDGET-001 at Distribution Centers

distribution_on_hand:     300 units (across all DCs)
distribution_available:   300 units ← All available for orders
```

---

### 🚨 Special Warehouses (Quarantine & Returns)

> **Holding areas** for stock that cannot be sold.

#### Quarantine Warehouse

| Attribute | Column Name | Description |
|-----------|-------------|-------------|
| **Quantity** | `quarantine_qty` | Stock under quality hold |

**Purpose:**
- 🔬 Stock pending quality inspection
- ⚠️ Suspected defects or damage
- 📋 Regulatory hold
- ❌ **NOT available for sale**

#### Returns Warehouse

| Attribute | Column Name | Description |
|-----------|-------------|-------------|
| **Quantity** | `returns_qty` | Customer returns pending processing |

**Purpose:**
- 📦 Returned items from customers
- 🔍 Needs inspection before resale
- 🔄 May be restocked, scrapped, or refurbished
- ❌ **NOT available for sale** until processed

---

## 📋 Attribute Summary Matrix

### Complete Attribute Coverage by Warehouse

| Warehouse | on_hand | available | reserved | allocated | qty/in_transit |
|-----------|:-------:|:---------:|:--------:|:---------:|:--------------:|
| **S&V** (Main) | ✅ `snv_on_hand` | ✅ `snv_available` | ✅ `snv_reserved` | ✅ `snv_allocated` | ❌ |
| **Production** | ✅ `production_on_hand` | ✅ `production_available` | ✅ `production_reserved` | ❌ | ❌ |
| **In Transit** | ❌ | ✅ `in_transit_available` | ❌ | ❌ | ✅ `in_transit_qty` |
| **US Transit** | ✅ `us_transit_on_hand` | ✅ `us_transit_available` | ✅ `us_transit_reserved` | ❌ | ❌ |
| **Distribution** | ✅ `distribution_on_hand` | ✅ `distribution_available` | ❌ | ❌ | ❌ |
| **Quarantine** | ❌ | ❌ | ❌ | ❌ | ✅ `quarantine_qty` |
| **Returns** | ❌ | ❌ | ❌ | ❌ | ✅ `returns_qty` |

### Legend

- ✅ = Attribute tracked for this warehouse
- ❌ = Not tracked (not applicable to this warehouse type)

---

## 🔄 Stock Flow Between Warehouses

### Typical Stock Journey

```
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│   PRODUCTION    │───────▶│   IN TRANSIT    │───────▶│      S&V        │
│                 │        │                 │        │ (Main Warehouse)│
│ production_     │        │ in_transit_     │        │ snv_            │
│ on_hand: 800    │        │ qty: 200        │        │ on_hand: 1000   │
│ available: 700  │        │ available: 200  │        │ available: 500  │
│ reserved: 100   │        │                 │        │ reserved: 300   │
│                 │        │                 │        │ allocated: 200  │
└─────────────────┘        └─────────────────┘        └────────┬────────┘
                                                               │
         ┌─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐        ┌─────────────────┐
│  US TRANSIT     │        │  DISTRIBUTION   │
│                 │        │                 │
│ us_transit_     │        │ distribution_   │
│ on_hand: 500    │        │ on_hand: 300    │
│ available: 400  │        │ available: 300  │
│ reserved: 100   │        │                 │
└─────────────────┘        └─────────────────┘
```

### Transfer Flow Example

```
Step 1: Goods manufactured at Production
        production_on_hand: +500

Step 2: Transfer initiated to S&V
        production_on_hand: -500
        in_transit_qty: +500

Step 3: Goods received at S&V
        in_transit_qty: -500
        snv_on_hand: +500
```

---

## 📐 Calculated Totals & Aggregations

### Aggregate Columns in Views

| Column | Formula | Description |
|--------|---------|-------------|
| `warehouse_available` | `snv_available + us_transit_available + distribution_available` | Total available across **all selling warehouses** |
| `net_available_for_customer` | `snv_available + us_transit_available + in_transit_available - blanket_next_month_reserved` | **True sellable stock** for new orders |
| `total_customer_reserved` | Sum of all reserved quantities | Total stock committed to customers |
| `total_on_hand` | Sum of all on_hand quantities | Total physical stock everywhere |
| `total_available` | Sum of all available quantities | Total available everywhere |

### Net Available Calculation Detail

```
┌─────────────────────────────────────────────────────────────────┐
│                   NET AVAILABLE FOR CUSTOMER                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   INCLUDED (Can Sell):                                           │
│   ────────────────────                                           │
│   + snv_available           (Main warehouse, ready to ship)      │
│   + us_transit_available    (In US, can ship to customers)       │
│   + in_transit_available    (On the way, arriving soon)          │
│                                                                  │
│   SUBTRACTED (Already Committed):                                │
│   ────────────────────────────────                               │
│   − blanket_next_month_reserved (Promised for next month)        │
│                                                                  │
│   EXCLUDED (Not Sellable):                                       │
│   ────────────────────────                                       │
│   ✗ production_on_hand      (Not yet transferred)                │
│   ✗ quarantine_qty          (Quality hold)                       │
│   ✗ returns_qty             (Needs inspection)                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Example Calculation

```
snv_available:                    500
us_transit_available:           + 400
in_transit_available:           + 200
blanket_next_month_reserved:    - 150
─────────────────────────────────────
NET AVAILABLE FOR CUSTOMER:       950 ← This is what you can promise!
```

---

## 👁️ View Reference: vw_item_stock_distribution

### Purpose

The master view that **pivots warehouse stock by category** and calculates all aggregations.

### All Output Columns

#### Item Identification

| Column | Description |
|--------|-------------|
| `item_code` | Item identifier |
| `item_name` | Item description |
| `part_number` | Part number |
| `master_serial_no` | Master serial number |
| `revision` | Item revision |
| `uom` | Unit of measure |

#### Production Warehouse

| Column | Description |
|--------|-------------|
| `production_on_hand` | Physical stock at production |
| `production_available` | Available production stock |
| `production_reserved` | Reserved production stock |

#### In Transit

| Column | Description |
|--------|-------------|
| `in_transit_qty` | Total quantity in transit |
| `in_transit_available` | Available in transit stock |

#### S&V (Main Warehouse)

| Column | Description |
|--------|-------------|
| `snv_on_hand` | Physical stock at S&V |
| `snv_available` | Available S&V stock |
| `snv_reserved` | Reserved S&V stock |
| `snv_allocated` | Allocated S&V stock |

#### US Transit

| Column | Description |
|--------|-------------|
| `us_transit_on_hand` | Physical stock at US Transit |
| `us_transit_available` | Available US Transit stock |
| `us_transit_reserved` | Reserved US Transit stock |

#### Distribution

| Column | Description |
|--------|-------------|
| `distribution_on_hand` | Physical stock at distribution |
| `distribution_available` | Available distribution stock |

#### Special Warehouses

| Column | Description |
|--------|-------------|
| `quarantine_qty` | Stock under quality hold |
| `returns_qty` | Customer returns quantity |

#### Blanket Order Related

| Column | Description |
|--------|-------------|
| `blanket_pending_qty` | Pending blanket release quantity |
| `blanket_next_month_reserved` | Reserved for next month blanket releases |

#### Calculated Totals

| Column | Description |
|--------|-------------|
| `net_available_for_customer` | True sellable stock for new orders |
| `warehouse_available` | Total available across selling warehouses |
| `total_customer_reserved` | Total reserved for customers |

---

## 🔍 Finding Exact Stock Information

### Quick Reference Table

| Question | Column to Check |
|----------|-----------------|
| **Physical Stock** | |
| "How much is physically in our main warehouse?" | `snv_on_hand` |
| "How much is at production?" | `production_on_hand` |
| "How much is in the US?" | `us_transit_on_hand` |
| "How much is being shipped?" | `in_transit_qty` |
| **Availability** | |
| "How much can we sell from main warehouse?" | `snv_available` |
| "How much can we sell from US?" | `us_transit_available` |
| "Total we can sell across all locations?" | `warehouse_available` |
| "True sellable for new customer?" | `net_available_for_customer` |
| **Commitments** | |
| "How much is being processed now?" | `snv_allocated` |
| "How much is promised for future?" | `snv_reserved` |
| "How much is coming to us?" | `in_transit_qty` |
| **Exclusions** | |
| "How much is on quality hold?" | `quarantine_qty` |
| "How much is in customer returns?" | `returns_qty` |

---

## ❓ Why Different Warehouses Have Different Attributes

### Attribute Decisions by Warehouse Type

| Warehouse | Attributes | Reasoning |
|-----------|------------|-----------|
| **S&V** | All 4 | Full operational warehouse - picks, packs, ships orders |
| **Production** | 3 (no allocated) | Doesn't directly fulfill orders - transfers to S&V first |
| **In Transit** | 2 (qty + available) | Virtual location - stock is moving, no local operations |
| **US Transit** | 3 (no allocated) | Storage hub - may not do local picking/packing |
| **Distribution** | 2 (on_hand + available) | Simplified - may have separate operational system |
| **Quarantine/Returns** | 1 (qty only) | Non-sellable - just need to track quantity |

### The Key Principle

```
More operational complexity = More attributes needed

S&V (Full Operations)     → 4 attributes (on_hand, allocated, reserved, available)
Production (Pre-Transfer) → 3 attributes (on_hand, reserved, available)  
Transit/Storage           → 2-3 attributes (on_hand, available, maybe reserved)
Hold/Returns              → 1 attribute (qty only)
```

---

## 📚 Related Documentation

| Document | Description |
|----------|-------------|
| `STOCK_QUANTITIES_GUIDE.md` | Understanding on_hand, allocated, reserved, available |
| `inventory_readme.md` | Complete database schema documentation |
| `inventory_extension.sql` | SQL DDL for inventory tables |
| `inventory_views.sql` | SQL for views including vw_item_stock_distribution |

---

## ✅ Summary

1. **S&V** = Main warehouse with full stock tracking (on_hand, allocated, reserved, available)
2. **Production** = Manufacturing output (on_hand, reserved, available - no allocation)
3. **In Transit** = Goods moving between warehouses (qty and available)
4. **US Transit** = US storage hub (on_hand, reserved, available)
5. **Distribution** = Regional centers (on_hand, available)
6. **Quarantine/Returns** = Non-sellable stock (qty only)

**Key Formula:**
```
Net Available = SNV Available + US Transit Available + In Transit Available − Next Month Reserved
```

---

*Document maintained by Enterprise Database Architecture Team*
