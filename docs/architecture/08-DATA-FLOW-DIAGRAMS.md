# 08 — Data Flow Diagrams

> End-to-end data flows for every major operation in the WMS.

---

## 8.1 Stock Inward (IN) Flow

```mermaid
sequenceDiagram
    participant U as User (L2+)
    participant SM as StockMovement UI
    participant SVC as inventoryService
    participant SB as Supabase Client
    participant DB as PostgreSQL

    U->>SM: Select item + enter quantity + reason
    SM->>SM: Validate form (qty > 0, reason required)
    SM->>SVC: recordMovement({ itemCode, type: 'IN', qty, reason })
    SVC->>SB: INSERT into stock_movements
    SB->>DB: INSERT stock_movements row

    DB->>DB: Trigger: update_inventory_on_movement()
    Note over DB: current_stock += quantity
    Note over DB: available_stock recalculated
    Note over DB: last_movement_date = now()
    Note over DB: last_movement_type = 'IN'

    DB-->>SB: { movement_id, balance_after }
    SB-->>SVC: Success response
    SVC-->>SM: Movement recorded
    SM->>SM: Refresh movement history
    SM-->>U: Show success toast + updated balance
```

---

## 8.2 Stock Outward (OUT) Flow

```mermaid
sequenceDiagram
    participant U as User (L2+)
    participant SM as StockMovement UI
    participant SVC as inventoryService
    participant DB as PostgreSQL

    U->>SM: Select item + enter quantity + reason
    SM->>SM: Validate: qty <= available_stock

    alt Insufficient Stock
        SM-->>U: Error: "Insufficient available stock"
    else Stock Available
        SM->>SVC: recordMovement({ type: 'OUT', qty, reason })
        SVC->>DB: INSERT stock_movements + UPDATE inventory
        Note over DB: current_stock -= quantity
        Note over DB: balance_after = new current_stock
        DB-->>SVC: Success
        SVC-->>SM: Movement recorded
        SM-->>U: Success toast + updated balance
    end
```

---

## 8.3 Blanket Order → Release → Delivery Flow

```mermaid
sequenceDiagram
    participant M as Manager (L3)
    participant BO as BlanketOrders UI
    participant BR as BlanketReleases UI
    participant SVC as BlanketReleaseService
    participant DB as PostgreSQL

    Note over M,DB: Phase 1 — Create Blanket Order
    M->>BO: Create new order (customer, dates, items)
    BO->>DB: INSERT blanket_orders + blanket_order_lines
    DB-->>BO: Order created (status: ACTIVE)

    Note over M,DB: Phase 2 — Create Release
    M->>BR: Create release against order line
    BR->>SVC: createRelease({ orderId, lineId, qty, deliveryDate })
    SVC->>DB: INSERT blanket_releases (status: PENDING)
    SVC->>DB: UPDATE blanket_order_lines SET released_quantity += qty
    DB-->>BR: Release created

    Note over M,DB: Phase 3 — Process Delivery
    M->>BR: Record delivery (actual qty, date)
    BR->>SVC: processDelivery({ releaseId, deliveredQty })
    SVC->>DB: UPDATE blanket_releases SET delivered_quantity, status
    SVC->>DB: UPDATE blanket_order_lines SET delivered_quantity += qty
    SVC->>DB: INSERT stock_movements (type: OUT, reference: release)
    SVC->>DB: UPDATE inventory SET current_stock -= qty
    DB-->>BR: Delivery processed
    BR-->>M: Updated release status + stock levels
```

---

## 8.4 Demand Forecasting Flow

