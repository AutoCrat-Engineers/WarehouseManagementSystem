-- ============================================================================
-- INVENTORY VIEWS UPDATE SCRIPT
-- Updates vw_item_stock_dashboard to include additional item columns
-- 
-- Version: 1.1.0
-- Date: 2026-02-06
-- Purpose: Add item description, part_number, master_serial_no to dashboard view
-- ============================================================================

-- ============================================================================
-- DROP EXISTING VIEWS (in reverse dependency order)
-- Views must be dropped before recreating with new column structure
-- ============================================================================

DROP VIEW IF EXISTS public.vw_item_stock_dashboard CASCADE;
DROP VIEW IF EXISTS public.vw_item_stock_summary CASCADE;
DROP VIEW IF EXISTS public.vw_item_warehouse_detail CASCADE;
DROP VIEW IF EXISTS public.vw_item_stock_distribution CASCADE;

-- ============================================================================
-- DROP EXISTING FUNCTIONS (return type is changing)
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_get_item_stock_dashboard(character varying);
DROP FUNCTION IF EXISTS public.fn_get_all_items_stock_dashboard();

-- ============================================================================
-- CREATE VIEW: vw_item_stock_distribution
-- Add item details: part_number, master_serial_no, revision
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_item_stock_distribution AS
WITH warehouse_stock_pivot AS (
    SELECT 
        ws.item_code,
        i.item_name,
        i.part_number,
        i.master_serial_no,
        i.revision,
        i.uom,
        i.unit_price,
        i.standard_cost,
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
    GROUP BY ws.item_code, i.item_name, i.part_number, i.master_serial_no, i.revision, i.uom, i.unit_price, i.standard_cost
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
    wsp.part_number,
    wsp.master_serial_no,
    wsp.revision,
    wsp.uom,
    wsp.unit_price,
    wsp.standard_cost,
    
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
'Comprehensive stock distribution view per item across all warehouse types with Net Available calculation - includes part_number, master_serial_no, revision';


-- ============================================================================
-- CREATE VIEW: vw_item_stock_dashboard
-- Add item details for frontend display
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
'Dashboard view with item details (part_number, master_serial_no, revision) for UI Stock Distribution & Movements card';


-- ============================================================================
-- CREATE VIEW: vw_item_stock_summary
-- Add item details for grid listing
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
'Summary grid view with item details (part_number, master_serial_no) for all items with key stock metrics';


-- ============================================================================
-- CREATE VIEW: vw_item_warehouse_detail
-- Ensure item details are included
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_item_warehouse_detail AS
SELECT 
    ws.item_code,
    i.item_name,
    i.part_number,
    i.master_serial_no,
    i.revision,
    i.uom,
    i.unit_price,
    i.standard_cost,
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
'Detailed stock view per item per warehouse with lot/batch details and item identifiers (part_number, master_serial_no)';


-- ============================================================================
-- RECREATE FUNCTIONS (they depend on views)
-- ============================================================================

-- Function: Get Stock Dashboard Data for Single Item
CREATE OR REPLACE FUNCTION public.fn_get_item_stock_dashboard(p_item_code character varying)
RETURNS TABLE (
    item_code character varying,
    item_name character varying,
    part_number character varying,
    master_serial_no character varying,
    revision character varying,
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
        d.item_code::character varying,
        d.item_name::character varying,
        d.part_number::character varying,
        d.master_serial_no::character varying,
        d.revision::character varying,
        d.uom::character varying,
        d.warehouse_available::integer,
        d.warehouse_reserved::integer,
        d.in_transit_quantity::integer,
        d.production_finished_stock::integer,
        d.net_available_for_customer::integer,
        d.calculation_formula,
        d.stock_status::character varying
    FROM public.vw_item_stock_dashboard d
    WHERE d.item_code = p_item_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.fn_get_item_stock_dashboard IS 
'Get dashboard stock data for a single item with part_number and master_serial_no - optimized for API calls';


-- Function: Get All Items Stock Dashboard
CREATE OR REPLACE FUNCTION public.fn_get_all_items_stock_dashboard()
RETURNS TABLE (
    item_code character varying,
    item_name character varying,
    part_number character varying,
    master_serial_no character varying,
    revision character varying,
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
        d.item_code::character varying,
        d.item_name::character varying,
        d.part_number::character varying,
        d.master_serial_no::character varying,
        d.revision::character varying,
        d.uom::character varying,
        d.warehouse_available::integer,
        d.warehouse_reserved::integer,
        d.in_transit_quantity::integer,
        d.production_finished_stock::integer,
        d.net_available_for_customer::integer,
        d.stock_status::character varying
    FROM public.vw_item_stock_dashboard d
    ORDER BY d.item_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.fn_get_all_items_stock_dashboard IS 
'Get all items stock dashboard data with part_number and master_serial_no';


-- ============================================================================
-- VERIFY UPDATES
-- ============================================================================

SELECT 'Views updated successfully. New columns added: part_number, master_serial_no, revision' AS status;

-- Sample query to verify columns
SELECT item_code, item_name, part_number, master_serial_no, revision, warehouse_available, net_available_for_customer
FROM public.vw_item_stock_dashboard
LIMIT 5;
