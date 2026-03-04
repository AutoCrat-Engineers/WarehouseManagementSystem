-- ============================================================================
-- PLANNING ENGINE: Analytics Views for Supply Chain Intelligence
-- ============================================================================
-- These views power the Alert Engine dashboard with real-time analytics.
-- ALL views are READ-ONLY projections — no data mutation.
--
-- TABLE RELATIONSHIPS USED:
--
--   items ─┬──> blanket_order_items (via item_id)     → MU, min/max, safety
--          ├──> blanket_order_lines (via item_code)    → qty tracking
--          ├──> blanket_releases (via item_code)       → delivery tracking
--          ├──> inv_warehouse_stock (via item_code)    → multi-warehouse stock
--          ├──> inv_stock_ledger (via item_code)       → movement history
--          ├──> demand_forecasts (via item_code)       → forecast data
--          └──> demand_history (via item_code)         → historical demand
--
--   blanket_orders ──> blanket_order_lines ──> blanket_releases
--   inv_warehouses ──> inv_warehouse_stock
--                  ──> inv_stock_ledger
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEW 1: v_planning_item_summary
-- Master analytics view — one row per item per active BO
-- Combines: item master + BO config + stock position + delivery tracking
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_planning_item_summary AS
SELECT
    -- Item identity
    i.id                              AS item_id,
    i.item_code,
    i.item_name,
    i.uom,
    i.lead_time_days,

    -- Blanket Order identity
    bo.id                             AS blanket_order_id,
    bo.order_number,
    bo.customer_name,
    bo.customer_code,
    bo.status                         AS bo_status,
    bo.start_date                     AS bo_start_date,
    bo.end_date                       AS bo_end_date,

    -- BO Item config (from blanket_order_items — has MU, min/max)
    COALESCE(boi.monthly_usage, 0)    AS monthly_usage,
    COALESCE(boi.min_stock, 0)        AS min_stock,
    COALESCE(boi.max_stock, 0)        AS max_stock,
    COALESCE(boi.safety_stock, 0)     AS safety_stock,
    COALESCE(boi.order_multiple, 1)   AS order_multiple,
    COALESCE(boi.packing_multiple, 1) AS packing_multiple,
    COALESCE(boi.quantity, 0)         AS bo_item_quantity,

    -- BO Line tracking (from blanket_order_lines — has qty tracking)
    COALESCE(bol.total_quantity, 0)   AS bo_line_total_qty,
    COALESCE(bol.released_quantity, 0) AS bo_line_released_qty,
    COALESCE(bol.delivered_quantity, 0) AS bo_line_delivered_qty,
    COALESCE(bol.pending_quantity, 0) AS bo_line_pending_qty,
    bol.id                            AS bo_line_id,

    -- Derived: Annual commitment
    COALESCE(boi.monthly_usage, 0) * 12 AS annual_qty,

    -- Derived: Dynamic min/max from MU (fallback if DB min/max = 0)
    CASE WHEN COALESCE(boi.min_stock, 0) > 0
         THEN boi.min_stock
         ELSE COALESCE(boi.monthly_usage, 0) * 4
    END AS effective_min_stock,

    CASE WHEN COALESCE(boi.max_stock, 0) > 0
         THEN boi.max_stock
         ELSE COALESCE(boi.monthly_usage, 0) * 6
    END AS effective_max_stock,

    -- Aggregate: Stock across ALL warehouses
    COALESCE(stk.total_on_hand, 0)       AS total_on_hand,
    COALESCE(stk.total_allocated, 0)     AS total_allocated,
    COALESCE(stk.total_reserved, 0)      AS total_reserved,
    COALESCE(stk.total_in_transit, 0)    AS total_in_transit,
    COALESCE(stk.total_available, 0)     AS total_available,
    COALESCE(stk.warehouse_count, 0)     AS warehouse_count,

    -- Aggregate: Release tracking
    COALESCE(rel.total_delivered_qty, 0) AS total_delivered,
    COALESCE(rel.total_pending_qty, 0)   AS releases_pending_qty,
    COALESCE(rel.releases_pending, 0)    AS releases_pending_count,
    COALESCE(rel.releases_delivered, 0)  AS releases_delivered_count,

    -- Derived: Remaining commitment
    GREATEST(0,
        COALESCE(boi.monthly_usage, 0) * 12 - COALESCE(rel.total_delivered_qty, 0)
    ) AS remaining_annual,

    -- Derived: Production allowed
    LEAST(
        GREATEST(0, COALESCE(boi.monthly_usage, 0) * 12 - COALESCE(rel.total_delivered_qty, 0)),
        GREATEST(0,
            CASE WHEN COALESCE(boi.max_stock, 0) > 0 THEN boi.max_stock
                 ELSE COALESCE(boi.monthly_usage, 0) * 6
            END - COALESCE(stk.total_on_hand, 0)
        )
    ) AS production_allowed,

    -- Derived: Months of coverage
    CASE WHEN COALESCE(boi.monthly_usage, 0) > 0
         THEN ROUND(COALESCE(stk.total_on_hand, 0)::numeric / boi.monthly_usage, 1)
         ELSE NULL
    END AS months_coverage,

    -- Derived: BO fulfillment %
    CASE WHEN COALESCE(bol.total_quantity, 0) > 0
         THEN ROUND(COALESCE(rel.total_delivered_qty, 0)::numeric / bol.total_quantity * 100, 1)
         ELSE 0
    END AS bo_fulfillment_pct,

    -- Derived: Annual fulfillment %
    CASE WHEN COALESCE(boi.monthly_usage, 0) * 12 > 0
         THEN ROUND(COALESCE(rel.total_delivered_qty, 0)::numeric / (boi.monthly_usage * 12) * 100, 1)
         ELSE 0
    END AS annual_fulfillment_pct,

    -- Derived: Stock status classification
    CASE
        WHEN COALESCE(bol.total_quantity, 0) > 0
             AND COALESCE(rel.total_delivered_qty, 0) >= bol.total_quantity
            THEN 'BO_CONSUMED'
        WHEN COALESCE(stk.total_on_hand, 0) <=
             CASE WHEN COALESCE(boi.min_stock, 0) > 0 THEN boi.min_stock
                  ELSE COALESCE(boi.monthly_usage, 0) * 4 END
             AND GREATEST(0, COALESCE(boi.monthly_usage, 0) * 12 - COALESCE(rel.total_delivered_qty, 0)) > 0
            THEN 'LOW_STOCK'
        WHEN GREATEST(0, COALESCE(boi.monthly_usage, 0) * 12 - COALESCE(rel.total_delivered_qty, 0))
             <= CASE WHEN COALESCE(boi.min_stock, 0) > 0 THEN boi.min_stock
                     ELSE COALESCE(boi.monthly_usage, 0) * 4 END
             AND GREATEST(0, COALESCE(boi.monthly_usage, 0) * 12 - COALESCE(rel.total_delivered_qty, 0)) > 0
            THEN 'COMMITMENT_LOW'
        WHEN COALESCE(stk.total_on_hand, 0) >=
             CASE WHEN COALESCE(boi.max_stock, 0) > 0 THEN boi.max_stock
                  ELSE COALESCE(boi.monthly_usage, 0) * 6 END
            THEN 'MAX_STOCK'
        ELSE 'HEALTHY'
    END AS stock_status

