# 06 — Backend — Edge Functions Architecture

> Supabase Edge Functions with Hono framework, service layer, and repository pattern.

---

## 6.1 Overview

The backend runs as **Supabase Edge Functions** — serverless Deno functions deployed to Supabase's infrastructure. The entry point uses the **Hono** framework for HTTP routing.

```
src/supabase/functions/server/
├── index.tsx                  ← Hono HTTP router (86KB — main entry point)
├── services/
│   ├── ItemService.ts         ← Item business logic
│   ├── InventoryService.ts    ← Inventory operations
│   ├── BlanketOrderService.ts ← Blanket order management
│   ├── BlanketReleaseService.ts ← Release processing
│   ├── ForecastingService.ts  ← Holt-Winters forecasting
│   └── PlanningService.ts     ← MRP recommendations
└── repositories/
    ├── ItemRepository.ts      ← Item data access
    ├── InventoryRepository.ts ← Inventory data access
    └── BlanketOrderRepository.ts ← Order data access
```

---

## 6.2 Architecture Pattern

The backend follows a strict **Service → Repository** pattern:

```mermaid
graph LR
    subgraph HONO["Hono Router (index.tsx)"]
        R1["GET /items"]
        R2["POST /items"]
        R3["GET /inventory"]
        R4["POST /stock-movement"]
        R5["GET /blanket-orders"]
        R6["POST /blanket-releases"]
        R7["GET /forecasts"]
        R8["GET /planning"]
    end

    subgraph SERVICES["Service Layer"]
        IS[ItemService]
        INS[InventoryService]
        BOS[BlanketOrderService]
        BRS[BlanketReleaseService]
        FS[ForecastingService]
        PS[PlanningService]
    end

    subgraph REPOS["Repository Layer"]
        IR[ItemRepository]
        INR[InventoryRepository]
        BOR[BlanketOrderRepository]
    end

    subgraph DB["PostgreSQL"]
        T1[(items)]
        T2[(inventory)]
        T3[(stock_movements)]
        T4[(blanket_orders)]
        T5[(blanket_releases)]
        T6[(demand_forecasts)]
        T7[(planning_recommendations)]
    end

    R1 --> IS
    R2 --> IS
    R3 --> INS
    R4 --> INS
    R5 --> BOS
    R6 --> BRS
    R7 --> FS
    R8 --> PS

    IS --> IR
    INS --> INR
    BOS --> BOR
    BRS --> BOR

    IR --> T1
    INR --> T2
    INR --> T3
    BOR --> T4
    BOR --> T5
    FS --> T6
    PS --> T7

    style HONO fill:#451a03,stroke:#f59e0b,color:#e2e8f0
    style SERVICES fill:#052e16,stroke:#10b981,color:#e2e8f0
    style REPOS fill:#1e1b4b,stroke:#818cf8,color:#e2e8f0
    style DB fill:#450a0a,stroke:#ef4444,color:#e2e8f0
```

---

## 6.3 Backend Services

### ItemService (`services/ItemService.ts`)

| Method | Purpose |
|--------|---------|
| `getAll()` | List all items with optional filters |
| `getByCode(code)` | Get single item by item_code |
| `create(data)` | Create new item with validation |
| `update(code, data)` | Update item fields |
| `delete(code)` | Delete item (cascade check) |

### InventoryService (`services/InventoryService.ts`)

| Method | Purpose |
|--------|---------|
| `getStock(itemCode)` | Current stock levels |
| `recordMovement(movement)` | Record IN/OUT with balance update |
| `getMovementHistory(filters)` | Query stock_movements table |
| `adjustStock(itemCode, qty, reason)` | Manual stock adjustment |

### BlanketOrderService (`services/BlanketOrderService.ts`)

| Method | Purpose |
|--------|---------|
| `getAll()` | List active blanket orders |
| `create(order)` | Create new scheduling agreement |
| `addLineItems(orderId, items)` | Add items to order |
| `updateStatus(orderId, status)` | Status transitions |

### BlanketReleaseService (`services/BlanketReleaseService.ts`)

| Method | Purpose |
|--------|---------|
| `getReleasesForOrder(orderId)` | List releases for an order |
| `createRelease(release)` | Create delivery release |
| `processDelivery(releaseId, qty)` | Record actual delivery |
| `updateTracking(releaseId, info)` | Add shipment/tracking |

### ForecastingService (`services/ForecastingService.ts`)

| Method | Purpose |
|--------|---------|
| `generateForecast(itemCode, params)` | Run Holt-Winters algorithm |
| `getForecasts(itemCode)` | Retrieve stored forecasts |
| `getAccuracy(itemCode)` | Compare forecasted vs actual |
| `updateParams(alpha, beta, gamma)` | Tune smoothing parameters |

**Algorithm**: Holt-Winters Triple Exponential Smoothing
- α (alpha) — Level smoothing
- β (beta) — Trend smoothing
- γ (gamma) — Seasonal smoothing

### PlanningService (`services/PlanningService.ts`)

| Method | Purpose |
|--------|---------|
| `generateRecommendations()` | Run MRP for all items |
| `getRecommendations(filters)` | Fetch planning actions |
| `updateStatus(id, status)` | Approve/reject recommendations |
| `calculateNetRequirements(item)` | Current stock - reserved - forecasted demand |

---

## 6.4 Repository Pattern

Repositories provide a **clean data access abstraction** between services and the database:

```typescript
// Example: ItemRepository
class ItemRepository {
    async findAll(filters?: ItemFilters): Promise<Item[]> {
        const { data } = await supabase
            .from('items')
            .select('*')
            .match(filters);
        return data;
    }

    async findByCode(code: string): Promise<Item | null> {
        const { data } = await supabase
            .from('items')
            .select('*')
            .eq('item_code', code)
            .single();
        return data;
    }

    async create(item: CreateItemDTO): Promise<Item> { ... }
    async update(code: string, data: UpdateItemDTO): Promise<Item> { ... }
    async delete(code: string): Promise<void> { ... }
}
```

### Repository Files

| Repository | File | Tables Accessed |
|-----------|------|-----------------|
| `ItemRepository` | `repositories/ItemRepository.ts` | `items` |
| `InventoryRepository` | `repositories/InventoryRepository.ts` | `inventory`, `stock_movements` |
| `BlanketOrderRepository` | `repositories/BlanketOrderRepository.ts` | `blanket_orders`, `blanket_order_lines`, `blanket_releases` |

---

## 6.5 Deployment

Edge Functions are deployed via the Supabase CLI:

```bash
# Deploy a single function
supabase functions deploy server

# Deploy with JWT verification
supabase functions deploy server --verify-jwt
```

---

**← Previous**: [05-SERVICE-LAYER.md](./05-SERVICE-LAYER.md) | **Next**: [07-DATABASE-ARCHITECTURE.md](./07-DATABASE-ARCHITECTURE.md) →

---

© 2026 AutoCrat Engineers. All rights reserved.