```mermaid
sequenceDiagram
    participant U as User (L2+)
    participant FM as ForecastingModule UI
    participant FS as ForecastingService
    participant DB as PostgreSQL

    U->>FM: Select item + forecast parameters
    FM->>FS: generateForecast(itemCode, { α, β, γ, periods })

    FS->>DB: SELECT * FROM demand_history WHERE item_code = ?
    DB-->>FS: Historical demand data

    Note over FS: Holt-Winters Triple Exponential Smoothing
    Note over FS: 1. Initialize Level (L₀), Trend (T₀), Seasonal (S₀)
    Note over FS: 2. For each period: compute Lₜ, Tₜ, Sₜ
    Note over FS: 3. Forecast: F(t+h) = (Lₜ + h·Tₜ) × S(t+h-m)
    Note over FS: 4. Compute confidence bounds

    FS->>DB: INSERT INTO demand_forecasts (item_code, forecasted_qty, ...)
    DB-->>FS: Forecasts stored

    FS-->>FM: Forecast results with confidence intervals
    FM-->>U: Display forecast chart + accuracy metrics
```

---

## 8.5 MRP Planning Flow

```mermaid
sequenceDiagram
    participant U as User
    participant PM as PlanningModule UI
    participant PS as PlanningService
    participant DB as PostgreSQL

    U->>PM: Run MRP planning
    PM->>PS: generateRecommendations()

    PS->>DB: SELECT items + inventory + demand_forecasts
    DB-->>PS: Current stock + forecast data

    PS->>DB: SELECT blanket_releases WHERE status = 'PENDING'
    DB-->>PS: Open commitments

    Note over PS: For each item:
    Note over PS: Net Requirement = Forecast - Current + Reserved
    Note over PS: If Net > 0 → Recommend REPLENISH
    Note over PS: If Stock > Max → Recommend REDUCE
    Note over PS: Priority = f(days_of_supply, lead_time)

    PS->>DB: INSERT INTO planning_recommendations
    DB-->>PS: Recommendations stored

    PS-->>PM: Planning results
    PM-->>U: Display recommendations grid with priorities
```

---

## 8.6 User Provisioning Flow (L3 Only)

```mermaid
sequenceDiagram
    participant M as Manager (L3)
    participant UM as UserManagement UI
    participant US as userService
    participant EF as Edge Function
    participant SB as Supabase Auth
    participant DB as PostgreSQL

    M->>UM: Fill user form (name, email, role, dept)
    UM->>US: createUser({ email, fullName, role, ... })
    US->>EF: POST /create-user (with L3 JWT)

    EF->>EF: Validate JWT + verify L3 role
    EF->>SB: admin.createUser({ email, password: temp })
    SB-->>EF: { user_id }

    EF->>DB: INSERT INTO profiles (id, email, full_name, role, ...)
    EF->>DB: INSERT INTO temp_credentials (user_id, hash, expires)
    DB-->>EF: Profile created

    EF-->>US: { success: true, userId, tempPassword }
    US-->>UM: User created
    UM-->>M: Show success + temporary password
```

---

## 8.7 Dashboard Data Aggregation Flow

```mermaid
graph TD
    DASH["DashboardNew Component"]
    HOOK["useDashboard Hook"]

    DASH --> HOOK

    HOOK --> Q1["supabase.from('items').select('*')"]
    HOOK --> Q2["supabase.from('inventory').select('*')"]
    HOOK --> Q3["supabase.from('blanket_orders').select('*').limit(5)"]

    Q1 --> CALC["Calculate Summary"]
    Q2 --> CALC
    Q3 --> CALC

    CALC --> S1["totalItems = items.length"]
    CALC --> S2["lowStockCount = items where stock <= min"]
    CALC --> S3["totalStockValue = Σ(stock × price)"]
    CALC --> S4["alerts = items below reorder point"]

    S1 --> RENDER["Render Dashboard Cards"]
    S2 --> RENDER
    S3 --> RENDER
    S4 --> RENDER

    style DASH fill:#0ea5e9,stroke:#0284c7,color:#fff
    style HOOK fill:#7c3aed,stroke:#6d28d9,color:#fff
    style CALC fill:#10b981,stroke:#059669,color:#fff
```

---

**← Previous**: [07-DATABASE-ARCHITECTURE.md](./07-DATABASE-ARCHITECTURE.md) | **Next**: [09-MODULE-BREAKDOWN.md](./09-MODULE-BREAKDOWN.md) →

---

© 2026 AutoCrat Engineers. All rights reserved.