FROM public.items i

-- Join BO items config (has MU, min/max, safety)
LEFT JOIN public.blanket_order_items boi
    ON boi.item_id = i.id AND boi.is_active = true

-- Join BO header
LEFT JOIN public.blanket_orders bo
    ON bo.id = boi.blanket_order_id AND bo.status = 'ACTIVE'

-- Join BO lines (has qty tracking — uses item_code FK)
LEFT JOIN public.blanket_order_lines bol
    ON bol.order_id = bo.id AND bol.item_code = i.item_code

-- Subquery: Aggregate stock across all warehouses
LEFT JOIN LATERAL (
    SELECT
        ws.item_code,
        SUM(ws.quantity_on_hand)   AS total_on_hand,
        SUM(ws.quantity_allocated) AS total_allocated,
        SUM(ws.quantity_reserved)  AS total_reserved,
        SUM(ws.quantity_in_transit) AS total_in_transit,
        SUM(ws.quantity_available) AS total_available,
        COUNT(DISTINCT ws.warehouse_id) AS warehouse_count
    FROM public.inv_warehouse_stock ws
    WHERE ws.item_code = i.item_code AND ws.is_active = true
    GROUP BY ws.item_code
) stk ON true

-- Subquery: Aggregate releases for this BO + item
LEFT JOIN LATERAL (
    SELECT
        br.item_code,
        SUM(CASE WHEN br.status IN ('DELIVERED', 'COMPLETED') THEN br.delivered_quantity ELSE 0 END)
            AS total_delivered_qty,
        SUM(CASE WHEN br.status IN ('PENDING', 'CONFIRMED') THEN br.requested_quantity - COALESCE(br.delivered_quantity, 0) ELSE 0 END)
            AS total_pending_qty,
        COUNT(CASE WHEN br.status IN ('PENDING', 'CONFIRMED') THEN 1 END)
            AS releases_pending,
        COUNT(CASE WHEN br.status IN ('DELIVERED', 'COMPLETED') THEN 1 END)
            AS releases_delivered
    FROM public.blanket_releases br
    WHERE br.order_id = bo.id AND br.item_code = i.item_code
    GROUP BY br.item_code
) rel ON true

