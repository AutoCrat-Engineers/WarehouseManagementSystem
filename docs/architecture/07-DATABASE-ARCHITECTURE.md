# 07 — Database Architecture

> Complete schema, entity relationships, views, triggers, and Row Level Security.

---

## 7.1 Entity Relationship Diagram — Full Schema

```mermaid
erDiagram
    %% ====== ITEM & INVENTORY DOMAIN ======
    ITEMS ||--o| INVENTORY : "1:1 stock"
    ITEMS ||--o{ STOCK_MOVEMENTS : "has history"
    ITEMS ||--o{ DEMAND_HISTORY : "has demand"
    ITEMS ||--o{ DEMAND_FORECASTS : "has forecasts"
    ITEMS ||--o{ PLANNING_RECOMMENDATIONS : "has plans"
    ITEMS ||--o{ BLANKET_ORDER_LINES : "ordered in"
    ITEMS ||--o{ BLANKET_ORDER_ITEMS : "included in"
    ITEMS ||--o{ BLANKET_RELEASES : "released for"

    %% ====== ORDER DOMAIN ======
    BLANKET_ORDERS ||--o{ BLANKET_ORDER_LINES : "has lines"
    BLANKET_ORDERS ||--o{ BLANKET_ORDER_ITEMS : "has items"
    BLANKET_ORDERS ||--o{ BLANKET_RELEASES : "has releases"
    BLANKET_ORDER_LINES ||--o{ BLANKET_RELEASES : "released from"

    %% ====== AUTH DOMAIN ======
    AUTH_USERS ||--|| PROFILES : "1:1"
    AUTH_USERS ||--|| USERS : "1:1 (legacy)"
    PROFILES ||--o{ USER_ROLES : "assigned"
    PROFILES ||--o{ TEMP_CREDENTIALS : "temp auth"
    PROFILES ||--o{ AUDIT_LOGS : "logged by"
    ROLES ||--o{ PERMISSIONS : "grants"

    %% ====== TABLE DEFINITIONS ======
    ITEMS {
        uuid id PK
        varchar item_code UK "NOT NULL"
        varchar item_name "NOT NULL"
        varchar uom "DEFAULT PCS"
        numeric unit_price
        numeric standard_cost
        integer lead_time_days "DEFAULT 0"
        boolean is_active "DEFAULT true"
        varchar master_serial_no
        varchar revision
        varchar part_number
        timestamptz created_at
        timestamptz updated_at
    }

    INVENTORY {
        uuid id PK
        varchar item_code UK_FK
        integer current_stock "DEFAULT 0"
        integer allocated_stock "DEFAULT 0"
        integer reserved_stock "DEFAULT 0"
        integer in_transit_stock "DEFAULT 0"
        integer available_stock "COMPUTED"
        timestamptz last_movement_date
        varchar last_movement_type
        timestamptz updated_at
    }

    STOCK_MOVEMENTS {
        uuid id PK
        varchar item_code FK
        varchar movement_type "IN or OUT"
        varchar transaction_type
        integer quantity "NOT NULL"
        integer balance_after "NOT NULL"
        varchar reference_type
        uuid reference_id
        varchar reference_number
        text reason "NOT NULL"
        text notes
        timestamptz created_at
        uuid created_by
    }

    BLANKET_ORDERS {
        uuid id PK
        varchar order_number UK
        varchar customer_name "NOT NULL"
        varchar customer_code
        date order_date "NOT NULL"
        date start_date "NOT NULL"
        date end_date "NOT NULL"
        varchar status "DEFAULT ACTIVE"
        numeric total_value
        varchar sap_doc_no
        varchar customer_po_number
    }

    BLANKET_ORDER_LINES {
        uuid id PK
        uuid order_id FK
        varchar item_code FK
        integer total_quantity "NOT NULL"
        integer released_quantity "DEFAULT 0"
        integer delivered_quantity "DEFAULT 0"
        integer pending_quantity "COMPUTED"
        numeric unit_price
        numeric line_total "COMPUTED"
    }

    BLANKET_ORDER_ITEMS {
        uuid id PK
        uuid blanket_order_id FK
        uuid item_id FK
        integer line_number "NOT NULL"
        numeric quantity "DEFAULT 0"
        numeric unit_price
        integer packing_multiple "DEFAULT 1"
        integer order_multiple "DEFAULT 1"
        integer safety_stock
    }

    BLANKET_RELEASES {
        uuid id PK
        varchar release_number UK
        uuid order_id FK
        uuid line_id FK
        varchar item_code FK
        date release_date "NOT NULL"
        date requested_delivery_date "NOT NULL"
        date actual_delivery_date
        integer requested_quantity "NOT NULL"
        integer delivered_quantity "DEFAULT 0"
        varchar status "DEFAULT PENDING"
        varchar shipment_number
        varchar tracking_number
    }

    DEMAND_HISTORY {
        uuid id PK
        varchar item_code FK
        date demand_date "NOT NULL"
        varchar period_type "DEFAULT MONTHLY"
        numeric demand_quantity "NOT NULL"
        varchar source
    }

    DEMAND_FORECASTS {
        uuid id PK
        varchar item_code FK
        date forecast_date "NOT NULL"
        varchar forecast_period "DEFAULT MONTHLY"
        numeric forecasted_quantity "NOT NULL"
        numeric actual_quantity
        numeric forecast_error
        numeric forecast_accuracy_pct
        varchar model_type "DEFAULT HOLT_WINTERS"
        numeric alpha
        numeric beta
        numeric gamma
        numeric lower_bound
        numeric upper_bound
    }

    PLANNING_RECOMMENDATIONS {
        uuid id PK
        varchar item_code FK
        date planning_date "NOT NULL"
        integer planning_horizon_days
        numeric current_stock
        numeric reserved_stock
        numeric forecasted_demand
        varchar recommended_action "NOT NULL"
        numeric recommended_quantity
        date recommended_date
        text reason
        varchar priority "DEFAULT LOW"
        varchar status "DEFAULT PENDING"
    }

    PROFILES {
        uuid id PK_FK "→ auth.users"
        varchar employee_id UK
        varchar email UK
        varchar full_name "NOT NULL"
        varchar role "DEFAULT L1"
        boolean is_active "DEFAULT true"
        boolean must_change_password "DEFAULT true"
        varchar department
        varchar shift
        jsonb metadata
        timestamptz last_login_at
    }

    ROLES {
        varchar id PK
        varchar name "NOT NULL"
        text description
        integer level "NOT NULL"
    }

    PERMISSIONS {
        uuid id PK
        varchar role_id FK
        varchar module "NOT NULL"
        varchar action "NOT NULL"
        boolean is_allowed "DEFAULT true"
    }

    AUDIT_LOGS {
        uuid id PK
        uuid user_id FK
        varchar action "NOT NULL"
        varchar table_name
        uuid record_id
        jsonb old_values
        jsonb new_values
        uuid performed_by FK
        inet ip_address
        boolean success "DEFAULT true"
        text error_message
    }

    TEMP_CREDENTIALS {
        uuid id PK
        uuid user_id FK
        text temp_password_hash "NOT NULL"
        uuid created_by FK
        timestamptz expires_at "DEFAULT now+24h"
        boolean is_used "DEFAULT false"
    }
```

