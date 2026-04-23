/**
 * releaseService — client wrapper for release / sub-invoice / tariff edge fns.
 */
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';
import type {
    BlanketRelease, SubInvoice, TariffInvoice,
    ParsedPO, AvailablePallet, FifoSuggestion, TariffStatus,
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

// ── Release parse / create ────────────────────────────────────────────
export function parsePONumber(customer_po_number: string): Promise<ParsedPO & { customer_po_number: string; success: boolean }> {
    return callEdge('release_parse_po_number', { customer_po_number });
}

export function createRelease(input: {
    customer_po_number: string;
    agreement_id:       string;
    blanket_order_id?:  string;
    line_config_id?:    string;
    part_number?:       string;
    requested_quantity: number;
    need_by_date?:      string;
    buyer_name?:        string;
    notes?:             string;
}): Promise<{ release_id: string; release_number: string; release_sequence: number | null; po_base: string }> {
    return callEdge('release_create', input);
}

export function listReleases(filters: {
    page?:          number;
    page_size?:     number;
    status_filter?: 'ALL' | 'OPEN' | 'FULFILLED' | 'CANCELLED';
    search_term?:   string;
    agreement_id?:  string;
} = {}): Promise<{ releases: BlanketRelease[]; total_count: number; counts: Record<string, number> }> {
    return callEdge('release_list', filters);
}

// ── Pallet picker ─────────────────────────────────────────────────────
export function listAvailablePallets(input: {
    part_number:   string;
    agreement_id?: string;
    warehouse_id?: string;
    limit?:        number;
}): Promise<{ pallets: AvailablePallet[]; total_count: number; fifo_hint: { oldest_shipment: number | null; oldest_shipment_pallets: number; recommendation: string } }> {
    return callEdge('release_list_available_pallets', input);
}

export function fifoSuggest(input: {
    part_number:       string;
    required_quantity: number;
    agreement_id?:     string;
}): Promise<{ suggestion: FifoSuggestion }> {
    return callEdge('release_fifo_suggest', input);
}

// ── Sub-invoice creation (v2: multi-invoice allocations) ──────────────
export interface Allocation {
    parent_invoice_line_id: string;
    pallet_id:              string;
    quantity:               number;
}

export function createSubInvoice(input: {
    allocations:         Allocation[];
    blanket_release_id?: string;
    customer_po_number:  string;
    buyer_name?:         string;
    sub_invoice_date?:   string;
    notes?:              string;
    idempotency_key?:    string;
}): Promise<{
    sub_invoice_id:         string;
    sub_invoice_number:     string;
    tariff_invoice_id:      string;
    tariff_invoice_number:  string;
    pallet_count:           number;
    quantity:               number;
    total_amount:           number;
    parent_invoice_count:   number;
}> {
    return callEdge('sub_invoice_create', input);
}


// ── Tariff ────────────────────────────────────────────────────────────
export function listTariffInvoices(filters: {
    page?:          number;
    page_size?:     number;
    status_filter?: 'ALL' | TariffStatus;
    search_term?:   string;
    date_from?:     string;
    date_to?:       string;
} = {}): Promise<{ tariffs: TariffInvoice[]; total_count: number; counts: Record<string, number>; page_total_value: number }> {
    return callEdge('tariff_invoice_list', filters);
}

export function computeTariff(input: {
    tariff_invoice_id: string;
    hs_code?:          string;
    manual_rates?:     Array<{ tariff_type: string; rate_pct: number; label?: string }>;
}): Promise<{ calculation: { rates: Array<{ type: string; label: string; rate_pct: number; amount: number }>; unit_tariff: number; total_tariff: number; invoice_value: number } }> {
    return callEdge('tariff_invoice_compute', input);
}

export function submitTariff(input: {
    tariff_invoice_id:    string;
    target_status:        'SUBMITTED' | 'CLAIMED' | 'PAID' | 'CANCELLED';
    expected_row_version: number;
    notes?:               string;
}): Promise<{ tariff: TariffInvoice; prev_status: TariffStatus }> {
    return callEdge('tariff_submit', input);
}
