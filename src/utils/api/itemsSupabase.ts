/**
 * Items API – Direct Supabase access to public.items
 * 
 * SCHEMA ALIGNMENT: Frontend uses DB column names exactly (snake_case)
 * NO TRANSFORMATION LAYER - fields match database 1:1
 * 
 * Database Schema (public.items):
 * id, item_code, item_name, uom, unit_price, standard_cost, lead_time_days,
 * is_active, created_at, updated_at, master_serial_no, revision, part_number, deleted_by
 */

import { getSupabaseClient } from '../supabase/client';

/**
 * Item interface - EXACTLY matches database schema (snake_case)
 * No camelCase aliases, no transformation
 */
export interface Item {
  id: string;
  item_code: string;
  item_name: string;
  uom: string;
  unit_price: number | null;
  standard_cost: number | null;
  lead_time_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  master_serial_no: string | null;
  revision: string | null;
  part_number: string | null;
  deleted_by: string | null;
}

/**
 * Form state type - uses same DB schema fields
 */
export type ItemFormData = Omit<Item, 'id' | 'created_at' | 'updated_at' | 'deleted_by'>;

/**
 * Default form values
 */
export const itemFormDefault: ItemFormData = {
  item_code: '',
  item_name: '',
  uom: 'PCS',
  unit_price: null,
  standard_cost: null,
  lead_time_days: 0,
  is_active: true,
  master_serial_no: '',
  revision: '',
  part_number: '',
};

// Result types
export type ItemsResult = { data: Item[] | null; error: string | null };
export type ItemResult = { data: Item | null; error: string | null };
export type DeleteResult = { success: boolean; error: string | null };

/**
 * Fetch all items - returns raw DB data, no transformation
 */
export async function fetchItems(): Promise<ItemsResult> {
  const supabase = getSupabaseClient();

  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) {
    return { data: null, error: 'Not signed in. Please sign in to view items.' };
  }

  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    const msg = error.code === 'PGRST301' || error.message?.toLowerCase().includes('policy')
      ? 'You do not have permission to view items. Check RLS policies.'
      : error.message;
    return { data: null, error: msg };
  }

  return { data: data as Item[], error: null };
}

/**
 * Create item - inserts raw form data to DB
 */
export async function createItem(formData: ItemFormData): Promise<ItemResult> {
  const supabase = getSupabaseClient();

  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) {
    return { data: null, error: 'Not signed in.' };
  }

  const { data, error } = await supabase
    .from('items')
    .insert(formData)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Item, error: null };
}

/**
 * Update item - updates with raw form data
 */
export async function updateItem(id: string, formData: Partial<ItemFormData>): Promise<ItemResult> {
  const supabase = getSupabaseClient();

  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) {
    return { data: null, error: 'Not signed in.' };
  }

  const { data, error } = await supabase
    .from('items')
    .update({ ...formData, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Item, error: null };
}

/**
 * Delete item (HARD DELETE) - removes item and ALL related records from the entire DB.
 * 
 * Cascade order (child tables first, then parent):
 *  1. inv_blanket_release_stock  (FK → items.item_code)
 *  2. inv_stock_ledger           (FK → items.item_code)
 *  3. inv_movement_lines         (FK → items.item_code)
 *  4. inv_warehouse_stock        (FK → items.item_code)
 *  5. planning_recommendations   (FK → items.item_code)
 *  6. demand_history             (FK → items.item_code)
 *  7. demand_forecasts           (FK → items.item_code)
 *  8. stock_movements            (FK → items.item_code)
 *  9. inventory                  (FK → items.item_code)
 * 10. blanket_releases           (FK → items.item_code)
 * 11. blanket_order_lines        (FK → items.item_code)
 * 12. blanket_order_items        (FK → items.id)
 * 13. items                      (the master row)
 */
export async function deleteItem(id: string): Promise<DeleteResult> {
  const supabase = getSupabaseClient();

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    return { success: false, error: 'Not signed in.' };
  }

  // Step 1: Get the item's item_code (needed for FK lookups in child tables)
  const { data: item, error: fetchError } = await supabase
    .from('items')
    .select('id, item_code')
    .eq('id', id)
    .single();

  if (fetchError || !item) {
    return { success: false, error: fetchError?.message || 'Item not found.' };
  }

  const itemCode = item.item_code;

  // Step 2: Delete from all child tables that reference items(item_code)
  // Order matters — deepest children first to avoid FK violations
  const childTables = [
    'inv_blanket_release_stock',
    'inv_stock_ledger',
    'inv_movement_lines',
    'inv_warehouse_stock',
    'planning_recommendations',
    'demand_history',
    'demand_forecasts',
    'stock_movements',
    'inventory',
    'blanket_releases',
    'blanket_order_lines',
  ];

  for (const table of childTables) {
    const { error: childError } = await supabase
      .from(table)
      .delete()
      .eq('item_code', itemCode);

    if (childError) {
      // Log but continue — table may not exist or may have no matching rows
      console.warn(`Warning: Could not delete from ${table}:`, childError.message);
    }
  }

  // Step 3: Delete from blanket_order_items (references items.id, not item_code)
  const { error: boiError } = await supabase
    .from('blanket_order_items')
    .delete()
    .eq('item_id', id);

  if (boiError) {
    console.warn('Warning: Could not delete from blanket_order_items:', boiError.message);
  }

  // Step 4: Finally delete the item itself
  const { error: deleteError } = await supabase
    .from('items')
    .delete()
    .eq('id', id);

  if (deleteError) {
    return { success: false, error: `Failed to delete item: ${deleteError.message}` };
  }

  return { success: true, error: null };
}