WHERE i.is_active = true
  AND bo.id IS NOT NULL;  -- only items with active BOs


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEW 2: v_planning_stock_by_warehouse
-- Per-item stock breakdown by warehouse (for multi-warehouse drill-down)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_planning_stock_by_warehouse AS
SELECT
    i.item_code,
    i.item_name,
    w.id                  AS warehouse_id,
    w.warehouse_code,
    w.warehouse_name,
    wt.type_code          AS warehouse_type,
    wt.category           AS warehouse_category,
    wt.is_transit_point,
    wt.is_production_site,

    ws.quantity_on_hand,
    ws.quantity_allocated,
    ws.quantity_reserved,
    ws.quantity_in_transit,
    ws.quantity_available,
    ws.quality_status,
    ws.last_receipt_date,
    ws.last_issue_date

FROM public.inv_warehouse_stock ws
JOIN public.items i ON i.item_code = ws.item_code
JOIN public.inv_warehouses w ON w.id = ws.warehouse_id AND w.is_active = true
JOIN public.inv_warehouse_types wt ON wt.id = w.warehouse_type_id

WHERE ws.is_active = true;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEW 3: v_planning_release_schedule
-- Upcoming and recent releases per item (for allocation/reservation analytics)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_planning_release_schedule AS
SELECT
    br.id                        AS release_id,
    br.release_number,
    br.item_code,
    i.item_name,
    bo.order_number,
    bo.customer_name,

    br.release_date,
    br.requested_delivery_date,
    br.actual_delivery_date,
    br.requested_quantity,
    br.delivered_quantity,
    br.status,
    br.shipment_number,
    br.tracking_number,

    -- Derived: outstanding quantity for this release
    GREATEST(0, br.requested_quantity - COALESCE(br.delivered_quantity, 0))
        AS outstanding_qty,

    -- Derived: days until requested delivery
    (br.requested_delivery_date - CURRENT_DATE) AS days_until_delivery,

    -- Derived: is overdue?
    CASE WHEN br.status IN ('PENDING', 'CONFIRMED')
              AND br.requested_delivery_date < CURRENT_DATE
         THEN true ELSE false
    END AS is_overdue,

    -- Stock reserved against this release (from inv_blanket_release_stock)
    COALESCE(brs.qty_reserved_from_stock, 0) AS qty_reserved_from_stock

FROM public.blanket_releases br
JOIN public.items i ON i.item_code = br.item_code
JOIN public.blanket_orders bo ON bo.id = br.order_id

