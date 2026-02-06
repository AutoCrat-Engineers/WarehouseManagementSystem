-- ============================================================================
-- ENTERPRISE INVENTORY VIEWS
-- Multi-Warehouse Stock Summary Views for Frontend UI
-- 
-- Version: 1.0.0
-- Date: 2026-02-06
-- Purpose: Provide consolidated stock visibility for frontend dashboards
-- ============================================================================

-- ============================================================================
-- VIEW 1: Item Stock Distribution by Warehouse Type
-- Shows stock breakdown per item across all warehouse types
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_item_stock_distribution AS
WITH warehouse_stock_pivot AS (
    SELECT 
        ws.item_code,
        i.item_name,
        i.uom,
        -- Production Warehouse Stock
        SUM(CASE WHEN wt.category = 'PRODUCTION' THEN ws.quantity_on_hand ELSE 0 END) AS production_on_hand,
        SUM(CASE WHEN wt.category = 'PRODUCTION' THEN ws.quantity_available ELSE 0 END) AS production_available,
        SUM(CASE WHEN wt.category = 'PRODUCTION' THEN ws.quantity_reserved ELSE 0 END) AS production_reserved,
        
        -- In-Transit Warehouse Stock
        SUM(CASE WHEN wt.category = 'IN_TRANSIT' THEN ws.quantity_on_hand ELSE 0 END) AS in_transit_qty,
        SUM(CASE WHEN wt.category = 'IN_TRANSIT' THEN ws.quantity_available ELSE 0 END) AS in_transit_available,
        
        -- S&V Warehouse Stock
        SUM(CASE WHEN wt.category = 'SNV' THEN ws.quantity_on_hand ELSE 0 END) AS snv_on_hand,
        SUM(CASE WHEN wt.category = 'SNV' THEN ws.quantity_available ELSE 0 END) AS snv_available,
        SUM(CASE WHEN wt.category = 'SNV' THEN ws.quantity_reserved ELSE 0 END) AS snv_reserved,
        SUM(CASE WHEN wt.category = 'SNV' THEN ws.quantity_allocated ELSE 0 END) AS snv_allocated,
        
        -- US Transit Warehouse Stock
        SUM(CASE WHEN wt.category = 'US_TRANSIT' THEN ws.quantity_on_hand ELSE 0 END) AS us_transit_on_hand,
        SUM(CASE WHEN wt.category = 'US_TRANSIT' THEN ws.quantity_available ELSE 0 END) AS us_transit_available,
        SUM(CASE WHEN wt.category = 'US_TRANSIT' THEN ws.quantity_reserved ELSE 0 END) AS us_transit_reserved,
        
        -- Distribution Center Stock
        SUM(CASE WHEN wt.category = 'DISTRIBUTION' THEN ws.quantity_on_hand ELSE 0 END) AS distribution_on_hand,
        SUM(CASE WHEN wt.category = 'DISTRIBUTION' THEN ws.quantity_available ELSE 0 END) AS distribution_available,
        
        -- Quarantine Stock
        SUM(CASE WHEN wt.category = 'QUARANTINE' THEN ws.quantity_on_hand ELSE 0 END) AS quarantine_qty,
        
        -- Returns Stock
        SUM(CASE WHEN wt.category = 'RETURNS' THEN ws.quantity_on_hand ELSE 0 END) AS returns_qty,
        
        -- Total across all warehouses
        SUM(ws.quantity_on_hand) AS total_on_hand,
        SUM(ws.quantity_available) AS total_available,
        SUM(ws.quantity_reserved) AS total_reserved,
        SUM(ws.quantity_allocated) AS total_allocated,
        SUM(ws.quantity_in_transit) AS total_in_transit_internal
        
    FROM public.inv_warehouse_stock ws
    JOIN public.inv_warehouses w ON ws.warehouse_id = w.id
    JOIN public.inv_warehouse_types wt ON w.warehouse_type_id = wt.id
    JOIN public.items i ON ws.item_code = i.item_code
    WHERE ws.is_active = true
      AND w.is_active = true
    GROUP BY ws.item_code, i.item_name, i.uom
),
blanket_reservations AS (
    -- Calculate reserved quantity from blanket releases for next month
    SELECT 
        br.item_code,
        COALESCE(SUM(br.requested_quantity - br.delivered_quantity), 0) AS pending_release_qty,
        COALESCE(SUM(
            CASE 
                WHEN br.requested_delivery_date >= DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month')
                     AND br.requested_delivery_date < DATE_TRUNC('month', CURRENT_DATE + INTERVAL '2 months')
                THEN br.requested_quantity - br.delivered_quantity
                ELSE 0 
            END
        ), 0) AS next_month_reserved
    FROM public.blanket_releases br
    WHERE br.status IN ('PENDING', 'CONFIRMED', 'IN_TRANSIT')
    GROUP BY br.item_code
)
SELECT 
    wsp.item_code,
    wsp.item_name,
    wsp.uom,
    
    -- Production Warehouse
    wsp.production_on_hand,
    wsp.production_available,
    wsp.production_reserved,
    
    -- In-Transit (between warehouses)
    wsp.in_transit_qty,
    wsp.in_transit_available,
    
    -- S&V Warehouse (main shipping warehouse)
    wsp.snv_on_hand,
    wsp.snv_available,
    wsp.snv_reserved,
    wsp.snv_allocated,
    
    -- US Transit Warehouse
    wsp.us_transit_on_hand,
    wsp.us_transit_available,
    wsp.us_transit_reserved,
    
    -- Distribution
    wsp.distribution_on_hand,
    wsp.distribution_available,
    
    -- Quality Hold
    wsp.quarantine_qty,
    wsp.returns_qty,
    
    -- Totals
    wsp.total_on_hand,
    wsp.total_available,
    wsp.total_reserved,
    wsp.total_allocated,
    
    -- Blanket Release Reservations
    COALESCE(br.pending_release_qty, 0) AS blanket_pending_qty,
    COALESCE(br.next_month_reserved, 0) AS blanket_next_month_reserved,
    
    -- ============================================
    -- NET AVAILABLE FOR CUSTOMER CALCULATION
    -- = S&V Available + US Transit Available + In Transit - Next Month Reserved
    -- ============================================
    (
        wsp.snv_available + 
        wsp.us_transit_available + 
        wsp.in_transit_available - 
        COALESCE(br.next_month_reserved, 0)
    ) AS net_available_for_customer,
    
    -- Warehouse Available (S&V + US Transit + Distribution)
    (wsp.snv_available + wsp.us_transit_available + wsp.distribution_available) AS warehouse_available,
    
    -- Total Reserved (all sources)
    (wsp.total_reserved + COALESCE(br.next_month_reserved, 0)) AS total_customer_reserved

