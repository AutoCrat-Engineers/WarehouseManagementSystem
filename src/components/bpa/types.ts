/**
 * BPA module — TypeScript types mirroring the DB tables.
 */

export type AgreementStatus = 'DRAFT' | 'ACTIVE' | 'AMENDED' | 'EXPIRED' | 'CANCELLED';
export type AgreementType   = 'BPA' | 'ANNUAL_CONTRACT' | 'SPOT' | 'OTHER';

export interface CustomerAgreement {
    id:                    string;
    agreement_number:      string;
    agreement_revision:    number;
    agreement_type:        AgreementType;
    agreement_title:       string | null;
    customer_code:         string;
    customer_name:         string;
    buyer_name:            string | null;
    buyer_email:           string | null;
    buyer_phone:           string | null;
    agreement_date:        string;
    effective_start_date:  string;
    effective_end_date:    string;
    agreement_value:       number | null;
    currency_code:         string;
    payment_terms:         string | null;
    incoterms:             string | null;
    delivery_location:     string | null;
    ship_via:              string | null;
    total_parts:           number;
    total_blanket_value:   number;
    status:                AgreementStatus;
    document_url:          string | null;
    portal_access_enabled: boolean;
    source:                string;
    created_at:            string;
    updated_at:            string;
    created_by:            string | null;
    updated_by:            string | null;
    row_version:           number;
}

export interface CustomerAgreementPart {
    id:                   string;
    agreement_id:         string;
    line_number:          number;
    part_number:          string;
    item_id:              string | null;
    msn_code:             string;
    customer_part_number: string | null;
    drawing_number:       string;
    drawing_revision:     string | null;
    customer_description: string | null;
    hs_code:              string | null;
    dbk_code:             string | null;
    blanket_quantity:     number;
    unit_price:           number;
    total_value:          number;
    avg_monthly_demand:   number;
    min_warehouse_stock:  number;
    max_warehouse_stock:  number;
    release_multiple:     number;
    safety_stock:         number;
    is_active:            boolean;
    row_version:          number;
}

export interface AgreementRevision {
    id:                       string;
    agreement_id:             string;
    revision_from:            number;
    revision_to:              number;
    revision_date:            string;
    revision_reason:          string | null;
    agreement_changes:        Record<string, unknown>;
    part_changes:             Array<Record<string, unknown>>;
    full_agreement_snapshot:  Record<string, unknown> | null;
    full_parts_snapshot:      Array<Record<string, unknown>> | null;
    amendment_document_url:   string | null;
    customer_notification:    string | null;
    created_at:               string;
    created_by:               string | null;
}

export interface FulfillmentRow {
    agreement_id:        string;
    agreement_number:    string;
    part_number:         string;
    msn_code:            string;
    item_name:           string | null;
    blanket_quantity:    number;
    shipped_quantity:    number;
    released_quantity:   number;
    delivered_quantity:  number;
    pending_quantity:    number;
    fulfillment_pct:     number;
    pallets_in_rack:     number;
    qty_in_rack:         number;
    total_releases:      number;
    total_sub_invoices:  number;
}

// ──────────────────────────────────────────────────────────────────────
// Form types
// ──────────────────────────────────────────────────────────────────────

export interface AgreementPartForm {
    part_number:          string;
    msn_code:             string;
    customer_part_number: string;
    drawing_number:       string;
    drawing_revision:     string;
    customer_description: string;
    hs_code:              string;
    dbk_code:             string;
    blanket_quantity:     number | null;
    unit_price:           number | null;
    avg_monthly_demand:   number | null;
    min_warehouse_stock:  number | null;
    max_warehouse_stock:  number | null;
    safety_stock:         number | null;
    notes?:               string;
}

export interface AgreementCreateForm {
    agreement_number:     string;
    agreement_type:       AgreementType;
    agreement_title:      string;
    customer_code:        string;
    customer_name:        string;
    buyer_name:           string;
    buyer_email:          string;
    buyer_phone:          string;
    agreement_date:       string;
    effective_start_date: string;
    effective_end_date:   string;
    currency_code:        string;
    payment_terms:        string;
    incoterms:            string;
    delivery_location:    string;
    ship_via:             string;
    parts:                AgreementPartForm[];
}

export const emptyPart = (): AgreementPartForm => ({
    part_number: '', msn_code: '', customer_part_number: '', drawing_number: '',
    drawing_revision: '', customer_description: '', hs_code: '', dbk_code: '',
    blanket_quantity: null, unit_price: null, avg_monthly_demand: null,
    min_warehouse_stock: null, max_warehouse_stock: null, release_multiple: null,
    safety_stock: null, notes: '',
});

export const emptyAgreementForm = (): AgreementCreateForm => ({
    agreement_number: '', agreement_type: 'BPA', agreement_title: '',
    customer_code: '', customer_name: '', buyer_name: '', buyer_email: '', buyer_phone: '',
    agreement_date:       new Date().toISOString().slice(0, 10),
    effective_start_date: new Date().toISOString().slice(0, 10),
    effective_end_date:   new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
    currency_code: 'USD', payment_terms: 'Net 90', incoterms: 'DDP', delivery_location: '', ship_via: '',
    parts: [emptyPart()],
});
