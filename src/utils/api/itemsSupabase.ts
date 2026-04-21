/**
 * Items API — thin client wrapper around the `im_*` edge functions.
 *
 * Previously this file held direct Supabase queries (INSERT / UPDATE /
 * cascade DELETE) against `public.items` and ~15 child tables.  Every
 * DB path now lives server-side:
 *   - im_list-items          → list + 3 summary counts (used by UI)
 *   - im_get-blanket-orders  → v_item_details blanket-order slice
 *   - im_upsert-item         → create / update branches
 *   - im_delete-item         → hard cascade delete (13-table sequence)
 *
 * The exported shapes (Item, ItemFormData, etc.) and the function
 * signatures remain unchanged, so callers don't need to adapt.
 */

import { fetchWithAuth } from '../supabase/auth';
import { getEdgeFunctionUrl } from '../supabase/info';

/**
 * Item interface — mirrors the public.items row shape.
 */
export interface Item {
  id: string;
  item_code: string;
  item_name: string;
  uom: string;
  unit_price: number | null;
  standard_cost: number | null;
  weight: number | null;
  lead_time_days: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  master_serial_no: string | null;
  revision: string | null;
  part_number: string | null;
  deleted_by: string | null;
}

/** Form state type — uses same DB schema fields (minus system-managed columns). */
export type ItemFormData = Omit<Item, 'id' | 'created_at' | 'updated_at' | 'deleted_by'>;

/** Default form values. */
export const itemFormDefault: ItemFormData = {
  item_code: '',
  item_name: '',
  uom: 'NOS',
  unit_price: null,
  standard_cost: null,
  weight: null,
  lead_time_days: '',
  is_active: true,
  master_serial_no: '',
  revision: '',
  part_number: '',
};

// Result types kept for backward-compatibility with call sites.
export type ItemsResult = { data: Item[] | null; error: string | null };
export type ItemResult = { data: Item | null; error: string | null };
export type DeleteResult = { success: boolean; error: string | null };

/** List filters used by the caller-side paginator. */
export interface ItemFilters {
  isActive?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * List items — backed by `im_list-items` edge function.
 * Signature preserved (data / count / error).  The edge function does
 * the sort, search, filter, and pagination server-side exactly like
 * the prior inline query.
 */
export async function fetchItems(
  filters?: ItemFilters,
): Promise<{ data: Item[]; count: number; error: string | null }> {
  const limit = filters?.limit ?? 25;
  const offset = filters?.offset ?? 0;
  const page = Math.floor(offset / limit);

  let cardFilter: 'ALL' | 'ACTIVE' | 'INACTIVE' = 'ALL';
  if (filters?.isActive === true) cardFilter = 'ACTIVE';
  else if (filters?.isActive === false) cardFilter = 'INACTIVE';

  try {
    const res = await fetchWithAuth(getEdgeFunctionUrl('im_list-items'), {
      method: 'POST',
      body: JSON.stringify({
        page,
        page_size: limit,
        card_filter: cardFilter,
        search_term: filters?.search || undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      return { data: [], count: 0, error: json?.error || 'Failed to fetch items' };
    }
    return { data: (json.items as Item[]) || [], count: json.total_count ?? 0, error: null };
  } catch (err: any) {
    return { data: [], count: 0, error: err?.message || 'Failed to fetch items' };
  }
}

/** Create item — backed by `im_upsert-item` (create branch). */
export async function createItem(formData: ItemFormData): Promise<ItemResult> {
  try {
    const res = await fetchWithAuth(getEdgeFunctionUrl('im_upsert-item'), {
      method: 'POST',
      body: JSON.stringify({ form_data: formData }),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      return { data: null, error: json?.error || 'Failed to create item' };
    }
    return { data: json.item as Item, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to create item' };
  }
}

/** Update item — backed by `im_upsert-item` (update branch). */
export async function updateItem(
  id: string,
  formData: Partial<ItemFormData>,
): Promise<ItemResult> {
  try {
    const res = await fetchWithAuth(getEdgeFunctionUrl('im_upsert-item'), {
      method: 'POST',
      body: JSON.stringify({ item_id: id, form_data: formData }),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      return { data: null, error: json?.error || 'Failed to update item' };
    }
    return { data: json.item as Item, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to update item' };
  }
}

/**
 * Delete item (HARD DELETE, cascade) — backed by `im_delete-item`.
 * Same 13-table cascade the old client-side code performed, now
 * server-side.  Audit log is written with the caller's identity taken
 * from the verified JWT (not the request body).
 */
export async function deleteItem(id: string, deletionReason: string): Promise<DeleteResult> {
  try {
    const res = await fetchWithAuth(getEdgeFunctionUrl('im_delete-item'), {
      method: 'POST',
      body: JSON.stringify({ item_id: id, deletion_reason: deletionReason }),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      return { success: false, error: json?.error || 'Failed to delete item' };
    }
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete item' };
  }
}
