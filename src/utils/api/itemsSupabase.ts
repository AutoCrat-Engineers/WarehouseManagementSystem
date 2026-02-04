/**
 * Items API – direct Supabase client access to public.items.
 * Uses the user's session (no Edge Function), so RLS applies and auth errors from the function are avoided.
 * Schema: id, item_code, item_name, description, category, uom, min_stock_level, max_stock_level,
 *         safety_stock, reorder_point, lead_time_days, is_active, created_at, updated_at.
 */

import { getSupabaseClient } from '../supabase/client';

export interface ItemRow {
  id: string;
  item_code: string;
  item_name: string;
  description: string | null;
  category: string | null;
  uom: string;
  unit_price: number | null;
  standard_cost: number | null;
  min_stock_level: number;
  max_stock_level: number;
  safety_stock: number;
  reorder_point: number;
  lead_time_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  revision: string | null;
  master_serial_no: string | null;
  part_number: string | null;
  packaging: PackagingData | null;
}

export interface PackagingLevel {
  label: string;
  quantity: number;
}

export interface PackagingConfig {
  name: string;
  type: 'SIMPLE' | 'NESTED';
  isDefault: boolean;
  levels: PackagingLevel[];
  allowInnerDispatch: boolean;
  allowLooseDispatch: boolean;
  minDispatchQty: number;
}

export interface PackagingData {
  enabled: boolean;
  configs: PackagingConfig[];
}

export interface ItemForm {
  itemCode: string;
  itemName?: string;
  description?: string;
  uom: string;
  minStock: number;
  maxStock: number;
  safetyStock: number;
  leadTimeDays: number | string;
  status: 'active' | 'inactive';
  revision?: string;
  masterSerialNo?: string;
  partNumber?: string;
  packaging?: PackagingData;
}

function rowToForm(row: ItemRow): ItemForm & { id: string; createdAt: string } {
  // Parse packaging data - handle both string and object forms
  let packagingData: PackagingData = { enabled: false, configs: [] };
  if (row.packaging) {
    if (typeof row.packaging === 'string') {
      try {
        packagingData = JSON.parse(row.packaging);
      } catch (e) {
        console.error('Failed to parse packaging JSON:', e);
      }
    } else {
      packagingData = row.packaging as PackagingData;
    }
  }

  return {
    id: row.id,
    itemCode: row.item_code,
    itemName: row.item_name,
    description: row.description || row.item_name,
    uom: row.uom ?? 'PCS',
    minStock: row.min_stock_level ?? 0,
    maxStock: row.max_stock_level ?? 0,
    safetyStock: row.safety_stock ?? 0,
    leadTimeDays: row.lead_time_days ?? 0,
    status: row.is_active ? 'active' : 'inactive',
    createdAt: row.created_at ?? '',
    revision: row.revision || '',
    masterSerialNo: row.master_serial_no || '',
    partNumber: row.part_number || '',
    packaging: packagingData,
  };
}

function formToInsert(form: ItemForm): Record<string, unknown> {
  return {
    item_code: form.itemCode,
    item_name: form.description || form.itemName,
    description: form.description,
    uom: form.uom,
    min_stock_level: form.minStock,
    max_stock_level: form.maxStock,
    safety_stock: form.safetyStock,
    lead_time_days: Number(form.leadTimeDays) || 0,
    is_active: form.status === 'active',
    revision: form.revision || null,
    master_serial_no: form.masterSerialNo || null,
    part_number: form.partNumber || null,
    packaging: form.packaging ? JSON.stringify(form.packaging) : null,
  };
}

function formToUpdate(form: ItemForm): Record<string, unknown> {
  return {
    item_name: form.description || form.itemName,
    description: form.description,
    uom: form.uom,
    min_stock_level: form.minStock,
    max_stock_level: form.maxStock,
    safety_stock: form.safetyStock,
    lead_time_days: Number(form.leadTimeDays) || 0,
    is_active: form.status === 'active',
    revision: form.revision || null,
    master_serial_no: form.masterSerialNo || null,
    part_number: form.partNumber || null,
    packaging: form.packaging ? JSON.stringify(form.packaging) : null,
    updated_at: new Date().toISOString(),
  };
}

export type ItemsResult = { data: (ItemForm & { id: string; createdAt: string })[]; error: null } | { data: null; error: string };

/**
 * Fetch all items from public.items using the current Supabase session.
 * Fails with a clear error if not authenticated or RLS denies access.
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
      ? 'You do not have permission to view items. Check RLS policies on public.items.'
      : error.message;
    return { data: null, error: msg };
  }

  const rows = (data ?? []) as ItemRow[];
  return { data: rows.map(rowToForm), error: null };
}

export type CreateItemResult = { item: (ItemForm & { id: string; createdAt: string }) | null; error: string | null };
export type UpdateItemResult = { item: (ItemForm & { id: string; createdAt: string }) | null; error: string | null };
export type DeleteItemResult = { ok: boolean; error: string | null };

export async function createItem(form: ItemForm): Promise<CreateItemResult> {
  const supabase = getSupabaseClient();

  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) {
    return { item: null, error: 'Not signed in. Please sign in to create items.' };
  }

  const { data, error } = await supabase
    .from('items')
    .insert(formToInsert(form))
    .select()
    .single();

  if (error) {
    return { item: null, error: error.message };
  }
  return { item: rowToForm(data as ItemRow), error: null };
}

export async function updateItem(id: string, form: ItemForm): Promise<UpdateItemResult> {
  const supabase = getSupabaseClient();

  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) {
    return { item: null, error: 'Not signed in. Please sign in to update items.' };
  }

  const { data, error } = await supabase
    .from('items')
    .update(formToUpdate(form))
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return { item: null, error: error.message };
  }
  return { item: rowToForm(data as ItemRow), error: null };
}

export async function deleteItem(id: string): Promise<DeleteItemResult> {
  const supabase = getSupabaseClient();

  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) {
    return { ok: false, error: 'Not signed in. Please sign in to delete items.' };
  }

  const { error } = await supabase.from('items').delete().eq('id', id);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}
