-- ============================================================================
-- ADD is_active COLUMN TO vw_item_stock_dashboard
-- 
-- Version: 1.1.1
-- Date: 2026-02-06
-- Purpose: Add is_active from items table to dashboard view
-- ============================================================================

-- Drop only the dashboard view (it's the final consumer, no dependencies on it)
DROP VIEW IF EXISTS public.vw_item_stock_dashboard;

-- Recreate with is_active column from items table
CREATE OR REPLACE VIEW public.vw_item_stock_dashboard AS
WITH stock_data AS (
    SELECT * FROM public.vw_item_stock_distribution
)
SELECT 
    sd.item_code,
    sd.item_name,
    sd.part_number,
    sd.master_serial_no,
    sd.revision,
    sd.uom,
    sd.unit_price,
    sd.standard_cost,
    
    -- Warehouse Card (S&V + US Transit + Distribution)
    sd.warehouse_available AS warehouse_available,
    (sd.snv_reserved + sd.us_transit_reserved + COALESCE(sd.blanket_next_month_reserved, 0)) AS warehouse_reserved,
    
    -- In Transit Card
    sd.in_transit_qty AS in_transit_quantity,
    
    -- Production Card
    sd.production_on_hand AS production_finished_stock,
    
    -- Net Available Card
    sd.net_available_for_customer,
    
    -- Calculation breakdown for tooltip/expansion
    sd.snv_available AS snv_stock,
    sd.us_transit_available AS us_transit_stock,
    sd.in_transit_available AS in_transit_stock,
    sd.blanket_next_month_reserved AS reserved_next_month,
    
    -- Formula display
    FORMAT(
        '= Warehouse Available (%s) + In Transit (%s) − Reserved (%s)',
        sd.warehouse_available::text,
        sd.in_transit_qty::text,
        (sd.snv_reserved + sd.us_transit_reserved + COALESCE(sd.blanket_next_month_reserved, 0))::text
    ) AS calculation_formula,
    
    -- Status indicators
    CASE 
        WHEN sd.net_available_for_customer < 0 THEN 'CRITICAL'
        WHEN sd.net_available_for_customer < 50 THEN 'LOW'
        WHEN sd.net_available_for_customer < 200 THEN 'MEDIUM'
        ELSE 'HEALTHY'
    END AS stock_status,
    
    -- Totals
    sd.total_on_hand,
    sd.total_available,
    sd.quarantine_qty AS quality_hold_qty,
    
    -- *** NEW COLUMN: is_active from items table ***
    i.is_active
    
FROM stock_data sd
JOIN public.items i ON sd.item_code = i.item_code;

COMMENT ON VIEW public.vw_item_stock_dashboard IS 
'Dashboard view with item details including is_active flag from items table';

-- Verify the new column is added
SELECT 'is_active column added successfully' AS status;
SELECT item_code, item_name, is_active FROM public.vw_item_stock_dashboard LIMIT 5;
