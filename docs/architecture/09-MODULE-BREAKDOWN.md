# 09 — Module Breakdown

> Deep dive into each functional module: responsibilities, files, database tables, and hooks.

---

## 9.1 Module Map

```mermaid
mindmap
  root((WMS))
    Dashboard
      DashboardNew.tsx
      useDashboard hook
      SampleDataInfo.tsx
    Item Master
      ItemMasterSupabase.tsx
      itemsSupabase API
      items table
    Inventory
      InventoryGrid.tsx
      StockDistributionCard.tsx
      useInventory hooks
      inventoryService.ts
      inventory table
    Stock Movements
      StockMovement.tsx
      stock_movements table
      Movement Ledger
    Blanket Orders
      BlanketOrders.tsx
      blanket_orders table
      blanket_order_lines table
      blanket_order_items table
    Blanket Releases
      BlanketReleases.tsx
      blanket_releases table
    Forecasting
      ForecastingModule.tsx
      ForecastingService.ts
      demand_history table
      demand_forecasts table
      Holt-Winters Algorithm
    MRP Planning
      PlanningModule.tsx
      PlanningService.ts
      planning_recommendations
    Auth & RBAC
      LoginPage.tsx
      UserManagement.tsx
      AuthContext
      authService
      userService
      profiles + roles tables
    Packing
      PackingModule.tsx
      PackingDetails.tsx
      PackingListInvoice.tsx
      PackingListSubInvoice.tsx
      StickerPrint.tsx
      packingService.ts
      packing_requests table
      packing_boxes table
    Notifications
      NotificationBell.tsx
      notificationService.ts
```

---

## 9.2 Module: Dashboard

| Aspect | Detail |
|--------|--------|
| **Component** | `DashboardNew.tsx` (16KB) |
| **Hook** | `useDashboard.ts` |
| **Purpose** | Real-time KPI overview, stock alerts, recent activity |
| **Data Sources** | `items`, `inventory`, `blanket_orders` tables |

### KPIs Displayed
- Total active items count
- Low stock / critical alert count
- Healthy stock count
- Total inventory value (Σ stock × unit_price)
- Recent blanket orders (last 5)
- Stock alerts sorted by severity (critical → warning)

### Sub-Components
| Component | Purpose |
|-----------|---------|
| `StockDistributionCard.tsx` | Visual stock breakdown by warehouse type |
| `SampleDataInfo.tsx` | Info banner when running with sample data |

---

## 9.3 Module: Item Master

| Aspect | Detail |
|--------|--------|
| **Component** | `ItemMasterSupabase.tsx` (74KB) |
| **API** | `src/utils/api/itemsSupabase.ts` |
| **Purpose** | Full CRUD for finished goods catalog |
| **Tables** | `items` |

### Operations
| Operation | Method | Notes |
|-----------|--------|-------|
| **List** | `SELECT * FROM items` | With search, filter, sort |
| **Create** | `INSERT INTO items` | Validates unique item_code |
| **Update** | `UPDATE items SET ...` | Tracks updated_at |
| **Delete** | Cascading hard delete | Removes item + inventory + movements + forecasts |

### Key Fields
- `item_code` — Unique identifier (e.g., "FG-001")
- `item_name` — Display name
- `uom` — Unit of Measure (default: PCS)
- `unit_price` / `standard_cost` — Pricing
- `lead_time_days` — Procurement/production lead time
- `master_serial_no`, `part_number`, `revision` — Engineering attributes

---

## 9.4 Module: Inventory (Multi-Warehouse)

| Aspect | Detail |
|--------|--------|
| **Component** | `InventoryGrid.tsx` (42KB) |
| **Service** | `inventoryService.ts` (16KB) |
| **Hooks** | 8 hooks in `useInventory.ts` (17KB) |
| **Purpose** | Multi-warehouse stock visibility and management |
| **Tables** | `inventory`, `warehouse_stock`, `warehouses`, `warehouse_types` |

### Hooks Available

| Hook | Purpose |
|------|---------|
| `useItemStockDashboard` | Single item stock KPIs |
| `useAllItemsStockDashboard` | All items stock overview |
| `useItemStockDistribution` | Stock breakdown by category |
| `useItemWarehouseDetails` | Per-warehouse drill-down |
| `useItemStockSummary` | Summary grid data |
| `useBlanketReleaseReservations` | Reserved stock against orders |
| `useRecentStockMovements` | Movement history |
| `useWarehouses` | Warehouse master data |