FROM warehouse_stock_pivot wsp
LEFT JOIN blanket_reservations br ON wsp.item_code = br.item_code;

COMMENT ON VIEW public.vw_item_stock_distribution IS 
'Comprehensive stock distribution view per item across all warehouse types with Net Available calculation';


-- ============================================================================
-- VIEW 2: Frontend Dashboard Summary (Matches UI Mockup)
-- Simplified view for the Stock Distribution & Movements card
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_item_stock_dashboard AS
WITH stock_data AS (
    SELECT * FROM public.vw_item_stock_distribution
)
SELECT 
    item_code,
    item_name,
    uom,
    
    -- Warehouse Card (S&V + US Transit + Distribution)
    warehouse_available AS warehouse_available,
    (snv_reserved + us_transit_reserved + COALESCE(blanket_next_month_reserved, 0)) AS warehouse_reserved,
    
    -- In Transit Card
    in_transit_qty AS in_transit_quantity,
    
    -- Production Card
    production_on_hand AS production_finished_stock,
    
    -- Net Available Card
    net_available_for_customer,
    
    -- Calculation breakdown for tooltip/expansion
    snv_available AS snv_stock,
    us_transit_available AS us_transit_stock,
    in_transit_available AS in_transit_stock,
    blanket_next_month_reserved AS reserved_next_month,
    
    -- Formula display
    FORMAT(
        '= Warehouse Available (%s) + In Transit (%s) − Reserved (%s)',
        warehouse_available::text,
        in_transit_qty::text,
        (snv_reserved + us_transit_reserved + COALESCE(blanket_next_month_reserved, 0))::text
    ) AS calculation_formula,
    
    -- Status indicators
    CASE 
        WHEN net_available_for_customer < 0 THEN 'CRITICAL'
        WHEN net_available_for_customer < 50 THEN 'LOW'
        WHEN net_available_for_customer < 200 THEN 'MEDIUM'
        ELSE 'HEALTHY'
    END AS stock_status,
    
    -- Totals
    total_on_hand,
    total_available,
    quarantine_qty AS quality_hold_qty
    
