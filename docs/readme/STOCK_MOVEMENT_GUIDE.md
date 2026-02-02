# 📦 FG Stock Movement Module - Implementation Guide

## ✅ Implementation Complete

The Stock Movement module has been fully implemented with enterprise-grade validation and auditability following ERP best practices.

---

## 🎯 Business Rules Implemented

### 1️⃣ **FG Item Creation (Item Master)**
- ✅ Creating an FG item does **NOT** automatically create stock
- ✅ Stock starts at **0** when item is created
- ✅ Stock record is auto-created on first movement if it doesn't exist
- ✅ Item must have: itemCode, itemName, UOM, min/max/safety stock, lead time, status

### 2️⃣ **Stock Storage**
- ✅ Stock is stored in `inventory_current.current_stock` (KV store: `inventory:{itemId}`)
- ✅ Stock is **never stored** in Item Master
- ✅ Stock can only be updated via stock movement transactions

### 3️⃣ **Stock IN Flow (Adding Stock)**
**User creates a "Stock IN Transaction":**
- ✅ FG Item (dropdown selection - required)
- ✅ Movement Type: **IN** (required)
- ✅ Quantity (positive number - required, minimum 1)
- ✅ Reason (required field - mandatory explanation)
- ✅ Reference Type (Production Order / Manual / Adjustment / etc.)
- ✅ Reference ID (optional, unless specific reference type)
- ✅ Remarks/Notes (included in reason field)

**Backend Validation:**
1. ✅ Validates FG item exists
2. ✅ Validates FG item is **ACTIVE** (no movements on inactive items)
3. ✅ Validates quantity > 0
4. ✅ Validates reason is provided
5. ✅ Reads current stock
6. ✅ Creates movement record with full audit trail
7. ✅ Calculates new balance (current + quantity)
8. ✅ Updates `inventory_current.current_stock`
9. ✅ Warns if stock exceeds max (but allows transaction)

### 4️⃣ **Stock OUT Flow (Reducing Stock)**
**User creates a "Stock OUT Transaction":**
- ✅ FG Item (dropdown selection - required)
- ✅ Movement Type: **OUT** (required)
- ✅ Quantity (positive number - required, minimum 1)
- ✅ **Reason (MANDATORY for OUT movements)**
- ✅ Reference Type (Blanket Release Shipment / Sales Order / etc.)
- ✅ **Blanket Release ID (MANDATORY if reason = "Blanket Release Shipment")**
- ✅ Remarks (included in reason field)

**Backend Validation:**
1. ✅ Validates FG item exists and is ACTIVE
2. ✅ Validates quantity > 0
3. ✅ Validates reason is provided (MANDATORY)
4. ✅ **Special Rule:** If reason = "Blanket Release Shipment", Blanket Release ID is MANDATORY
5. ✅ Reads current stock
6. ✅ **Prevents negative stock** - transaction rejected if insufficient stock
7. ✅ Creates movement record with full audit trail
8. ✅ Calculates new balance (current - quantity)
9. ✅ Updates `inventory_current.current_stock`
10. ✅ Warns if stock falls below minimum (but allows transaction)

---

## 🔒 Critical Validations

### ✅ Implemented Validations:

| Validation | Status | Error Message |
|-----------|--------|---------------|
| Item exists | ✅ | "Item not found. Please create the FG item first." |
| Item is ACTIVE | ✅ | "Cannot perform stock movement on inactive item" |
| Quantity > 0 | ✅ | "Quantity must be greater than 0" |
| Movement Type (IN/OUT) | ✅ | "movementType must be either IN or OUT" |
| Reason provided | ✅ | "Reason is required for stock movement" |
| Blanket Release ID for shipments | ✅ | "Blanket Release ID is mandatory for Blanket Release Shipment" |
| Negative stock prevention | ✅ | "Insufficient stock for OUT movement. Current stock: X. Shortfall: Y" |
| Min/Max warnings | ✅ | "Warning: Stock level (X) is below minimum (Y)" |

---

## 📊 Movement Record Structure

Each movement creates a complete audit trail:

```typescript
{
  id: "stock-movement:{timestamp}-{random}",
  itemId: "item:...",
  itemCode: "FG-WDG-001",
  itemName: "Premium Widget Type A",
  movementType: "IN" | "OUT",
  quantity: 100,
  reason: "Production completion for PO-2024-001",
  referenceType: "Production Order",
  referenceId: "PO-2024-001",
  balanceAfter: 1200,      // Stock after this movement
  previousBalance: 1100,    // Stock before this movement
  createdAt: "2026-01-14T10:30:00Z",
  createdBy: "user-id",
  createdByName: "John Smith"
}
```