---

## 7.2 Table Summary

| # | Table | Domain | Row Estimate | Purpose |
|---|-------|--------|-------------|---------|
| 1 | `items` | Item Master | Hundreds | Finished goods catalog |
| 2 | `inventory` | Inventory | 1:1 with items | Current stock levels |
| 3 | `stock_movements` | Inventory | Thousands | Immutable movement ledger |
| 4 | `blanket_orders` | Orders | Tens | Customer scheduling agreements |
| 5 | `blanket_order_items` | Orders | Hundreds | Line items within orders |
| 6 | `blanket_order_lines` | Orders | Hundreds | Order lines with quantities |
| 7 | `blanket_releases` | Orders | Hundreds | Scheduled delivery releases |
| 8 | `demand_history` | Forecasting | Thousands | Historical demand data |
| 9 | `demand_forecasts` | Forecasting | Hundreds | Algorithm forecast output |
| 10 | `planning_recommendations` | Planning | Hundreds | MRP action items |
| 11 | `profiles` | Auth | Tens | User profiles (1:1 with auth.users) |
| 12 | `users` | Auth (Legacy) | Tens | Legacy user table |
| 13 | `roles` | RBAC | 3 | L1, L2, L3 role definitions |
| 14 | `permissions` | RBAC | Dozens | Module-action permissions |
| 15 | `user_roles` | RBAC | Tens | User ↔ Role assignments |
| 16 | `audit_log` | Audit | Thousands | Action audit trail (v1) |
| 17 | `audit_logs` | Audit | Thousands | Enhanced audit trail (v2) |
| 18 | `temp_credentials` | Auth | Low | Temporary password hashes |

---

## 7.3 Key Constraints

### Computed Columns

```sql
-- Inventory: available_stock is auto-calculated
available_stock = current_stock - allocated_stock - reserved_stock

-- Blanket Order Lines: pending quantity
pending_quantity = total_quantity - delivered_quantity

-- Blanket Order Lines: line total
line_total = total_quantity * unit_price
```

### Check Constraints

```sql
-- Users table: role must be one of
CHECK (role IN ('OPERATOR', 'SUPERVISOR', 'MANAGER', 'ADMIN'))

-- Users table: shift must be one of
CHECK (shift IN ('DAY', 'NIGHT', 'AFTERNOON'))

-- Profiles: valid email format
CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
```

---

## 7.4 Database Views

| View | Purpose | Source Tables |
|------|---------|---------------|
| `vw_item_stock_dashboard` | Dashboard KPI cards per item | `items` + `inventory` |
| `vw_item_stock_distribution` | Stock breakdown by category | `items` + `inventory` + `warehouses` |
| `vw_item_warehouse_detail` | Per-warehouse stock levels | `items` + `warehouse_stock` |
| `vw_item_stock_summary` | Summary grid view | `items` + `inventory` |
| `vw_blanket_release_reservations` | Pending release reservations | `blanket_releases` + `blanket_orders` |
| `vw_recent_stock_movements` | Recent movement history | `stock_movements` + `items` + `profiles` |

---

## 7.5 Migration Files

| File | Location | Purpose |
|------|----------|---------|
| `supabasesetup.sql` | `.db_reference/` | Initial database setup (22KB) |
| `rbac.sql` | `.db_reference/` | RBAC tables, roles, policies (19KB) |
| `presentschema.sql` | `.db_reference/` | Current full schema reference |
| `003_add_employee_columns.sql` | `.db_reference/` | Employee fields migration |
| `current-database-schema.sql` | `config/` | Compact schema reference |
| `migration_add_text_columns.sql` | `config/` | Text column additions |
| `migration_stock_movement_v2.sql` | `config/` | Stock movement v2 upgrade |

---

**← Previous**: [06-BACKEND-EDGE-FUNCTIONS.md](./06-BACKEND-EDGE-FUNCTIONS.md) | **Next**: [08-DATA-FLOW-DIAGRAMS.md](./08-DATA-FLOW-DIAGRAMS.md) →

---

© 2026 AutoCrat Engineers. All rights reserved.
