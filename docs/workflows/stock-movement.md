# Stock Movement Workflow

> **Version:** 0.4.1 | **Last Updated:** 2026-03-06

## Overview

The Stock Movement module manages all stock changes across the warehouse system. Every stock change creates a complete audit trail with balance tracking.

## Movement Types

| Type | Direction | Trigger | Warehouse Flow |
|------|-----------|---------|----------------|
| `PRODUCTION_RECEIPT` | IN | Supervisor approval | Production → PW (FG Warehouse) |
| `DISPATCH_TO_TRANSIT` | Internal | Proforma Invoice approval | PW → In-Transit |
| `TRANSFER_TO_WAREHOUSE` | Internal | Dispatch | In-Transit → US Warehouse |
| `CUSTOMER_SALE` | OUT | Customer delivery | In-Transit → Customer |
| `RETURN_TO_PRODUCTION` | Internal | Return | PW → Production |

## Flow Diagram

```
Production Floor
       │
       ▼ (PRODUCTION_RECEIPT — Supervisor Approved)
FG Warehouse (PW)
       │
       ├──▶ Packing Request Created
       │       │
       │       ▼ (Auto-generate boxes, print stickers)
       │    Packing Complete
       │       │
       │       ▼ (Transfer packed stock)
       │    Stock in FG Warehouse
       │
       ▼ (DISPATCH_TO_TRANSIT)
In-Transit (IT)
       │
       ├──▶ US Warehouse (TRANSFER)
       └──▶ Customer (CUSTOMER_SALE)
```

## Business Rules

### Stock IN
- Item must exist and be ACTIVE
- Quantity must be > 0
- Reason is REQUIRED
- Warns if stock exceeds max (but allows)
- Auto-creates inventory record if first movement

### Stock OUT
- Same validations as IN
- **Prevents negative stock** — rejected if insufficient
- Warns if stock falls below minimum
- Blanket Release ID required for shipments

### Packing Stock Transfer
- Boxes must have stickers printed
- Boxes must not already be transferred
- Updates `inv_warehouse_stock` for destination warehouse
- Creates ledger entries for source and destination
- Marks boxes as transferred

## Approval Flow

```
L1 Operator creates movement request (PENDING)
       │
       ▼
L2 Supervisor reviews
       │
       ├──▶ APPROVE → Packing request auto-created
       └──▶ REJECT → Movement cancelled
```

## Audit Trail

Every movement records:
- Timestamp
- User ID and name
- Movement type and quantity
- Balance after transaction
- Reason and reference documents
- Source and destination warehouses

## Related Components

| Component | Purpose |
|-----------|---------|
| `StockMovement.tsx` | Main UI (156KB) |
| `packingService.ts` | Packing workflow |
| `inventoryService.ts` | Inventory data access |