### Stock Attributes
| Attribute | Formula |
|-----------|---------|
| **On-Hand (Current)** | Physical stock count |
| **Allocated** | Reserved for production orders |
| **Reserved** | Held for blanket releases |
| **In Transit** | Between warehouses |
| **Available** | `current - allocated - reserved` |

---

## 9.5 Module: Stock Movements

| Aspect | Detail |
|--------|--------|
| **Component** | `StockMovement.tsx` (137KB — largest component) |
| **Purpose** | Immutable transaction ledger for all stock changes |
| **Tables** | `stock_movements`, `inventory` |

### Movement Types
| Type | Direction | Examples |
|------|-----------|----------|
| `IN` | Stock increase | Production receipt, purchase receipt, return |
| `OUT` | Stock decrease | Customer dispatch, blanket release, scrap |

### Transaction Types
| Transaction | Description |
|-------------|-------------|
| `PRODUCTION_RECEIPT` | Goods from production line |
| `PURCHASE_RECEIPT` | Goods from supplier |
| `CUSTOMER_DISPATCH` | Outbound to customer |
| `BLANKET_RELEASE` | Against scheduling agreement |
| `ADJUSTMENT` | Manual stock correction |
| `SCRAP` | Write-off |
| `TRANSFER` | Inter-warehouse movement |

### Ledger Integrity
Every movement record captures:
- `balance_after` — running balance at time of transaction
- `reason` — mandatory text explaining the movement
- `reference_type` + `reference_id` — links to source document
- `created_by` — user who performed the action
- `created_at` — immutable timestamp

---

## 9.7 Module: Packing

| Aspect | Detail |
|--------|--------|
| **Components** | `PackingModule.tsx` (18KB), `PackingDetail.tsx` (58KB), `PackingDetails.tsx` (74KB), `PackingList.tsx` (26KB), `PackingListInvoice.tsx` (19KB), `PackingListSubInvoice.tsx` (20KB), `StickerPrint.tsx` (18KB) |
| **Service** | `packingService.ts` (31KB) |
| **Types** | `src/types/packing.ts` (10KB) |
| **Purpose** | End-to-end FG packing workflow with sticker generation and box-level stock transfer |
| **Tables** | `packing_requests`, `packing_boxes`, `packing_audit_log`, `packing_details` |

### Packing Workflow
```
Movement Approved → Packing Request Created → Packing Started →
Boxes Created (each gets PKG-XXXXXXXX) → Stickers Printed →
Partial Stock Transfer → Complete Packing (full transfer to FG Warehouse)
```

### Packing Request Status Machine
| Status | Description |
|--------|-------------|
| `APPROVED` | Supervisor approved — packing can begin, no stock moved |
| `REJECTED` | Supervisor rejected — no stock movement |
| `PACKING_IN_PROGRESS` | Operator started packing — creating boxes |
| `PARTIALLY_TRANSFERRED` | Some boxes packed & stock partially moved to FG Warehouse |
| `COMPLETED` | All boxes packed, all stock transferred to FG Warehouse |

### Sub-Views (Accordion Navigation)
| View | Component | Purpose |
|------|-----------|---------|
| Sticker Generation | `PackingModule.tsx` | Create boxes, print stickers with barcodes |
| Packing Details | `PackingDetails.tsx` | Manage packing specs (dimensions, qty per box) |
| Packing List — Invoice | `PackingListInvoice.tsx` | Packing list against invoice |
| Packing List — Sub Invoice | `PackingListSubInvoice.tsx` | Packing list against sub-invoice |

### Audit Actions
| Action | Description |
|--------|-------------|
| `PACKING_CREATED` | Packing request created |
| `PACKING_STARTED` | Packing started by operator |
| `BOX_CREATED` | Box added with unique PKG ID |
| `BOX_DELETED` | Box removed |
| `STICKER_PRINTED` | Sticker printed for box |
| `STOCK_PARTIAL_TRANSFER` | Partial stock moved to FG Warehouse |
| `STOCK_FULL_TRANSFER` | Full stock moved to FG Warehouse |
| `PACKING_COMPLETED` | Packing completed |

---

## 9.8 Module: Blanket Orders

