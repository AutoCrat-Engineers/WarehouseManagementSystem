# 📦 Understanding Inventory Stock Quantities

## A Complete Guide to Stock Quantity Types in Warehouse Management

**Version:** 1.0.0  
**Last Updated:** 2026-02-06  
**Author:** Enterprise Database Architecture Team

---

## 📋 Table of Contents

1. [The Core Concept](#the-core-concept)
2. [The Four Stock Quantities](#the-four-stock-quantities)
3. [Visual Breakdown](#visual-breakdown)
4. [Quantity Relationships & Formulas](#quantity-relationships--formulas)
5. [Allocated vs Reserved: Key Differences](#allocated-vs-reserved-key-differences)
6. [Real-World Scenarios](#real-world-scenarios)
7. [Net Available Calculation](#net-available-calculation)
8. [Quick Reference Cheat Sheet](#quick-reference-cheat-sheet)
9. [Database Column Reference](#database-column-reference)

---

## 🎯 The Core Concept

In warehouse management, the **physical stock** you have is **not always the same** as the stock you can **sell or use**. This is because:

- Some stock might already be **promised to customers** (current orders)
- Some stock might be **set aside for future orders** (planned/scheduled)
- Some stock might be **held for quality checks** or other purposes

Understanding the difference between these quantities is **critical** for:
- ✅ Accurate order promising
- ✅ Preventing overselling
- ✅ Proper inventory planning
- ✅ Customer satisfaction

---

## 🔢 The Four Stock Quantities

### 1. `quantity_on_hand` (On Hand) 🏠

| Aspect | Description |
|--------|-------------|
| **What it is** | The **actual physical count** of items in the warehouse |
| **Think of it as** | The total number of items you can physically touch and see on the shelves |
| **When it changes** | Receipt of goods, shipment of goods, physical count adjustments |
| **Can it be negative?** | ❌ No - you cannot have negative physical stock |

**Example:**
```
If you count 1000 units in your S&V warehouse → snv_on_hand = 1000
```

**Key Points:**
- This is the **source of truth** for physical inventory
- It should match your physical count during cycle counts
- All other quantities derive from this base number

---

### 2. `quantity_allocated` (Allocated) 🔒

| Aspect | Description |
|--------|-------------|
| **What it is** | Stock that has been **assigned to specific, active orders** that are being processed |
| **Think of it as** | Items that are *already being picked, packed, or are about to ship* for confirmed orders |
| **When it changes** | Order confirmation, order picking, order shipment, order cancellation |
| **Can it be negative?** | ❌ No |

**Key Characteristics:**
- Tied to **current** orders being fulfilled
- These orders are typically **in progress** (not future)
- The stock is **hard committed** and cannot be used for anything else
- Allocation is usually done at the **order/sales order level**

**Example:**
```
If you have 200 units being prepared for shipping today → snv_allocated = 200
```

**When Stock Gets Allocated:**
1. ✅ Sales order is confirmed
2. ✅ Pick list is generated
3. ✅ Order is being packed
4. ✅ Order is waiting for shipment

**When Allocation is Released:**
1. 📦 Order is shipped (becomes issue/stock-out)
2. ❌ Order is cancelled
3. 🔄 Order quantity is reduced

---

### 3. `quantity_reserved` (Reserved) ⏳

| Aspect | Description |
|--------|-------------|
| **What it is** | Stock that has been **set aside for future orders** or anticipated demand |
| **Think of it as** | Items that are *promised to future orders* but not yet being actively processed |
| **When it changes** | Blanket order creation, scheduled order planning, manual reservation |
| **Can it be negative?** | ❌ No |

**Key Characteristics:**
- Tied to **future commitments** (e.g., blanket orders, scheduled deliveries)
- The orders are **planned but not in progress**
- Creates a **"soft hold"** on inventory
- More **flexible** than allocation - can be released if needed

**Example:**
```
If you have 300 units reserved for blanket releases next month → snv_reserved = 300
```

**Types of Reservations:**
| Type | Description |
|------|-------------|
| **Blanket Order Reservation** | Stock held for upcoming blanket release shipments |
| **Scheduled Order Reservation** | Stock held for orders with future delivery dates |
| **Manual Reservation** | Stock manually held for special purposes |
| **Safety Stock Reservation** | Minimum stock levels maintained |

---

### 4. `quantity_available` (Available) ✅

| Aspect | Description |
|--------|-------------|
| **What it is** | The stock that is **free to be sold or used** for new orders |
| **Think of it as** | The *true sellable stock* that you can promise to a new customer |
| **How it's calculated** | Auto-calculated based on formula (see below) |
| **Can it be negative?** | ❌ No - system prevents this |

**Formula (Auto-Calculated):**
```sql
quantity_available = quantity_on_hand - quantity_allocated - quantity_reserved
```

**Example Calculation:**
```
snv_on_hand     = 1000
snv_allocated   = 200
snv_reserved    = 300
───────────────────────
snv_available   = 500  ← THIS is what you can actually sell!
```

**Key Points:**
- This is the **ONLY** quantity you should use for **order promising**
- It's a **computed column** in the database (auto-updated)
- Always reflects the **real-time** sellable stock
- Never promise more than this to a customer

---

## 📊 Visual Breakdown

### Stock Quantity Relationship

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    QUANTITY ON HAND (1000 units)                            │
│                    [Physical stock in warehouse]                            │
├────────────────────────┬──────────────────────┬─────────────────────────────┤
│   ALLOCATED (200)      │   RESERVED (300)     │     AVAILABLE (500)         │
│                        │                      │                             │
│ 🔒 Committed to        │ ⏳ Held for          │ ✅ FREE TO SELL             │
│    active orders       │    future orders     │    to new customers         │
│                        │                      │                             │
│ • Being picked now     │ • Blanket releases   │ • No commitments            │
│ • Being packed         │ • Scheduled orders   │ • Available for orders      │
│ • Ready to ship        │ • Reserved stock     │ • Can be transferred        │
└────────────────────────┴──────────────────────┴─────────────────────────────┘
```

### Pie Chart Representation

```
        On Hand = 1000 units (100%)
        
             ┌──────────────────┐
            ╱                    ╲
           │     AVAILABLE        │
           │        500           │
           │       (50%)          │
           │                      │
    ┌──────┤                      ├──────┐
    │      │                      │      │
    │ ALLO │                      │ RESR │
    │ 200  │                      │ 300  │
    │(20%) │                      │(30%) │
    └──────┴──────────────────────┴──────┘
```

---

## 🧮 Quantity Relationships & Formulas

### The Fundamental Formula

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   ON HAND = ALLOCATED + RESERVED + AVAILABLE                        │
│                                                                      │
│   Therefore:                                                         │
│                                                                      │
│   AVAILABLE = ON HAND - ALLOCATED - RESERVED                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Constraints Enforced

| Constraint | Rule | Reason |
|------------|------|--------|
| Non-Negative On Hand | `on_hand >= 0` | Cannot have negative physical stock |
| Non-Negative Available | `available >= 0` | Cannot oversell |
| Allocation Limit | `allocated <= on_hand` | Cannot allocate more than exists |
| Reserve Limit | `reserved <= on_hand - allocated` | Cannot reserve already allocated stock |

### Database Computed Column

In the database, `quantity_available` is a **GENERATED ALWAYS** column:

```sql
quantity_available INTEGER GENERATED ALWAYS AS (
    quantity_on_hand - quantity_allocated - quantity_reserved
) STORED
```

This means:
- ✅ It's automatically calculated - no manual updates needed
- ✅ Always accurate and consistent
- ✅ Cannot be directly modified (prevents errors)

---

## 🎯 Allocated vs Reserved: Key Differences

### Comparison Table

| Aspect | **Allocated** 🔒 | **Reserved** ⏳ |
|--------|------------------|-----------------|
| **Timing** | NOW (active orders) | FUTURE (planned orders) |
| **Order Status** | In Progress / Processing | Scheduled / Planned |
| **Commitment Level** | HARD commit | SOFT commit |
| **Flexibility** | Very hard to change | Can be released if needed |
| **Purpose** | Ensure current orders ship | Guarantee future availability |
| **Typical Source** | Sales Order | Blanket Order / Schedule |
| **Example** | Order #123 being packed | Blanket release for next month |
| **Can be cancelled?** | Only by order cancellation | Yes, more flexible |

### Timeline Visualization

```
PAST ◄────────────── TODAY ──────────────► FUTURE
                        │
         ┌──────────────┼──────────────┐
         │              │              │
    ───▶ │  ALLOCATED   │   RESERVED   │ ───▶
         │              │              │
         │ Being picked │ Blanket order│
         │ Being packed │ Scheduled    │
         │ Ready to ship│ Next month   │
         │              │              │
         └──────────────┴──────────────┘
                NOW            FUTURE
```

### Decision Flowchart: Allocate or Reserve?

```
                    ┌─────────────────────┐
                    │ Is the order being  │
                    │ processed NOW?      │
                    └─────────┬───────────┘
                              │
              ┌───────────────┴───────────────┐
              │ YES                       NO  │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │   ALLOCATE      │             │    RESERVE      │
    │                 │             │                 │
    │ • Pick list     │             │ • Blanket order │
    │ • Packing       │             │ • Future date   │
    │ • Ready to ship │             │ • Scheduled     │
    └─────────────────┘             └─────────────────┘
```

---

## 🛒 Real-World Scenarios

### Scenario 1: Customer Inquiry

**Customer asks:** "How many Widget-X can I order?"

```
Location                  On Hand   Allocated  Reserved   AVAILABLE
─────────────────────────────────────────────────────────────────────
S&V Warehouse             1000      200        300        500 ✅
US Transit                500       100        50         350 ✅
In Transit                200       0          0          200 ⚠️
Production                800       400        0          400 ❌
─────────────────────────────────────────────────────────────────────
NET AVAILABLE FOR CUSTOMER = 500 + 350 + 200 = 1,050 units
```

**Answer:** "We can fulfill up to **1,050 units** for immediate order."

> **Note:** Production stock (400) is excluded because it hasn't been transferred to a shipping-ready warehouse yet.

---

### Scenario 2: Stock Flow Through Order Lifecycle

```
Step 1: Initial State
────────────────────
On Hand: 1000 | Allocated: 0 | Reserved: 0 | Available: 1000

Step 2: Blanket Order Created for Next Month (300 units)
─────────────────────────────────────────────────────────
On Hand: 1000 | Allocated: 0 | Reserved: 300 | Available: 700
                                    ↑ Added

Step 3: Sales Order Confirmed (200 units)
─────────────────────────────────────────
On Hand: 1000 | Allocated: 200 | Reserved: 300 | Available: 500
                      ↑ Added

Step 4: Sales Order Shipped (200 units)
───────────────────────────────────────
On Hand: 800 | Allocated: 0 | Reserved: 300 | Available: 500
         ↓              ↓
      Reduced      Removed (shipped)

Step 5: Blanket Release Executed (300 units)
────────────────────────────────────────────
On Hand: 500 | Allocated: 0 | Reserved: 0 | Available: 500
         ↓                        ↓
      Reduced                  Removed (fulfilled)
```

---

### Scenario 3: Why Available Can't Go Negative

```
Current State:
On Hand: 100 | Allocated: 30 | Reserved: 50 | Available: 20

❌ BLOCKED: Attempt to allocate 30 more units
   Reason: Would make Available = -10 (negative not allowed)

❌ BLOCKED: Attempt to reserve 25 more units
   Reason: Would make Available = -5 (negative not allowed)

✅ ALLOWED: Allocate up to 20 more units
   Result: On Hand: 100 | Allocated: 50 | Reserved: 50 | Available: 0
```

---

## 📐 Net Available Calculation

### Your System's Formula

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   NET AVAILABLE FOR CUSTOMER =                                       │
│                                                                      │
│       S&V Available                                                  │
│     + US Transit Available                                           │
│     + In Transit Available                                           │
│     − Blanket Next Month Reserved                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### What's Included vs Excluded

| Stock Type | Included? | Reason |
|------------|-----------|--------|
| S&V Available | ✅ Yes | Main warehouse, ready to ship |
| US Transit Available | ✅ Yes | In US, can ship to customers |
| In Transit Available | ✅ Yes | Coming soon, can be promised |
| Next Month Blanket Reserved | ➖ Subtracted | Already committed |
| Production Stock | ❌ No | Not yet transferred |
| Quarantine Stock | ❌ No | Quality hold |
| Returns Stock | ❌ No | Needs inspection |

### Example Calculation

```
S&V Available:                    500
US Transit Available:           + 350
In Transit Available:           + 200
Blanket Next Month Reserved:    - 150
─────────────────────────────────────
NET AVAILABLE FOR CUSTOMER:       900
```

---

## 💡 Quick Reference Cheat Sheet

### Finding Stock Information

| Question | Look At |
|----------|---------|
| "How much do we physically have?" | `quantity_on_hand` |
| "How much is promised to current orders?" | `quantity_allocated` |
| "How much is set aside for future orders?" | `quantity_reserved` |
| "How much can we sell to a new customer?" | `quantity_available` |
| "What's our total committed stock?" | `allocated + reserved` |
| "What's the true sellable quantity?" | `net_available_for_customer` |

### Common Operations

| Action | Effect on Quantities |
|--------|---------------------|
| Receive goods | On Hand ↑ Available ↑ |
| Ship goods | On Hand ↓ Allocated ↓ |
| Confirm sales order | Allocated ↑ Available ↓ |
| Cancel sales order | Allocated ↓ Available ↑ |
| Create blanket reservation | Reserved ↑ Available ↓ |
| Release blanket reservation | Reserved ↓, On Hand ↓ |
| Cycle count adjustment + | On Hand ↑ Available ↑ |
| Cycle count adjustment - | On Hand ↓ Available ↓ |

### Warning Signs

| Situation | Indicates |
|-----------|-----------|
| `available = 0` | Stock fully committed, cannot take new orders |
| `allocated > on_hand * 0.8` | High proportion being processed |
| `reserved > on_hand * 0.5` | Heavy future commitments |
| `on_hand = 0` but orders pending | Stock-out situation |

---

## 🗃️ Database Column Reference

### Table: `inv_warehouse_stock`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `quantity_on_hand` | INTEGER | NOT NULL | Physical count in warehouse |
| `quantity_allocated` | INTEGER | NOT NULL | Assigned to active orders |
| `quantity_reserved` | INTEGER | NOT NULL | Held for future orders |
| `quantity_in_transit` | INTEGER | NOT NULL | Coming from transfers |
| `quantity_available` | INTEGER | COMPUTED | Free to sell (auto-calculated) |

### Constraints

```sql
CONSTRAINT qty_positive CHECK (quantity_on_hand >= 0)
CONSTRAINT available_positive CHECK (quantity_available >= 0)
```

### Trigger: Prevents Negative Stock

```sql
CREATE OR REPLACE FUNCTION inv_check_stock_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.quantity_on_hand < 0 THEN
        RAISE EXCEPTION 'Stock quantity cannot be negative';
    END IF;
    IF NEW.quantity_available < 0 THEN
        RAISE EXCEPTION 'Available stock cannot be negative';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 📚 Related Documentation

| Document | Description |
|----------|-------------|
| `WAREHOUSE_STOCK_GUIDE.md` | Warehouse-specific stock attributes |
| `inventory_readme.md` | Complete database schema documentation |
| `inventory_extension.sql` | SQL DDL for inventory tables |

---

## ✅ Summary

1. **On Hand** = What you physically have
2. **Allocated** = Committed to current orders (NOW)
3. **Reserved** = Set aside for future orders (LATER)
4. **Available** = Free to sell (On Hand - Allocated - Reserved)

**The Golden Rule:** 
> Never promise more than `quantity_available` to a new customer!

---

*Document maintained by Enterprise Database Architecture Team*
