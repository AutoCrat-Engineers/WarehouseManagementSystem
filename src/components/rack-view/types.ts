/**
 * Rack View module — types mirroring mv_rack_view + related entities.
 */

export interface RackCell {
    rack_location_id:       string;
    warehouse_id:           string;
    warehouse_name:         string | null;
    warehouse_type:         string | null;
    rack:                   string;
    location_number:        number;
    location_code:          string;

    // Occupancy
    pallet_id:              string | null;
    pallet_number:          string | null;
    pallet_state:           string | null;
    pallet_quantity:        number | null;
    reserved_for_release_id: string | null;

    // Part
    part_number:            string | null;
    item_id:                string | null;
    item_name:              string | null;
    msn_code:               string | null;

    // Back-chain
    packing_list_id:        string | null;
    packing_list_number:    string | null;
    parent_invoice_id:      string | null;
    parent_invoice_number:  string | null;
    blanket_order_id:       string | null;
    blanket_order_number:   string | null;
    agreement_id:           string | null;
    agreement_number:       string | null;
    customer_name:          string | null;
    buyer_name:             string | null;
    shipment_sequence:      number | null;
    shipment_log_id:        string | null;

    // Flags
    is_empty:               boolean;
    is_available:           boolean;
    is_reserved:            boolean;

    // Aging
    placed_at:              string | null;
    days_in_rack:           number | null;
    placed_by:              string | null;
    received_at:            string | null;
    received_by:            string | null;
    updated_at:             string;
    row_version:            number;
}

export interface RackSummary {
    total_cells:    number;
    occupied:       number;
    empty:          number;
    available:      number;
    reserved:       number;
    parts_distinct: number;
    by_shipment:    Record<string, number>;
}

export interface RackViewResponse {
    cells:   RackCell[];
    summary: RackSummary;
}

export type RackStatusFilter = 'ALL' | 'OCCUPIED' | 'EMPTY' | 'AVAILABLE' | 'RESERVED';

// Drawer (cell detail) types
export interface RackCellChainResponse {
    cell:          RackCell;
    pallet:        Record<string, unknown> | null;
    cartons:       Array<Record<string, unknown>>;
    packing_list:  Record<string, unknown> | null;
    invoice:       Record<string, unknown> | null;
    blanket_order: Record<string, unknown> | null;
    agreement:     Record<string, unknown> | null;
    move_history:  Array<{
        id: string;
        rack: string;
        location_number: number;
        location_code: string;
        placed_at: string | null;
        placed_by: string | null;
        move_reason: string | null;
        previous_location_id: string | null;
    }>;
}

// Receive-shipment types
export interface ExpectedPallet {
    id:                string;
    pallet_number:     string;
    state:             string;
    current_qty:       number;
    item_code?:        string;
    item_id?:          string | null;
    packing_list_id?:  string | null;
    rack_location_id?: string | null;
}
