/**
 * Items API – Direct Supabase access to public.items
 * 
 * SCHEMA ALIGNMENT: Frontend uses DB column names exactly (snake_case)
 * NO TRANSFORMATION LAYER - fields match database 1:1
 * 
 * Database Schema (public.items):
 * id, item_code, item_name, uom, unit_price, standard_cost, lead_time_days,
 * is_active, created_at, updated_at, master_serial_no, revision, part_number
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
}

/**
 * Form state type - uses same DB schema fields
 */
export type ItemFormData = Omit<Item, 'id' | 'created_at' | 'updated_at'>;

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
 * Delete item
 */
export async function deleteItem(id: string): Promise<DeleteResult> {
  const supabase = getSupabaseClient();

  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) {
    return { success: false, error: 'Not signed in.' };
  }

  const { error } = await supabase.from('items').delete().eq('id', id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, error: null };
}
