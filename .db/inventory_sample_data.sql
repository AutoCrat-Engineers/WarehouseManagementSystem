-- ============================================================================
-- INVENTORY SAMPLE DATA
-- Run this after running inventory_extension.sql and inventory_views.sql
-- ============================================================================

-- ============================================================================
-- 1. SKIP WAREHOUSE TYPES (Already seeded in inventory_extension.sql SECTION 15)
-- ============================================================================
-- Warehouse types are already created in inventory_extension.sql with these codes:
-- PROD, INTRANS, SNV, USTRANS, DIST, RETURN, QUAR

-- ============================================================================
-- 2. INSERT WAREHOUSES (matching actual table schema)
-- ============================================================================

-- S&V Warehouse (Main shipping warehouse)
INSERT INTO public.inv_warehouses (warehouse_code, warehouse_name, warehouse_type_id, country_code, city, address)
SELECT 
    'WH-SNV-MAIN',
    'Main S&V Warehouse',
    wt.id,
    'IND',
    'Chennai',
    '123 Industrial Park'
FROM public.inv_warehouse_types wt WHERE wt.type_code = 'SNV'
ON CONFLICT (warehouse_code) DO NOTHING;

-- US Transit Warehouse
INSERT INTO public.inv_warehouses (warehouse_code, warehouse_name, warehouse_type_id, country_code, city, address)
SELECT 
    'WH-US-TRANSIT',
    'US Transit Warehouse',
    wt.id,
    'USA',
    'Houston',
    '456 Transit Hub'
FROM public.inv_warehouse_types wt WHERE wt.type_code = 'USTRANS'
ON CONFLICT (warehouse_code) DO NOTHING;

-- In Transit Warehouse
INSERT INTO public.inv_warehouses (warehouse_code, warehouse_name, warehouse_type_id, country_code, city, address)
SELECT 
    'WH-INTRANSIT',
    'In Transit Storage',
    wt.id,
    'IND',
    'Various',
    'Multiple Locations'
FROM public.inv_warehouse_types wt WHERE wt.type_code = 'INTRANS'
ON CONFLICT (warehouse_code) DO NOTHING;

-- Production Floor Warehouse
INSERT INTO public.inv_warehouses (warehouse_code, warehouse_name, warehouse_type_id, country_code, city, address)
SELECT 
    'WH-PROD-FLOOR',
    'Production Floor',
    wt.id,
    'IND',
    'Chennai',
    '123 Industrial Park - Production'
FROM public.inv_warehouse_types wt WHERE wt.type_code = 'PROD'
ON CONFLICT (warehouse_code) DO NOTHING;

-- ============================================================================
-- 3. INSERT SAMPLE WAREHOUSE STOCK FOR EXISTING ITEMS
-- ============================================================================
-- This inserts stock for all existing items from the items table

-- S&V Warehouse Stock (main warehouse)
INSERT INTO public.inv_warehouse_stock (
    warehouse_id,
    item_code,
    lot_number,
    quantity_on_hand,
    quantity_allocated,
    quantity_reserved,
    quantity_in_transit,
    quality_status,
    last_receipt_date
)
SELECT 
    w.id,
    i.item_code,
    'LOT-' || substring(md5(i.item_code || 'LOT1'), 1, 8),
    -- Generate random stock between 200-800
    FLOOR(RANDOM() * 600 + 200)::integer,
    -- Allocated: 5-15% of on_hand
    FLOOR((FLOOR(RANDOM() * 600 + 200)) * (5 + RANDOM() * 10) / 100)::integer,
    -- Reserved: 10-25% of on_hand for blanket orders
    FLOOR((FLOOR(RANDOM() * 600 + 200)) * (10 + RANDOM() * 15) / 100)::integer,
    0,
    'GOOD',
    NOW() - (FLOOR(RANDOM() * 30) || ' days')::interval
FROM public.items i
CROSS JOIN public.inv_warehouses w
WHERE w.warehouse_code = 'WH-SNV-MAIN'
  AND i.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.inv_warehouse_stock ws 
    WHERE ws.warehouse_id = w.id AND ws.item_code = i.item_code
  );

-- US Transit Warehouse Stock (smaller quantities)
INSERT INTO public.inv_warehouse_stock (
    warehouse_id,
    item_code,
    lot_number,
    quantity_on_hand,
    quantity_allocated,
    quantity_reserved,
    quantity_in_transit,
    quality_status,
    last_receipt_date
)
SELECT 
    w.id,
    i.item_code,
    'LOT-US-' || substring(md5(i.item_code || 'USLOT'), 1, 6),
    -- Generate random stock between 50-200
    FLOOR(RANDOM() * 150 + 50)::integer,
    0,
    0,
    0,
    'GOOD',
    NOW() - (FLOOR(RANDOM() * 15) || ' days')::interval
FROM public.items i
CROSS JOIN public.inv_warehouses w
WHERE w.warehouse_code = 'WH-US-TRANSIT'
  AND i.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.inv_warehouse_stock ws 
    WHERE ws.warehouse_id = w.id AND ws.item_code = i.item_code
  );