FROM stock_data;

COMMENT ON VIEW public.vw_item_stock_dashboard IS 
'Simplified dashboard view matching the UI Stock Distribution & Movements card design';


-- ============================================================================
-- VIEW 3: Detailed Warehouse Stock per Item
-- For drilling down into specific warehouse details
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_item_warehouse_detail AS
SELECT 
    ws.item_code,
    i.item_name,
    i.uom,
    w.warehouse_code,
    w.warehouse_name,
    wt.type_code AS warehouse_type_code,
    wt.type_name AS warehouse_type_name,
    wt.category AS warehouse_category,
    w.country_code,
    ws.lot_number,
    ws.batch_number,
    ws.quantity_on_hand,
    ws.quantity_allocated,
    ws.quantity_reserved,
    ws.quantity_available,
    ws.quality_status,
    ws.storage_location,
    ws.bin_number,
    ws.expiry_date,
    ws.last_receipt_date,
    ws.last_issue_date,
    ws.unit_cost,
    (ws.quantity_on_hand * COALESCE(ws.unit_cost, 0)) AS stock_value,
    ws.updated_at AS last_updated
FROM public.inv_warehouse_stock ws
JOIN public.inv_warehouses w ON ws.warehouse_id = w.id
JOIN public.inv_warehouse_types wt ON w.warehouse_type_id = wt.id
JOIN public.items i ON ws.item_code = i.item_code
WHERE ws.is_active = true
  AND w.is_active = true
ORDER BY ws.item_code, wt.sort_order, w.warehouse_code;

COMMENT ON VIEW public.vw_item_warehouse_detail IS 
'Detailed stock view per item per warehouse with lot/batch details';


-- ============================================================================
-- VIEW 4: Stock Summary for All Items (Grid View)
-- For main inventory listing table
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_item_stock_summary AS
WITH base_data AS (
    SELECT * FROM public.vw_item_stock_distribution
)
SELECT 
    item_code,
    item_name,
    uom,
    production_on_hand AS production_stock,
    in_transit_qty AS in_transit_stock,
    (snv_on_hand + us_transit_on_hand + distribution_on_hand) AS warehouse_stock,
    (snv_available + us_transit_available + distribution_available) AS warehouse_available,
    (snv_reserved + us_transit_reserved) AS warehouse_reserved,
    quarantine_qty AS quality_hold,
    blanket_next_month_reserved AS upcoming_releases,
    net_available_for_customer,
    total_on_hand AS grand_total,
    
    -- Availability percentage
    CASE 
        WHEN total_on_hand > 0 
        THEN ROUND((net_available_for_customer::numeric / total_on_hand::numeric) * 100, 1)
        ELSE 0 
    END AS availability_pct,
    
    -- Stock health indicator
    CASE 
        WHEN net_available_for_customer < 0 THEN 'danger'
        WHEN net_available_for_customer < 50 THEN 'warning'
        ELSE 'success'
    END AS health_indicator
    
FROM base_data
ORDER BY item_code;

COMMENT ON VIEW public.vw_item_stock_summary IS 
'Summary grid view for all items with key stock metrics';


-- ============================================================================
-- VIEW 5: Blanket Release Reserved Quantity Detail
-- Shows what's reserved against blanket orders
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_blanket_release_reservations AS
SELECT 
    br.item_code,
    i.item_name,
    bo.order_number AS blanket_order_number,
    bo.customer_name,
    br.release_number,
    br.release_date,
    br.requested_delivery_date,
    br.requested_quantity,
    br.delivered_quantity,
    (br.requested_quantity - br.delivered_quantity) AS pending_quantity,
    br.status,
    
    -- Categorize by timing
    CASE 
        WHEN br.requested_delivery_date < CURRENT_DATE THEN 'OVERDUE'
        WHEN br.requested_delivery_date <= DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day' 
            THEN 'CURRENT_MONTH'
        WHEN br.requested_delivery_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '2 months'
            THEN 'NEXT_MONTH'
        ELSE 'FUTURE'
    END AS delivery_period,
    
    br.created_at,
    br.updated_at