| Aspect | Detail |
|--------|--------|
| **Component** | `BlanketOrders.tsx` (25KB) |
| **Purpose** | Customer scheduling agreements (long-term contracts) |
| **Tables** | `blanket_orders`, `blanket_order_lines`, `blanket_order_items` |

### Order Lifecycle
```
ACTIVE → PARTIALLY_RELEASED → FULLY_RELEASED → COMPLETED → CLOSED
```

### Key Fields
- `order_number` — Unique order reference
- `customer_name` / `customer_code` — Customer identification
- `sap_doc_no` — SAP integration reference
- `customer_po_number` — Customer's purchase order
- `start_date` / `end_date` — Contract validity period

---

## 9.9 Module: Blanket Releases

| Aspect | Detail |
|--------|--------|
| **Component** | `BlanketReleases.tsx` (23KB) |
| **Purpose** | Scheduled delivery releases against blanket orders |
| **Tables** | `blanket_releases` |

### Release Lifecycle
```
PENDING → IN_PROGRESS → SHIPPED → DELIVERED → COMPLETED
```

### Key Fields
- `release_number` — Unique release reference
- `requested_quantity` vs `delivered_quantity` — Fulfillment tracking
- `requested_delivery_date` vs `actual_delivery_date` — Schedule adherence
- `shipment_number` / `tracking_number` — Logistics tracking

---

## 9.10 Module: Forecasting

| Aspect | Detail |
|--------|--------|
| **Component** | `ForecastingModule.tsx` (19KB) |
| **Backend Service** | `ForecastingService.ts` (14KB) |
| **Purpose** | Statistical demand prediction |
| **Tables** | `demand_history`, `demand_forecasts` |

### Algorithm: Holt-Winters Triple Exponential Smoothing

```
Level:    Lₜ = α × (Yₜ / Sₜ₋ₘ) + (1 - α) × (Lₜ₋₁ + Tₜ₋₁)
Trend:    Tₜ = β × (Lₜ - Lₜ₋₁) + (1 - β) × Tₜ₋₁
Season:   Sₜ = γ × (Yₜ / Lₜ) + (1 - γ) × Sₜ₋ₘ
Forecast: Fₜ₊ₕ = (Lₜ + h × Tₜ) × Sₜ₊ₕ₋ₘ
```

| Parameter | Range | Purpose |
|-----------|-------|---------|
| α (alpha) | 0–1 | Level smoothing weight |
| β (beta) | 0–1 | Trend smoothing weight |
| γ (gamma) | 0–1 | Seasonal smoothing weight |
| m | Integer | Seasonal period length |

---

## 9.11 Module: MRP Planning

| Aspect | Detail |
|--------|--------|
| **Component** | `PlanningModule.tsx` (15KB) |
| **Backend Service** | `PlanningService.ts` (16KB) |
| **Purpose** | Material Requirements Planning recommendations |
| **Tables** | `planning_recommendations` |

### Recommendation Actions
| Action | Condition | Priority |
|--------|-----------|----------|
| `REPLENISH` | Net requirement > 0 | Based on days of supply |
| `EXPEDITE` | Existing order needs acceleration | Based on lead time gap |
| `DEFER` | Excess stock, no near-term demand | LOW |
| `REDUCE` | Stock > max level | MEDIUM |
| `CANCEL` | Order no longer needed | LOW |

### Priority Levels
| Priority | Criteria |
|----------|----------|
| 🔴 **URGENT** | Stock < safety stock, demand imminent |
| 🟠 **HIGH** | Stock depleted within lead time |
| 🟡 **MEDIUM** | Stock adequate but action needed |
| 🟢 **LOW** | Informational, no immediate action |

---

## 9.12 Module: Notifications

| Aspect | Detail |
|--------|--------|
| **Component** | `NotificationBell.tsx` (17KB) |
| **Service** | `notificationService.ts` (12KB) |
| **Purpose** | Real-time notification system for stock events, approvals, and system alerts |

### Features
- Notification bell with unread count badge in the top bar
- Real-time updates via Supabase subscriptions
- Mark individual or all notifications as read
- Notification categories: stock alerts, approval requests, system events

---

**← Previous**: [08-DATA-FLOW-DIAGRAMS.md](./08-DATA-FLOW-DIAGRAMS.md) | **Next**: [10-SECURITY-ARCHITECTURE.md](./10-SECURITY-ARCHITECTURE.md) →

---

© 2026 AutoCrat Engineers. All rights reserved.