-- Subquery: Stock reserved for this release
LEFT JOIN LATERAL (
    SELECT SUM(ibrs.quantity_released) AS qty_reserved_from_stock
    FROM public.inv_blanket_release_stock ibrs
    WHERE ibrs.release_id = br.id
) brs ON true

ORDER BY br.requested_delivery_date;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEW 4: v_planning_monthly_activity
-- Monthly inbound/outbound activity per item (for trend analysis)
-- Derived from inv_stock_ledger
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_planning_monthly_activity AS
SELECT
    sl.item_code,
    DATE_TRUNC('month', sl.ledger_date)::date AS activity_month,

    -- Inbound (positive qty changes = receipts/production)
    SUM(CASE WHEN sl.quantity_change > 0 THEN sl.quantity_change ELSE 0 END) AS inbound_qty,

    -- Outbound (negative qty changes = issues/deliveries)
    SUM(CASE WHEN sl.quantity_change < 0 THEN ABS(sl.quantity_change) ELSE 0 END) AS outbound_qty,

    -- Net change
    SUM(sl.quantity_change) AS net_change,

    -- Transaction count
    COUNT(*) AS transaction_count,

    -- Ending balance (last entry of the month)
    (ARRAY_AGG(sl.quantity_after ORDER BY sl.ledger_date DESC))[1] AS ending_balance

FROM public.inv_stock_ledger sl
GROUP BY sl.item_code, DATE_TRUNC('month', sl.ledger_date)
ORDER BY sl.item_code, activity_month;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEW 5: v_planning_commitment_tracker
-- Per-item annual commitment fulfillment status
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_planning_commitment_tracker AS
SELECT
    i.item_code,
    i.item_name,
    bo.order_number,
    bo.customer_name,
    bo.start_date,
    bo.end_date,

    -- Config
    COALESCE(boi.monthly_usage, 0)        AS monthly_usage,
    COALESCE(boi.monthly_usage, 0) * 12   AS annual_commitment,
    COALESCE(boi.quantity, 0)             AS bo_quantity,

    -- Fulfillment
    COALESCE(bol.total_quantity, 0)       AS bo_line_qty,
    COALESCE(bol.released_quantity, 0)    AS released_qty,
    COALESCE(bol.delivered_quantity, 0)   AS delivered_qty,
    COALESCE(bol.pending_quantity, 0)     AS pending_qty,

    -- Derived
    GREATEST(0,
        COALESCE(boi.monthly_usage, 0) * 12 - COALESCE(bol.delivered_quantity, 0)
    ) AS remaining_annual,

    -- Months remaining in BO period
    GREATEST(0,
        EXTRACT(MONTH FROM AGE(bo.end_date, CURRENT_DATE))
        + EXTRACT(YEAR FROM AGE(bo.end_date, CURRENT_DATE)) * 12
    )::integer AS months_remaining_in_bo,

    -- Required monthly rate to fulfill commitment
    CASE WHEN GREATEST(0, EXTRACT(MONTH FROM AGE(bo.end_date, CURRENT_DATE))
                          + EXTRACT(YEAR FROM AGE(bo.end_date, CURRENT_DATE)) * 12) > 0
         THEN ROUND(
              GREATEST(0, COALESCE(boi.monthly_usage, 0) * 12 - COALESCE(bol.delivered_quantity, 0))::numeric
              / GREATEST(1, EXTRACT(MONTH FROM AGE(bo.end_date, CURRENT_DATE))
                            + EXTRACT(YEAR FROM AGE(bo.end_date, CURRENT_DATE)) * 12)
         , 0)
         ELSE 0
    END AS required_monthly_rate

FROM public.items i
JOIN public.blanket_order_items boi ON boi.item_id = i.id AND boi.is_active = true
JOIN public.blanket_orders bo ON bo.id = boi.blanket_order_id AND bo.status = 'ACTIVE'
LEFT JOIN public.blanket_order_lines bol ON bol.order_id = bo.id AND bol.item_code = i.item_code

WHERE i.is_active = true;
