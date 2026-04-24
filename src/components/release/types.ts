/**
 * Release module — types for blanket releases, sub-invoices, tariff invoices.
 */

export type ReleaseStatus   = 'OPEN' | 'FULFILLED' | 'CANCELLED';
export type SubInvoiceStatus = 'DRAFT' | 'CONFIRMED' | 'AWAITING_PICKUP' | 'PICKED_UP' | 'CANCELLED';
export type TariffStatus    = 'DRAFT' | 'SUBMITTED' | 'CLAIMED' | 'PAID' | 'CANCELLED';

export interface BlanketRelease {
    id:                 string;
    blanket_order_id:   string | null;
    agreement_id:       string | null;
    line_config_id:     string | null;
    release_number:     string;
    release_sequence:   number | null;
    customer_po_base:   string | null;
    buyer_name:         string | null;
    requested_quantity: number;
    need_by_date:       string | null;
    status:             ReleaseStatus;
    notes:              string | null;
    source:             string;
    created_at:         string;
    updated_at:         string;
    // Joined (populated by release_list)
    part_number?:         string | null;
    msn_code?:            string | null;
    sub_invoice_number?:  string | null;
    sub_invoice_status?:  string | null;
    sub_invoice_pallets?: number | null;
    sub_invoice_lines?:   Array<{
        parent_invoice_number: string | null;
        part_number:           string;
        msn_code:              string;
        quantity:              number;
        pallet_count:          number;
        unit_price:            number;
    }>;
}

export interface SubInvoice {
    id:                    string;
    sub_invoice_number:    string;
    sub_invoice_date:      string;
    parent_invoice_id:     string | null;
    parent_invoice_number: string | null;
    blanket_release_id:    string | null;
    blanket_order_id:      string | null;
    agreement_id:          string | null;
    customer_po_number:    string | null;
    customer_bo_base:      string | null;
    release_sequence:      number | null;
    buyer_name:            string | null;
    total_quantity:        number;
    total_pallets:         number;
    total_amount:          number;
    currency_code:         string;
    status:                SubInvoiceStatus;
    notes:                 string | null;
    row_version:           number;
}

export interface TariffInvoice {
    id:                    string;
    tariff_invoice_number: string;
    tariff_invoice_date:   string;
    sub_invoice_id:        string | null;
    sub_invoice_number:    string | null;
    blanket_order_id:      string | null;
    agreement_id:          string | null;
    part_number:           string;
    msn_code:              string;
    quantity:              number;
    unit_price:            number;
    invoice_value:         number;
    unit_tariff:           number | null;
    tariff_invoice_value:  number | null;
    total_tariff:          number | null;
    currency_code:         string;
    calculation_snapshot:  Record<string, unknown>;
    buyer_name:            string | null;
    status:                TariffStatus;
    row_version:           number;
}

// Wire types (responses from edge functions)
export interface ParsedPO {
    po_base:                 string;
    release_sequence:        number | null;
    agreement:               Record<string, unknown> | null;
    parts:                   Array<Record<string, unknown>>;
    available_pallets_count: number;
    duplicate_release:       boolean;
}

export interface AvailablePallet {
    pallet_id:              string;
    pallet_number:          string;
    rack:                   string;
    location_code:          string;
    quantity:               number;
    shipment_sequence:      number | null;
    placed_at:              string | null;
    days_in_rack:           number | null;
    parent_invoice_id:      string | null;
    parent_invoice_number:  string | null;
    parent_invoice_date:    string | null;
    parent_invoice_line_id: string | null;
    parent_invoiced_qty:    number | null;
    parent_released_qty:    number | null;
    parent_pending_qty:     number | null;
    parent_unit_price:      number | null;
    agreement_id:           string | null;
    agreement_number:       string | null;
    packing_list_number:    string | null;
    blanket_order_id:       string | null;
    blanket_order_number:   string | null;
    is_oldest_shipment:     boolean;
    gr_number:              string | null;
}

export interface FifoSuggestion {
    pallet_ids:             string[];
    pallet_count:           number;
    total_quantity:         number;
    parent_invoice_line_id: string | null;
    parent_invoice_number:  string | null;
    pending_on_parent:      number;
    warnings:               string[];
}