FROM public.blanket_releases br
JOIN public.blanket_orders bo ON br.order_id = bo.id
JOIN public.items i ON br.item_code = i.item_code
WHERE br.status IN ('PENDING', 'CONFIRMED', 'IN_TRANSIT')
  AND (br.requested_quantity - br.delivered_quantity) > 0
ORDER BY br.requested_delivery_date, br.item_code;

COMMENT ON VIEW public.vw_blanket_release_reservations IS 
'Detailed view of pending blanket release reservations by delivery period';


-- ============================================================================
-- VIEW 6: Stock Movement History for Item
-- Recent movements across all warehouses
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_recent_stock_movements AS
SELECT 
    sl.item_code,
    i.item_name,
    w.warehouse_code,
    w.warehouse_name,
    wt.type_name AS warehouse_type,
    sl.transaction_type::text AS movement_type,
    sl.quantity_change,
    sl.quantity_before,
    sl.quantity_after,
    sl.lot_number,
    sl.batch_number,
    sl.reference_type,
    sl.reference_number,
    sl.reason_code,
    sl.notes,
    
    -- Source/Destination for transfers
    sw.warehouse_code AS source_warehouse,
    dw.warehouse_code AS destination_warehouse,
    
    sl.ledger_date AS movement_date,
    p.full_name AS created_by_name

FROM public.inv_stock_ledger sl
JOIN public.inv_warehouses w ON sl.warehouse_id = w.id
JOIN public.inv_warehouse_types wt ON w.warehouse_type_id = wt.id
JOIN public.items i ON sl.item_code = i.item_code
LEFT JOIN public.inv_warehouses sw ON sl.source_warehouse_id = sw.id
LEFT JOIN public.inv_warehouses dw ON sl.destination_warehouse_id = dw.id
LEFT JOIN public.profiles p ON sl.created_by = p.id
ORDER BY sl.ledger_date DESC;

COMMENT ON VIEW public.vw_recent_stock_movements IS 
'Recent stock movements from the ledger for transaction history display';


-- ============================================================================
-- INDEXES TO SUPPORT VIEWS (if not already exist)
-- ============================================================================

-- Ensure fast blanket release queries by delivery date
CREATE INDEX IF NOT EXISTS idx_blanket_releases_delivery_date 
    ON public.blanket_releases(requested_delivery_date);
    
CREATE INDEX IF NOT EXISTS idx_blanket_releases_item_status 
    ON public.blanket_releases(item_code, status);


-- ============================================================================
-- FUNCTION: Get Stock Dashboard Data for Single Item
-- For API endpoint efficiency
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_item_stock_dashboard(p_item_code character varying)
RETURNS TABLE (
    item_code character varying,
    item_name character varying,
    uom character varying,
    warehouse_available integer,
    warehouse_reserved integer,
    in_transit_quantity integer,
    production_finished_stock integer,
    net_available_for_customer integer,
    calculation_formula text,
    stock_status character varying
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.item_code,
        d.item_name,
        d.uom,
        d.warehouse_available::integer,
        d.warehouse_reserved::integer,
        d.in_transit_quantity::integer,
        d.production_finished_stock::integer,
        d.net_available_for_customer::integer,
        d.calculation_formula,
        d.stock_status
    FROM public.vw_item_stock_dashboard d
    WHERE d.item_code = p_item_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.fn_get_item_stock_dashboard IS 
'Get dashboard stock data for a single item - optimized for API calls';


-- ============================================================================
-- FUNCTION: Get All Items Stock Dashboard
-- For main inventory grid
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_all_items_stock_dashboard()
RETURNS TABLE (
    item_code character varying,
    item_name character varying,
    uom character varying,
    warehouse_available integer,
    warehouse_reserved integer,
    in_transit_quantity integer,
    production_finished_stock integer,
    net_available_for_customer integer,
    stock_status character varying
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.item_code,
        d.item_name,
        d.uom,
        d.warehouse_available::integer,
        d.warehouse_reserved::integer,
        d.in_transit_quantity::integer,
        d.production_finished_stock::integer,
        d.net_available_for_customer::integer,
        d.stock_status
    FROM public.vw_item_stock_dashboard d
    ORDER BY d.item_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- END OF INVENTORY VIEWS
-- ============================================================================