---

## 🎨 Frontend Features

### Stock Movement Ledger
- ✅ Complete transaction history table
- ✅ Filter by FG item
- ✅ Search across all fields
- ✅ Real-time summary cards (total movements, inward, outward)
- ✅ Color-coded IN (green) / OUT (red) indicators
- ✅ Balance after each transaction
- ✅ Full audit trail (who, when, why, reference)

### Create Movement Modal
- ✅ Item selection with current stock display
- ✅ Visual IN/OUT toggle buttons
- ✅ Live preview of projected stock levels
- ✅ Min/Max validation warnings
- ✅ Conditional required fields (Blanket Release ID)
- ✅ Reference type dropdown
- ✅ Mandatory reason field
- ✅ Real-time stock calculation

---

## 🔄 Stock Flow Architecture

```
┌─────────────────┐
│  Item Master    │
│  (FG Created)   │
└────────┬────────┘
         │
         │ Stock = 0 (no inventory record yet)
         │
         ▼
┌─────────────────────────────────────┐
│    Stock Movement Created (IN)      │
│    ┌─────────────────────────────┐  │
│    │ - Auto-create inventory if  │  │
│    │   doesn't exist (stock=0)   │  │
│    │ - Validate item exists      │  │
│    │ - Validate item is ACTIVE   │  │
│    │ - Validate quantity > 0     │  │
│    │ - Validate reason provided  │  │
│    └─────────────────────────────┘  │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Create Movement Record (Ledger)    │
│  - Full audit trail                 │
│  - Previous balance                 │
│  - New balance                      │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Update Inventory Current Stock     │
│  - Atomic update                    │
│  - current_stock ± quantity         │
│  - productionInward/customerOutward │
└─────────────────────────────────────┘
```

---

## 📍 API Endpoints

### POST `/stock-movements`
Create new stock movement

**Request:**
```json
{
  "itemId": "item:fg-widget-a",
  "movementType": "IN" | "OUT",
  "quantity": 100,
  "reason": "Production completion",
  "referenceType": "Production Order",
  "referenceId": "PO-2024-001"
}
```

**Response:**
```json
{
  "success": true,
  "movement": { ... },
  "updatedInventory": { ... },
  "warning": "Warning: Stock level (1200) exceeds maximum (1000)"
}
```

### GET `/stock-movements?itemId={id}`
Get all movements (optionally filtered by item)

### GET `/stock-movements/history/:itemId`
Get complete movement history for an item

---

## 🚀 Usage Instructions

### 1. Create FG Item First
Navigate to **Item Master** → Create new FG item with min/max/safety stock levels

### 2. Record Stock IN (Add Stock)
Navigate to **Stock Movements** → Click **"New Movement"**
- Select FG Item
- Click **IN** button
- Enter Quantity
- Select Reference Type (e.g., "Production Order")
- Enter Reference ID (e.g., "PO-2024-001")
- Enter Reason (REQUIRED)
- Click **"Create Movement"**

### 3. Record Stock OUT (Reduce Stock)
Navigate to **Stock Movements** → Click **"New Movement"**
- Select FG Item
- Click **OUT** button
- Enter Quantity
- Select Reference Type (e.g., "Blanket Release Shipment")
- Enter Blanket Release ID (MANDATORY for shipments)
- Enter Reason (REQUIRED)
- Click **"Create Movement"**

### 4. View Movement History
- Use filter dropdown to select specific FG item
- Use search box to find movements by item code, reason, or reference
- Review complete audit trail with balances after each transaction

---

## ✅ Compliance Checklist

- [x] Creating FG item does NOT create stock (starts at 0)
- [x] Stock only lives in `inventory_current`
- [x] Stock can only be changed via movements
- [x] IN movements validated
- [x] OUT movements validated
- [x] Negative stock prevented
- [x] Reason field is mandatory
- [x] Blanket Release ID mandatory for shipments
- [x] Item must exist and be ACTIVE
- [x] Full audit trail (who, when, why, what, how much)
- [x] Balance after each transaction
- [x] Min/Max warnings
- [x] Search and filter capabilities
- [x] Real-time stock preview
- [x] Professional ERP-grade UI

---

## 🎉 Ready to Use!

The Stock Movement module is fully operational and integrated into your ERP system. Access it from the main navigation sidebar under **"Stock Movements"**.
