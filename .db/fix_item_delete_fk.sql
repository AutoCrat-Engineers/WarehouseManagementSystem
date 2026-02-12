-- ============================================================================
-- FIX: Enable CASCADE DELETE on items table foreign keys
-- 
-- PROBLEM: Deleting an item from public.items fails because child tables
--          reference items(item_code) without ON DELETE CASCADE.
--          This means the DB rejects the delete due to FK constraint violations.
--
-- FIX:     Drop and recreate foreign keys with ON DELETE CASCADE.
--          This is an OPTIONAL DB-side fix. The application already handles
--          cascading deletes in the frontend (itemsSupabase.ts).
--          Run this if you want the DB to handle cascading automatically.
--
-- Date: 2026-02-12
-- ============================================================================

-- 1. inv_warehouse_stock → items(item_code)
ALTER TABLE public.inv_warehouse_stock 
    DROP CONSTRAINT IF EXISTS inv_warehouse_stock_item_fkey;
ALTER TABLE public.inv_warehouse_stock 
    ADD CONSTRAINT inv_warehouse_stock_item_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- 2. inv_movement_lines → items(item_code)
ALTER TABLE public.inv_movement_lines 
    DROP CONSTRAINT IF EXISTS inv_movement_lines_item_fkey;
ALTER TABLE public.inv_movement_lines 
    ADD CONSTRAINT inv_movement_lines_item_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- 3. inv_stock_ledger → items(item_code)
ALTER TABLE public.inv_stock_ledger 
    DROP CONSTRAINT IF EXISTS inv_stock_ledger_item_fkey;
ALTER TABLE public.inv_stock_ledger 
    ADD CONSTRAINT inv_stock_ledger_item_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- 4. inv_blanket_release_stock → items(item_code)
ALTER TABLE public.inv_blanket_release_stock 
    DROP CONSTRAINT IF EXISTS inv_blanket_release_stock_item_fkey;
ALTER TABLE public.inv_blanket_release_stock 
    ADD CONSTRAINT inv_blanket_release_stock_item_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- 5. blanket_order_lines → items(item_code)
ALTER TABLE public.blanket_order_lines 
    DROP CONSTRAINT IF EXISTS blanket_order_lines_item_code_fkey;
ALTER TABLE public.blanket_order_lines 
    ADD CONSTRAINT blanket_order_lines_item_code_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- 6. blanket_releases → items(item_code)
ALTER TABLE public.blanket_releases 
    DROP CONSTRAINT IF EXISTS blanket_releases_item_code_fkey;
ALTER TABLE public.blanket_releases 
    ADD CONSTRAINT blanket_releases_item_code_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- 7. blanket_order_items → items(id)
ALTER TABLE public.blanket_order_items 
    DROP CONSTRAINT IF EXISTS blanket_order_items_item_fk;
ALTER TABLE public.blanket_order_items 
    ADD CONSTRAINT blanket_order_items_item_fk 
    FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;

-- 8. inventory → items(item_code)
ALTER TABLE public.inventory 
    DROP CONSTRAINT IF EXISTS inventory_item_code_fkey;
ALTER TABLE public.inventory 
    ADD CONSTRAINT inventory_item_code_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- 9. stock_movements → items(item_code)
ALTER TABLE public.stock_movements 
    DROP CONSTRAINT IF EXISTS stock_movements_item_code_fkey;
ALTER TABLE public.stock_movements 
    ADD CONSTRAINT stock_movements_item_code_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- 10. demand_forecasts → items(item_code)
ALTER TABLE public.demand_forecasts 
    DROP CONSTRAINT IF EXISTS demand_forecasts_item_code_fkey;
ALTER TABLE public.demand_forecasts 
    ADD CONSTRAINT demand_forecasts_item_code_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- 11. demand_history → items(item_code)
ALTER TABLE public.demand_history 
    DROP CONSTRAINT IF EXISTS demand_history_item_code_fkey;
ALTER TABLE public.demand_history 
    ADD CONSTRAINT demand_history_item_code_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- 12. planning_recommendations → items(item_code)
ALTER TABLE public.planning_recommendations 
    DROP CONSTRAINT IF EXISTS planning_recommendations_item_code_fkey;
ALTER TABLE public.planning_recommendations 
    ADD CONSTRAINT planning_recommendations_item_code_fkey 
    FOREIGN KEY (item_code) REFERENCES public.items(item_code) ON DELETE CASCADE;

-- ============================================================================
-- VERIFY
-- ============================================================================
SELECT 
    tc.constraint_name,
    tc.table_name AS child_table,
    kcu.column_name AS fk_column,
    ccu.table_name AS parent_table,
    ccu.column_name AS parent_column,
    rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE ccu.table_name = 'items' 
  AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name;

SELECT '✅ All FK constraints on items table now have ON DELETE CASCADE!' AS status;
