/**
 * rackService — client wrapper around rack edge functions.
 */
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';
import type {
    RackViewResponse, RackCellChainResponse, RackStatusFilter, ExpectedPallet,
} from './types';

async function callEdge<T>(name: string, body: unknown): Promise<T> {
    const res = await fetchWithAuth(getEdgeFunctionUrl(name), {
        method: 'POST',
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json?.error) {
        throw new Error(json?.error?.message || json?.error || `Request failed (${res.status})`);
    }
    return json as T;
}

export interface RackViewFilters {
    warehouse_id?:      string;
    rack?:              string;
    status_filter?:     RackStatusFilter;
    part_filter?:       string;
    agreement_id?:      string;
    shipment_sequence?: number;
}

export async function getRackView(filters: RackViewFilters = {}): Promise<RackViewResponse> {
    return callEdge('rack_view_get', filters);
}

export async function getCellChain(params:
    | { rack_location_id: string }
    | { warehouse_id: string; rack: string; location_number: number }
): Promise<RackCellChainResponse> {
    return callEdge('rack_get_cell_chain', params);
}

export async function listExpectedPallets(params:
    | { proforma_invoice_number: string }
    | { invoice_number: string }
): Promise<{ packing_lists: any[]; expected_pallets: ExpectedPallet[]; total_expected: number }> {
    return callEdge('shipment_receive', { mode: 'LIST', ...params });
}

export async function confirmReceipt(input: {
    pallet_ids: string[];
    received_at?: string;
    discrepancy_notes?: Record<string, string>;
}): Promise<{ received_count: number; pallets: Array<{ id: string; pallet_number: string; state: string }>; discrepancies: number }> {
    return callEdge('shipment_receive', { mode: 'CONFIRM', ...input });
}

export async function placePallet(input: {
    pallet_id: string;
    warehouse_id: string;
    rack: string;
    location_number: number;
    idempotency_key?: string;
}): Promise<{ rack_location_id: string; location_code: string; pallet_id: string }> {
    return callEdge('pallet_place', input);
}

export async function movePallet(input: {
    pallet_id: string;
    dest_warehouse_id: string;
    dest_rack: string;
    dest_location_number: number;
    move_reason: string;
    idempotency_key?: string;
}): Promise<{ pallet_id: string; from_location: string; to_location: string; dest_rack_location_id: string }> {
    return callEdge('pallet_move', input);
}

export async function refreshRackView(): Promise<void> {
    await callEdge('refresh_views_cron', { views: ['mv_rack_view'] });
}