-- In Transit Stock
INSERT INTO public.inv_warehouse_stock (
    warehouse_id,
    item_code,
    lot_number,
    quantity_on_hand,
    quantity_allocated,
    quantity_reserved,
    quantity_in_transit,
    quality_status,
    last_receipt_date
)
SELECT 
    w.id,
    i.item_code,
    'LOT-TR-' || substring(md5(i.item_code || 'TRANSIT'), 1, 6),
    0,
    0,
    0,
    -- Generate random in-transit between 20-100
    FLOOR(RANDOM() * 80 + 20)::integer,
    'GOOD',
    NOW() - (FLOOR(RANDOM() * 7) || ' days')::interval
FROM public.items i
CROSS JOIN public.inv_warehouses w
WHERE w.warehouse_code = 'WH-INTRANSIT'
  AND i.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.inv_warehouse_stock ws 
    WHERE ws.warehouse_id = w.id AND ws.item_code = i.item_code
  );

-- Production Floor Stock (finished goods awaiting transfer)
INSERT INTO public.inv_warehouse_stock (
    warehouse_id,
    item_code,
    lot_number,
    quantity_on_hand,
    quantity_allocated,
    quantity_reserved,
    quantity_in_transit,
    quality_status,
    last_receipt_date
)
SELECT 
    w.id,
    i.item_code,
    'LOT-PROD-' || substring(md5(i.item_code || 'PROD'), 1, 6),
    -- Generate random production stock between 50-300
    FLOOR(RANDOM() * 250 + 50)::integer,
    0,
    0,
    0,
    'GOOD',
    NOW() - (FLOOR(RANDOM() * 3) || ' days')::interval
FROM public.items i
CROSS JOIN public.inv_warehouses w
WHERE w.warehouse_code = 'WH-PROD-FLOOR'
  AND i.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.inv_warehouse_stock ws 
    WHERE ws.warehouse_id = w.id AND ws.item_code = i.item_code
  );

-- ============================================================================
-- 4. CREATE SAMPLE STOCK LEDGER ENTRIES (MOVEMENT HISTORY)
-- ============================================================================

-- Insert some sample stock movements for the last 30 days
INSERT INTO public.inv_stock_ledger (
    ledger_date,
    warehouse_id,
    item_code,
    transaction_type,
    quantity_change,
    quantity_before,
    quantity_after,
    reference_type,
    reason_code,
    notes
)
SELECT 
    NOW() - (s.day_offset || ' days')::interval,
    w.id,
    i.item_code,
    CASE (s.day_offset % 5)
        WHEN 0 THEN 'RECEIPT'::stock_transaction_type
        WHEN 1 THEN 'ISSUE'::stock_transaction_type
        WHEN 2 THEN 'TRANSFER_IN'::stock_transaction_type
        WHEN 3 THEN 'TRANSFER_OUT'::stock_transaction_type
        ELSE 'ADJUSTMENT_PLUS'::stock_transaction_type
    END,
    CASE WHEN (s.day_offset % 5) IN (1, 3) THEN -1 ELSE 1 END * FLOOR(RANDOM() * 50 + 10)::integer,
    FLOOR(RANDOM() * 300 + 100)::integer,
    FLOOR(RANDOM() * 300 + 100)::integer + 
        CASE WHEN (s.day_offset % 5) IN (1, 3) THEN -1 ELSE 1 END * FLOOR(RANDOM() * 50 + 10)::integer,
    'MANUAL',
    'PROD_RECV',
    'Sample movement entry for testing'
FROM (SELECT generate_series(1, 30) AS day_offset) s
CROSS JOIN LATERAL (
    SELECT id, item_code 
    FROM public.items 
    WHERE is_active = true 
    ORDER BY RANDOM() 
    LIMIT 3
) i
CROSS JOIN public.inv_warehouses w
WHERE w.warehouse_code = 'WH-SNV-MAIN'
  AND NOT EXISTS (
    SELECT 1 FROM public.inv_stock_ledger sl 
    WHERE sl.item_code = i.item_code 
      AND sl.ledger_date::date = (NOW() - (s.day_offset || ' days')::interval)::date
  )
LIMIT 100;

-- ============================================================================
-- 5. VERIFY DATA WAS INSERTED
-- ============================================================================

-- Check warehouse types count
SELECT 'Warehouse Types' as entity, COUNT(*) as count FROM public.inv_warehouse_types;

-- Check warehouses count
SELECT 'Warehouses' as entity, COUNT(*) as count FROM public.inv_warehouses;

-- Check warehouse stock entries
SELECT 'Warehouse Stock Entries' as entity, COUNT(*) as count FROM public.inv_warehouse_stock;

-- Check stock by warehouse
SELECT 
    w.warehouse_name,
    COUNT(ws.id) as item_count,
    SUM(ws.quantity_on_hand) as total_on_hand,
    SUM(ws.quantity_available) as total_available
FROM public.inv_warehouses w
LEFT JOIN public.inv_warehouse_stock ws ON ws.warehouse_id = w.id AND ws.is_active = true
GROUP BY w.warehouse_name
ORDER BY w.warehouse_name;

-- Check ledger entries
SELECT 'Stock Ledger Entries' as entity, COUNT(*) as count FROM public.inv_stock_ledger;

-- ============================================================================
-- DONE!
-- ============================================================================
SELECT '✅ Sample data inserted successfully!' as status;
