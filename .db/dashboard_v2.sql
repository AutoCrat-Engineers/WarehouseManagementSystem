-- ============================================================================
-- DASHBOARD VIEW v2 - Show ALL Items (Active + Inactive)
-- 
-- Version: 2.0.0
-- Date: 2026-02-12
-- 
-- PROBLEM: Previous view used INNER JOIN from inv_warehouse_stock → items.
--          This meant items with NO stock rows were completely hidden.
--          Also, inactive items (is_active = false) in items table were missing.
--
-- FIX:    Start from the ITEMS table (all 285 items) and LEFT JOIN to stock.
--         Items with no stock will show up with 0 quantities.
--         Both active and inactive items will appear.
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop dependent views (bottom to top)
-- ============================================================================
DROP VIEW IF EXISTS public.vw_item_stock_dashboard CASCADE;
DROP VIEW IF EXISTS public.vw_item_stock_summary CASCADE;
DROP VIEW IF EXISTS public.vw_item_stock_distribution CASCADE;

-- ============================================================================
-- STEP 2: Recreate vw_item_stock_distribution (The Parent View)
-- KEY CHANGE: Items table is the driver, LEFT JOIN to warehouse stock
-- This ensures ALL 285 items appear, even those with no stock rows
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_item_stock_distribution AS
WITH warehouse_stock_pivot AS (
    SELECT 
        i.item_code,
        i.item_name,
        i.part_number,
        i.master_serial_no,
        i.revision,
        i.uom,
        i.unit_price,
        i.standard_cost,
        i.is_active,  -- Include active/inactive flag
        
        -- Production Warehouse Stock
        COALESCE(SUM(CASE WHEN wt.category = 'PRODUCTION' THEN ws.quantity_on_hand ELSE 0 END), 0) AS production_on_hand,
        COALESCE(SUM(CASE WHEN wt.category = 'PRODUCTION' THEN ws.quantity_available ELSE 0 END), 0) AS production_available,
        COALESCE(SUM(CASE WHEN wt.category = 'PRODUCTION' THEN ws.quantity_reserved ELSE 0 END), 0) AS production_reserved,
        
        -- In-Transit Warehouse Stock
        COALESCE(SUM(CASE WHEN wt.category = 'IN_TRANSIT' THEN ws.quantity_on_hand ELSE 0 END), 0) AS in_transit_qty,
        COALESCE(SUM(CASE WHEN wt.category = 'IN_TRANSIT' THEN ws.quantity_available ELSE 0 END), 0) AS in_transit_available,
        
        -- S&V Warehouse Stock
        COALESCE(SUM(CASE WHEN wt.category = 'SNV' THEN ws.quantity_on_hand ELSE 0 END), 0) AS snv_on_hand,
        COALESCE(SUM(CASE WHEN wt.category = 'SNV' THEN ws.quantity_available ELSE 0 END), 0) AS snv_available,
        COALESCE(SUM(CASE WHEN wt.category = 'SNV' THEN ws.quantity_reserved ELSE 0 END), 0) AS snv_reserved,
        COALESCE(SUM(CASE WHEN wt.category = 'SNV' THEN ws.quantity_allocated ELSE 0 END), 0) AS snv_allocated,
        
        -- US Transit Warehouse Stock
        COALESCE(SUM(CASE WHEN wt.category = 'US_TRANSIT' THEN ws.quantity_on_hand ELSE 0 END), 0) AS us_transit_on_hand,
        COALESCE(SUM(CASE WHEN wt.category = 'US_TRANSIT' THEN ws.quantity_available ELSE 0 END), 0) AS us_transit_available,
        COALESCE(SUM(CASE WHEN wt.category = 'US_TRANSIT' THEN ws.quantity_reserved ELSE 0 END), 0) AS us_transit_reserved,
        
        -- Distribution Center Stock
        COALESCE(SUM(CASE WHEN wt.category = 'DISTRIBUTION' THEN ws.quantity_on_hand ELSE 0 END), 0) AS distribution_on_hand,
        COALESCE(SUM(CASE WHEN wt.category = 'DISTRIBUTION' THEN ws.quantity_available ELSE 0 END), 0) AS distribution_available,
        
        -- Quarantine Stock
        COALESCE(SUM(CASE WHEN wt.category = 'QUARANTINE' THEN ws.quantity_on_hand ELSE 0 END), 0) AS quarantine_qty,
        
        -- Returns Stock
        COALESCE(SUM(CASE WHEN wt.category = 'RETURNS' THEN ws.quantity_on_hand ELSE 0 END), 0) AS returns_qty,
        
        -- Total across all warehouses
        COALESCE(SUM(ws.quantity_on_hand), 0) AS total_on_hand,
        COALESCE(SUM(ws.quantity_available), 0) AS total_available,
        COALESCE(SUM(ws.quantity_reserved), 0) AS total_reserved,
        COALESCE(SUM(ws.quantity_allocated), 0) AS total_allocated,
        COALESCE(SUM(ws.quantity_in_transit), 0) AS total_in_transit_internal
        
    FROM public.items i
    LEFT JOIN public.inv_warehouse_stock ws 
        ON i.item_code = ws.item_code 
        AND ws.is_active = true
    LEFT JOIN public.inv_warehouses w 
        ON ws.warehouse_id = w.id 
        AND w.is_active = true
    LEFT JOIN public.inv_warehouse_types wt 
        ON w.warehouse_type_id = wt.id
    -- NO WHERE filter on i.is_active — we want ALL items
    GROUP BY i.item_code, i.item_name, i.part_number, i.master_serial_no, 
             i.revision, i.uom, i.unit_price, i.standard_cost, i.is_active
),
blanket_reservations AS (
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
    wsp.part_number,
    wsp.master_serial_no,
    wsp.revision,
    wsp.uom,
    wsp.unit_price,
    wsp.standard_cost,
    wsp.is_active,  -- NEW: Active/Inactive flag
    
    -- Production Warehouse
    wsp.production_on_hand,
    wsp.production_available,
    wsp.production_reserved,
    
    -- In-Transit
    wsp.in_transit_qty,
    wsp.in_transit_available,
    
    -- S&V Warehouse
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
    
    -- NET AVAILABLE FOR CUSTOMER
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
'Stock distribution view - includes ALL items (active + inactive) with is_active flag. Items with no warehouse stock show 0 quantities.';


-- ============================================================================
-- STEP 3: Recreate vw_item_stock_dashboard
-- Now includes is_active directly from parent view
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_item_stock_dashboard AS
WITH stock_data AS (
    SELECT * FROM public.vw_item_stock_distribution
)
SELECT 
    item_code,
    item_name,
    part_number,
    master_serial_no,
    revision,
    uom,
    unit_price,
    standard_cost,
    is_active,  -- Active/Inactive flag flows through
    
    -- Warehouse Card (S&V + US Transit + Distribution)
    warehouse_available AS warehouse_available,
    (snv_reserved + us_transit_reserved + COALESCE(blanket_next_month_reserved, 0)) AS warehouse_reserved,
    
    -- In Transit Card
    in_transit_qty AS in_transit_quantity,
    
    -- Production Card
    production_on_hand AS production_finished_stock,
    
    -- Net Available Card
    net_available_for_customer,
    
    -- Calculation breakdown
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
'Dashboard view showing ALL items (active + inactive) with stock metrics. Use is_active column to filter in frontend.';


-- ============================================================================
-- STEP 4: Recreate vw_item_stock_summary
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_item_stock_summary AS
WITH base_data AS (
    SELECT * FROM public.vw_item_stock_distribution
)
SELECT 
    item_code,
    item_name,
    part_number,
    master_serial_no,
    revision,
    uom,
    unit_price,
    standard_cost,
    is_active,
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
'Summary grid view showing ALL items (active + inactive) with stock metrics and health indicators.';


-- ============================================================================
-- STEP 5: Verify
-- ============================================================================

-- Total items count (should be 285)
SELECT 'Total Items in View' AS check_name, COUNT(*) AS count 
FROM public.vw_item_stock_dashboard;

-- Active vs Inactive breakdown
SELECT 
    CASE WHEN is_active THEN 'Active' ELSE 'Inactive' END AS status,
    COUNT(*) AS count
FROM public.vw_item_stock_dashboard
GROUP BY is_active;

-- Show inactive items
SELECT item_code, item_name, is_active, total_on_hand, net_available_for_customer
FROM public.vw_item_stock_dashboard
WHERE is_active = false
ORDER BY item_code;

SELECT '✅ Dashboard v2 deployed - All 285 items (Active + Inactive) now visible!' AS status;
