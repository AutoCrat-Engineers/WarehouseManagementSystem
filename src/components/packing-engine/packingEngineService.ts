/**
 * packingEngineService.ts â€” Service layer for the Packing Engine
 *
 * Handles all CRUD and workflow operations for:
 *   - Contract Configs
 *   - Containers
 *   - Pallets (with state machine)
 *   - Packing Lists
 *   - Invoices
 *   - Proforma Invoices
 *   - Dispatch (stock transfer)
 *   - Traceability
 */

import { getSupabaseClient } from '../../utils/supabase/client';

const supabase = getSupabaseClient();

// ============================================================================
// TYPES
// ============================================================================

export interface ContractConfig {
    id: string;
    item_id: string;
    item_code: string;
    contract_outer_qty: number;
    inner_box_qty: number;
    full_containers_per_pallet: number;
    adjustment_qty: number;
    customer_code: string | null;
    customer_name: string | null;
    blanket_order_id: string | null;
    effective_from: string;
    effective_to: string | null;
    is_active: boolean;
    created_at: string;
    // Joined
    item_name?: string;
    master_serial_no?: string;
    part_number?: string;
}

export interface PackContainer {
    id: string;
    container_number: string;
    movement_header_id: string;
    movement_number: string;
    packing_request_id: string | null;
    packing_box_id: string | null;
    item_id: string;
    item_code: string;
    contract_config_id: string | null;
    packing_spec_id: string | null;
    quantity: number;
    is_adjustment: boolean;
    container_type: string;
    sticker_printed: boolean;
    sticker_printed_at: string | null;
    current_warehouse_id: string | null;
    created_by: string;
    created_at: string;
    reference_doc_type: string | null;
    reference_doc_number: string | null;
    // Joined
    operator_name?: string;
    item_name?: string;
}

export type PalletState = 'OPEN' | 'FILLING' | 'ADJUSTMENT_REQUIRED' | 'READY' | 'LOCKED' | 'DISPATCHED' | 'IN_TRANSIT' | 'CANCELLED';

export interface Pallet {
    id: string;
    pallet_number: string;
    item_id: string;
    item_code: string;
    contract_config_id: string | null;
    packing_spec_id: string | null;
    target_qty: number;
    current_qty: number;
    container_count: number;
    adjustment_container_count: number;
    sequence_number: number;
    state: PalletState;
    opened_at: string;
    ready_at: string | null;
    locked_at: string | null;
    dispatched_at: string | null;
    in_transit_at: string | null;
    current_warehouse_id: string | null;
    packing_list_id: string | null;
    created_at: string;
    row_version: number;
    // Joined
    item_name?: string;
    master_serial_no?: string;
    part_number?: string;
}

export interface PackingList {
    id: string;
    packing_list_number: string;
    customer_code: string | null;
    customer_name: string | null;
    status: string;
    total_pallets: number;
    total_containers: number;
    total_quantity: number;
    total_gross_weight_kg: number;
    total_net_weight_kg: number;
    dispatch_date: string | null;
    vehicle_number: string | null;
    created_by: string;
    created_at: string;
    confirmed_at: string | null;
    // Joined
    created_by_name?: string;
}

export interface PackInvoice {
    id: string;
    invoice_number: string;
    packing_list_id: string;
    customer_name: string | null;
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    currency_code: string;
    status: string;
    total_pallets: number;
    total_quantity: number;
    invoice_date: string;
    created_at: string;
    // Joined
    packing_list_number?: string;
    created_by_name?: string;
}

export interface ProformaInvoice {
    id: string;
    proforma_number: string;
    customer_name: string | null;
    total_amount: number;
    currency_code: string;
    status: string;
    total_invoices: number;
    total_pallets: number;
    total_quantity: number;
    proforma_date: string;
    stock_movement_id: string | null;
    stock_moved_at: string | null;
    created_at: string;
    // Joined
    created_by_name?: string;
}

export interface DispatchReadiness {
    item_code: string;
    item_name: string;
    master_serial_no: string | null;
    contract_outer_qty: number;
    inner_box_qty: number;
    customer_name: string | null;
    ready_pallets: number;
    partial_pallets: number;
    locked_pallets: number;
    dispatched_pallets: number;
    ready_qty: number;
    partial_qty: number;
    total_containers: number;
}

export interface TraceRecord {
    invoice_number: string | null;
    invoice_date: string | null;
    packing_list_number: string | null;
    pallet_number: string | null;
    pallet_state: string | null;
    pallet_target: number | null;
    pallet_actual: number | null;
    container_number: string;
    container_qty: number;
    container_type: string;
    is_adjustment: boolean;
    sticker_printed: boolean;
    movement_number: string;
    operator_name: string;
    operator_employee_id: string | null;
    reference_doc_type: string | null;
    reference_doc_number: string | null;
    item_code: string;
    item_name: string;
    master_serial_no: string | null;
    container_created: string;
    proforma_number: string | null;
    dispatch_timestamp: string | null;
}

export interface PalletStateLog {
    id: string;
    pallet_id: string;
    from_state: string;
    to_state: string;
    trigger_type: string;
    metadata: Record<string, any>;
    performed_by: string;
    performed_at: string;
    performer_name?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

async function getCurrentUserId(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) throw new Error('Not authenticated');
    return session.user.id;
}

function generateNumber(prefix: string): string {
    const d = new Date();
    const date = d.getFullYear().toString() +
        (d.getMonth() + 1).toString().padStart(2, '0') +
        d.getDate().toString().padStart(2, '0');
    const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `${prefix}-${date}-${rand}`;
}

// ============================================================================
// PACKING SPECIFICATIONS (replaces pack_contract_configs)
//   outer_box_quantity + inner_box_quantity already exist in packing_specifications
// ============================================================================

export interface PackingSpec {
    id: string;
    item_id: string;
    item_code: string;
    outer_box_quantity: number;   // contract outer qty
    inner_box_quantity: number;   // inner box qty
    inner_box_length_mm: number;
    inner_box_width_mm: number;
    inner_box_height_mm: number;
    inner_box_net_weight_kg: number;
    outer_box_length_mm: number;
    outer_box_width_mm: number;
    outer_box_height_mm: number;
    outer_box_gross_weight_kg: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    // Joined
    item_name?: string;
    master_serial_no?: string;
    part_number?: string;
}

export async function fetchPackingSpecs(): Promise<PackingSpec[]> {
    const { data, error } = await supabase
        .from('packing_specifications')
        .select(`
            *,
            items!packing_specifications_item_id_fkey (item_name, master_serial_no, part_number)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((d: any) => ({
        ...d,
        item_name: d.items?.item_name,
        master_serial_no: d.items?.master_serial_no,
        part_number: d.items?.part_number,
    }));
}

export async function getPackingSpecForItem(itemCode: string): Promise<PackingSpec | null> {
    const { data, error } = await supabase
        .from('packing_specifications')
        .select(`
            *,
            items!packing_specifications_item_id_fkey (item_name, master_serial_no, part_number)
        `)
        .eq('item_code', itemCode)
        .eq('is_active', true)
        .single();

    if (error || !data) return null;
    return {
        ...data,
        item_name: data.items?.item_name,
        master_serial_no: data.items?.master_serial_no,
        part_number: data.items?.part_number,
    };
}

// Legacy compat â€” fetch from pack_contract_configs if exists
export async function fetchContractConfigs(): Promise<ContractConfig[]> {
    const { data, error } = await supabase
        .from('pack_contract_configs')
        .select(`
            *,
            items!pack_contract_configs_item_id_fkey (item_name, master_serial_no, part_number)
        `)
        .order('created_at', { ascending: false });

    if (error) {
        // Fallback: derive from packing_specifications
        const specs = await fetchPackingSpecs();
        return specs.map(s => ({
            id: s.id,
            item_id: s.item_id,
            item_code: s.item_code,
            contract_outer_qty: s.outer_box_quantity,
            inner_box_qty: s.inner_box_quantity,
            full_containers_per_pallet: s.outer_box_quantity > 0 && s.inner_box_quantity > 0
                ? Math.floor(s.outer_box_quantity / s.inner_box_quantity) : 0,
            adjustment_qty: s.outer_box_quantity > 0 && s.inner_box_quantity > 0
                ? s.outer_box_quantity % s.inner_box_quantity : 0,
            customer_code: null,
            customer_name: null,
            blanket_order_id: null,
            effective_from: s.created_at,
            effective_to: null,
            is_active: s.is_active,
            created_at: s.created_at,
            item_name: s.item_name,
            master_serial_no: s.master_serial_no,
            part_number: s.part_number,
        }));
    }
    return (data || []).map((d: any) => ({
        ...d,
        item_name: d.items?.item_name,
        master_serial_no: d.items?.master_serial_no,
        part_number: d.items?.part_number,
    }));
}

export async function upsertContractConfig(config: {
    item_id: string;
    item_code: string;
    contract_outer_qty: number;
    inner_box_qty: number;
}): Promise<void> {
    const userId = await getCurrentUserId();

    // Also update packing_specifications to keep in sync
    await supabase
        .from('packing_specifications')
        .update({
            outer_box_quantity: config.contract_outer_qty,
            inner_box_quantity: config.inner_box_qty,
            updated_at: new Date().toISOString(),
        })
        .eq('item_code', config.item_code)
        .eq('is_active', true);

    // Deactivate existing configs for this item (in pack_contract_configs)
    await supabase
        .from('pack_contract_configs')
        .update({ is_active: false, updated_at: new Date().toISOString(), updated_by: userId })
        .eq('item_code', config.item_code)
        .eq('is_active', true);

    const { error } = await supabase
        .from('pack_contract_configs')
        .insert({
            ...config,
            is_active: true,
            created_by: userId,
            updated_by: userId,
        });

    if (error) throw error;
}

// ============================================================================
// CORE ENGINE: processPackingBoxAsContainer
//   Called when L1 operator creates a packing box during stock movement.
//   This is the BRIDGE between packing module â†’ packing engine.
//
//   Logic:
//   1. Read outer_box_quantity & inner_box_quantity from packing_specifications
//   2. Create a pack_container
//   3. Find or create an OPEN pallet for this item
//   4. Assign container to pallet
//   5. Check if pallet is full â†’ transition to READY
//   6. Check if adjustment box needed â†’ flag it
// ============================================================================

export async function processPackingBoxAsContainer(input: {
    movement_header_id: string;
    movement_number: string;
    packing_request_id: string;
    packing_box_id: string;
    item_id: string;
    item_code: string;
    box_qty: number;
    current_warehouse_id?: string;
    reference_doc_type?: string;
    reference_doc_number?: string;
}): Promise<{ container: PackContainer; pallet: Pallet; isComplete: boolean; needsAdjustment: boolean }> {
    const userId = await getCurrentUserId();

    // Step 1: Get packing spec for this item
    const spec = await getPackingSpecForItem(input.item_code);
    if (!spec) throw new Error(`No packing specification found for item ${input.item_code}`);

    const outerQty = spec.outer_box_quantity;
    const innerQty = spec.inner_box_quantity;

    if (outerQty <= 0 || innerQty <= 0) {
        throw new Error(`Invalid packing spec: outer=${outerQty}, inner=${innerQty}`);
    }

    // Calculate expected containers & adjustment
    const fullContainers = Math.floor(outerQty / innerQty);
    const adjustmentQty = outerQty % innerQty;
    const isAdjustmentBox = input.box_qty !== innerQty && input.box_qty === adjustmentQty;

    // Step 2: Create container (with packing_spec_id, no contract_config_id needed)
    const containerNumber = generateNumber('CTN');
    const { data: container, error: ctnErr } = await supabase
        .from('pack_containers')
        .insert({
            container_number: containerNumber,
            movement_header_id: input.movement_header_id,
            movement_number: input.movement_number,
            packing_request_id: input.packing_request_id,
            packing_box_id: input.packing_box_id,
            item_id: input.item_id,
            item_code: input.item_code,
            packing_spec_id: spec.id,
            quantity: input.box_qty,
            is_adjustment: isAdjustmentBox,
            container_type: isAdjustmentBox ? 'ADJUSTMENT_BOX' : 'INNER_BOX',
            current_warehouse_id: input.current_warehouse_id || null,
            reference_doc_type: input.reference_doc_type || null,
            reference_doc_number: input.reference_doc_number || null,
            created_by: userId,
        })
        .select()
        .single();

    if (ctnErr) throw ctnErr;

    // Step 3: Find or create pallet for this item
    // PRIORITY ORDER: ADJUSTMENT_REQUIRED first (must complete before starting new),
    // then OPEN/FILLING. This ensures the adjustment box goes to the pallet that needs it.
    let pallet: any = null;
    const { data: openPallets } = await supabase
        .from('pack_pallets')
        .select('*')
        .eq('item_code', input.item_code)
        .in('state', ['OPEN', 'FILLING', 'ADJUSTMENT_REQUIRED'])
        .order('created_at', { ascending: true })
        .limit(10);

    if (openPallets && openPallets.length > 0) {
        // Only route adjustment boxes to ADJUSTMENT_REQUIRED pallets
        // Inner boxes should go to OPEN/FILLING pallets (not the one waiting for adj)
        if (isAdjustmentBox) {
            // Adjustment box → prioritize ADJUSTMENT_REQUIRED pallet to complete it
            const adjPallet = openPallets.find((p: any) => p.state === 'ADJUSTMENT_REQUIRED');
            pallet = adjPallet || openPallets[0];
        } else {
            // Inner box → skip ADJUSTMENT_REQUIRED pallets, use OPEN/FILLING
            const fillingPallet = openPallets.find((p: any) => p.state !== 'ADJUSTMENT_REQUIRED');
            pallet = fillingPallet || null; // null → will create new pallet below
        }
    }

    // If no suitable pallet found, create a new one
    if (!pallet) {
        const palletNumber = generateNumber('PLT');
        const { data: newPallet, error: pErr } = await supabase
            .from('pack_pallets')
            .insert({
                pallet_number: palletNumber,
                item_id: input.item_id,
                item_code: input.item_code,
                packing_spec_id: spec.id,
                target_qty: outerQty,
                current_qty: 0,
                container_count: 0,
                adjustment_container_count: 0,
                state: 'OPEN',
                opened_at: new Date().toISOString(),
                created_by: userId,
            })
            .select()
            .single();
        if (pErr) throw pErr;
        pallet = newPallet;
    }

    // Step 4: Assign container to pallet
    const nextPosition = (pallet.container_count || 0) + 1;
    await supabase.from('pack_pallet_containers').insert({
        pallet_id: pallet.id,
        container_id: container.id,
        position_sequence: nextPosition,
    });

    // Step 5: Update pallet counts
    const newQty = (pallet.current_qty || 0) + input.box_qty;
    const newContainerCount = (pallet.container_count || 0) + 1;
    const newAdjCount = (pallet.adjustment_container_count || 0) + (isAdjustmentBox ? 1 : 0);

    // Determine new state
    let newState: PalletState = 'FILLING';
    let isComplete = false;
    let needsAdjustment = false;

    if (newQty >= outerQty) {
        // Pallet is full — READY!
        newState = 'READY';
        isComplete = true;
    } else if (newContainerCount >= fullContainers && adjustmentQty > 0 && newAdjCount === 0) {
        // All full containers placed but no adjustment box yet
        newState = 'ADJUSTMENT_REQUIRED';
        needsAdjustment = true;
    }

    const updatePayload: any = {
        current_qty: newQty,
        container_count: newContainerCount,
        adjustment_container_count: newAdjCount,
        state: newState,
        updated_at: new Date().toISOString(),
    };
    if (newState === 'READY') updatePayload.ready_at = new Date().toISOString();

    await supabase.from('pack_pallets').update(updatePayload).eq('id', pallet.id);

    // Step 6: Log state transition
    if (pallet.state !== newState) {
        await supabase.from('pack_pallet_state_log').insert({
            pallet_id: pallet.id,
            from_state: pallet.state,
            to_state: newState,
            trigger_type: 'CONTAINER_ADDED',
            metadata: {
                container_id: container.id,
                container_number: containerNumber,
                box_qty: input.box_qty,
                pallet_qty_before: pallet.current_qty,
                pallet_qty_after: newQty,
            },
            performed_by: userId,
        });
    }

    // Return updated pallet
    const updatedPallet = { ...pallet, ...updatePayload };

    return {
        container,
        pallet: updatedPallet,
        isComplete,
        needsAdjustment,
    };
}

// ============================================================================
// CONTAINERS
// ============================================================================

export async function fetchContainers(filters?: {
    item_code?: string;
    contract_config_id?: string;
    limit?: number;
}): Promise<PackContainer[]> {
    let query = supabase
        .from('pack_containers')
        .select(`
            *,
            profiles!pack_containers_created_by_fkey (full_name),
            items!pack_containers_item_id_fkey (item_name)
        `)
        .order('created_at', { ascending: false })
        .limit(filters?.limit || 500);

    if (filters?.item_code) query = query.eq('item_code', filters.item_code);
    if (filters?.contract_config_id) query = query.eq('contract_config_id', filters.contract_config_id);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((d: any) => ({
        ...d,
        operator_name: d.profiles?.full_name,
        item_name: d.items?.item_name,
    }));
}

export async function createContainer(input: {
    movement_header_id: string;
    movement_number: string;
    item_id: string;
    item_code: string;
    contract_config_id?: string;
    packing_spec_id?: string;
    quantity: number;
    is_adjustment?: boolean;
    packing_request_id?: string;
    packing_box_id?: string;
    current_warehouse_id?: string;
    reference_doc_type?: string;
    reference_doc_number?: string;
}): Promise<PackContainer> {
    const userId = await getCurrentUserId();
    const containerNumber = generateNumber('CTN');

    const { data, error } = await supabase
        .from('pack_containers')
        .insert({
            container_number: containerNumber,
            ...input,
            is_adjustment: input.is_adjustment || false,
            container_type: input.is_adjustment ? 'ADJUSTMENT_BOX' : 'INNER_BOX',
            created_by: userId,
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

// ============================================================================
// PALLETS
// ============================================================================

export async function fetchPallets(filters?: {
    item_code?: string;
    state?: PalletState | PalletState[];
}): Promise<Pallet[]> {
    let query = supabase
        .from('pack_pallets')
        .select(`
            *,
            items!pack_pallets_item_id_fkey (item_name, master_serial_no, part_number)
        `)
        .order('created_at', { ascending: false });

    if (filters?.item_code) query = query.eq('item_code', filters.item_code);
    if (filters?.state) {
        if (Array.isArray(filters.state)) {
            query = query.in('state', filters.state);
        } else {
            query = query.eq('state', filters.state);
        }
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((d: any) => ({
        ...d,
        item_name: d.items?.item_name,
        master_serial_no: d.items?.master_serial_no,
        part_number: d.items?.part_number,
    }));
}

export async function fetchPalletContainers(palletId: string): Promise<PackContainer[]> {
    const { data, error } = await supabase
        .from('pack_pallet_containers')
        .select(`
            *,
            pack_containers (
                *,
                profiles!pack_containers_created_by_fkey (full_name),
                packing_boxes:packing_box_id (packing_id, box_number)
            )
        `)
        .eq('pallet_id', palletId)
        .order('position_sequence');

    if (error) throw error;
    return (data || []).map((d: any) => ({
        ...d.pack_containers,
        operator_name: d.pack_containers?.profiles?.full_name,
        // Expose packing_id from linked packing box
        packing_id: d.pack_containers?.packing_boxes?.packing_id || null,
        box_number: d.pack_containers?.packing_boxes?.box_number || null,
    }));
}

export async function fetchPalletStateLog(palletId: string): Promise<PalletStateLog[]> {
    const { data, error } = await supabase
        .from('pack_pallet_state_log')
        .select(`*, profiles!pack_pallet_state_log_performed_by_fkey (full_name)`)
        .eq('pallet_id', palletId)
        .order('performed_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((d: any) => ({
        ...d,
        performer_name: d.profiles?.full_name,
    }));
}

// ============================================================================
// PALLET INTELLIGENCE â€” calculatePalletImpact
//   Called by StockMovement when L1 enters box count for PRODUCTION_RECEIPT.
//   Returns what will happen to pallets if this movement is submitted.
//
//   RULES (SAP EWM-grade):
//   1. Pallet MUST be completed before starting next pallet
//   2. Adjustment box MUST be created when pallet boundary is crossed
//   3. System auto-splits boxes between current and next pallet
//   4. L1 is FORCED to acknowledge adjustment before submission
// ============================================================================

export interface PalletImpact {
    currentPallet: {
        pallet_number: string;
        pallet_id: string;
        current_qty: number;
        target_qty: number;
        containers_filled: number;
        total_containers_needed: number;
        containers_needed: number;
        adjustment_qty: number;
        adjustment_needed: boolean;
        state: string;
    } | null;
    inner_box_qty: number;
    outer_box_qty: number;
    full_containers_per_pallet: number;
    total_containers_per_pallet: number;
    adjustment_qty_per_pallet: number;
    adjustmentBoxIncluded: boolean;
    adjustedInnerBoxCount: number;
    adjustedTotalQty: number;
    breakdownText: string;
    boxesToCurrentPallet: number;
    boxesToNewPallet: number;
    willCompletePallet: boolean;
    adjustmentBoxRequired: boolean;
    adjustmentBoxQty: number;
    mustCreateAdjustmentFirst: boolean;
    palletSummary: string;
    warnings: string[];
}

export async function calculatePalletImpact(
    item_code: string,
    incoming_box_count: number,
): Promise<PalletImpact> {
    const spec = await getPackingSpecForItem(item_code);
    if (!spec) throw new Error(`No packing specification found for item ${item_code}`);

    const innerQty = spec.inner_box_quantity;
    const outerQty = spec.outer_box_quantity;
    if (innerQty <= 0 || outerQty <= 0) throw new Error('Invalid packing spec');

    const fullContainersPerPallet = Math.floor(outerQty / innerQty);
    const adjustmentQtyPerPallet = outerQty % innerQty;
    // Total containers per pallet = full inner boxes + adjustment box (if applicable)
    // e.g., OPW-03: 66 full + 1 adj = 67; items with no adj remainder: just 66
    const totalContainersPerPallet = fullContainersPerPallet + (adjustmentQtyPerPallet > 0 ? 1 : 0);

    // Find current open/filling pallet
    const { data: openPallets } = await supabase
        .from('pack_pallets')
        .select('*')
        .eq('item_code', item_code)
        .in('state', ['OPEN', 'FILLING', 'ADJUSTMENT_REQUIRED'])
        .order('created_at', { ascending: true })
        .limit(1);

    const currentPallet = openPallets && openPallets.length > 0 ? openPallets[0] : null;
    const currentQty = currentPallet?.current_qty || 0;
    const targetQty = currentPallet?.target_qty || outerQty;
    const containersFilled = currentPallet?.container_count || 0;
    const adjContainerCount = currentPallet?.adjustment_container_count || 0;

    const fullBoxesRemainingForPallet = Math.max(0, fullContainersPerPallet - containersFilled);
    const adjustmentNeeded = adjustmentQtyPerPallet > 0 && adjContainerCount === 0;

    // Initial split (inner boxes only, before adj conversion)
    let innerBoxesToCurrentPallet = Math.min(incoming_box_count, fullBoxesRemainingForPallet);
    let innerBoxesToNewPallet = incoming_box_count - innerBoxesToCurrentPallet;

    const afterThisMove_fullContainers = containersFilled + innerBoxesToCurrentPallet;
    const willFillAllFullContainers = afterThisMove_fullContainers >= fullContainersPerPallet;

    // AUTO-ADJUSTMENT: When pallet boundary is crossed, convert 1 box to adjustment
    // e.g., L1 enters 10 -> becomes 9 x 450 + 1 x 300 = 4,350 PCS
    let adjustmentBoxIncluded = false;
    let adjustedInnerBoxCount = incoming_box_count;
    let adjustedTotalQty = incoming_box_count * innerQty;

    if (willFillAllFullContainers && adjustmentNeeded && incoming_box_count > 0) {
        adjustmentBoxIncluded = true;
        adjustedInnerBoxCount = incoming_box_count - 1;
        adjustedTotalQty = (adjustedInnerBoxCount * innerQty) + adjustmentQtyPerPallet;
        // Recalculate split with adjusted count
        innerBoxesToCurrentPallet = Math.min(adjustedInnerBoxCount, fullBoxesRemainingForPallet);
        innerBoxesToNewPallet = adjustedInnerBoxCount - innerBoxesToCurrentPallet;
    }

    const willCompletePallet = willFillAllFullContainers && (adjustmentBoxIncluded || !adjustmentNeeded);
    const mustCreateAdjustmentFirst = willFillAllFullContainers && adjustmentNeeded && incoming_box_count > 0;

    // Breakdown text: "9 Boxes x 450 PCS + 1 Top-off Box x 300 PCS = 4,350 PCS"
    let breakdownText = '';
    if (adjustmentBoxIncluded) {
        breakdownText = `${adjustedInnerBoxCount} Boxes x ${innerQty.toLocaleString()} PCS + 1 Top-off Box x ${adjustmentQtyPerPallet.toLocaleString()} PCS = ${adjustedTotalQty.toLocaleString()} PCS`;
    } else {
        breakdownText = `${incoming_box_count} Boxes x ${innerQty.toLocaleString()} PCS = ${adjustedTotalQty.toLocaleString()} PCS`;
    }

    // Warnings
    const warnings: string[] = [];
    if (adjustmentBoxIncluded && innerBoxesToNewPallet > 0) {
        warnings.push(
            `PALLET COMPLETION: Out of ${incoming_box_count} Boxes entered, ` +
            `${innerBoxesToCurrentPallet > 0 ? innerBoxesToCurrentPallet + ' regular Boxes + ' : ''}` +
            `1 Top-off Box (${adjustmentQtyPerPallet} PCS) will be used to complete ${currentPallet?.pallet_number || 'current pallet'}. ` +
            `Remaining ${innerBoxesToNewPallet} Box(es) will go to a new pallet.`
        );
    } else if (adjustmentBoxIncluded) {
        warnings.push(
            `System will auto-create 1 Top-off Box of ${adjustmentQtyPerPallet} PCS. ` +
            `This will ${willCompletePallet ? 'COMPLETE' : 'continue filling'} ${currentPallet?.pallet_number || 'the pallet'}.`
        );
    } else if (innerBoxesToNewPallet > 0) {
        warnings.push(
            `${innerBoxesToCurrentPallet} Box(es) will go to ${currentPallet?.pallet_number || 'current pallet'}, ` +
            `${innerBoxesToNewPallet} box(es) will go to a new pallet.`
        );
    }

    // Summary
    const palletNumber = currentPallet?.pallet_number || 'NEW';
    let palletSummary = '';
    if (!currentPallet) {
        palletSummary = `No active pallet. New pallet (${totalContainersPerPallet} inner boxes) will be created.`;
    } else {
        palletSummary = `Pallet ${palletNumber}: ${currentQty.toLocaleString()}/${targetQty.toLocaleString()} PCS (${containersFilled}/${totalContainersPerPallet} inner boxes).`;
        if (adjustmentBoxIncluded) {
            palletSummary += ` Movement: ${adjustedInnerBoxCount} Boxes x ${innerQty} PCS + 1 Top-off Box x ${adjustmentQtyPerPallet} PCS.`;
        }
        if (innerBoxesToNewPallet > 0) {
            palletSummary += ` ${innerBoxesToNewPallet} Box(es) will overflow to new pallet.`;
        }
    }

    return {
        currentPallet: currentPallet ? {
            pallet_number: currentPallet.pallet_number,
            pallet_id: currentPallet.id,
            current_qty: currentQty,
            target_qty: targetQty,
            containers_filled: containersFilled,
            total_containers_needed: totalContainersPerPallet,
            containers_needed: Math.max(0, fullBoxesRemainingForPallet),
            adjustment_qty: adjustmentQtyPerPallet,
            adjustment_needed: adjustmentNeeded,
            state: currentPallet.state,
        } : null,
        inner_box_qty: innerQty,
        outer_box_qty: outerQty,
        full_containers_per_pallet: fullContainersPerPallet,
        total_containers_per_pallet: totalContainersPerPallet,
        adjustment_qty_per_pallet: adjustmentQtyPerPallet,
        adjustmentBoxIncluded,
        adjustedInnerBoxCount,
        adjustedTotalQty,
        breakdownText,
        boxesToCurrentPallet: innerBoxesToCurrentPallet,
        boxesToNewPallet: innerBoxesToNewPallet,
        willCompletePallet,
        adjustmentBoxRequired: adjustmentBoxIncluded,
        adjustmentBoxQty: adjustmentQtyPerPallet,
        mustCreateAdjustmentFirst,
        palletSummary,
        warnings,
    };
}

export async function fetchPackingLists(): Promise<PackingList[]> {
    const { data, error } = await supabase
        .from('pack_packing_lists')
        .select(`*, profiles!pack_packing_lists_created_by_fkey (full_name)`)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((d: any) => ({
        ...d,
        created_by_name: d.profiles?.full_name,
    }));
}

export async function createPackingList(palletIds: string[], meta?: {
    customer_code?: string;
    customer_name?: string;
    dispatch_date?: string;
    vehicle_number?: string;
}): Promise<PackingList> {
    const userId = await getCurrentUserId();
    const plNumber = generateNumber('PL');

    // Fetch full pallet data (needed for item inserts)
    const { data: pallets } = await supabase
        .from('pack_pallets')
        .select('id, item_code, current_qty, container_count, items!pack_pallets_item_id_fkey (item_name)')
        .in('id', palletIds);

    const totalPallets = palletIds.length;
    const totalContainers = (pallets || []).reduce((sum: number, p: any) => sum + (p.container_count || 0), 0);
    const totalQty = (pallets || []).reduce((sum: number, p: any) => sum + (p.current_qty || 0), 0);

    const { data: pl, error: plErr } = await supabase
        .from('pack_packing_lists')
        .insert({
            packing_list_number: plNumber,
            customer_code: meta?.customer_code || null,
            customer_name: meta?.customer_name || null,
            status: 'DRAFT',
            total_pallets: totalPallets,
            total_containers: totalContainers,
            total_quantity: totalQty,
            dispatch_date: meta?.dispatch_date || null,
            vehicle_number: meta?.vehicle_number || null,
            created_by: userId,
        })
        .select()
        .single();

    if (plErr) throw plErr;

    const plId = pl.id;

    // Insert packing list items with ALL required fields
    const itemRows = (pallets || []).map((p: any, idx: number) => ({
        packing_list_id: plId,
        pallet_id: p.id,
        item_code: p.item_code,
        item_name: p.items?.item_name || p.item_code,
        quantity: p.current_qty || 0,
        container_count: p.container_count || 0,
        line_number: idx + 1,
    }));

    const { error: itemErr } = await supabase.from('pack_packing_list_items').insert(itemRows);
    if (itemErr) console.error('PL items insert error:', itemErr);

    // Lock pallets
    await supabase.from('pack_pallets').update({
        state: 'LOCKED',
        locked_at: new Date().toISOString(),
        packing_list_id: plId,
        updated_at: new Date().toISOString(),
    }).in('id', palletIds);

    return pl;
}

export async function confirmPackingList(plId: string): Promise<void> {
    await supabase.from('pack_packing_lists').update({
        status: 'CONFIRMED',
        confirmed_at: new Date().toISOString(),
    }).eq('id', plId);

    const { data: items } = await supabase
        .from('pack_packing_list_items')
        .select('pallet_id')
        .eq('packing_list_id', plId);

    if (items && items.length > 0) {
        const palletIds = items.map((i: any) => i.pallet_id);
        await supabase
            .from('pack_pallets')
            .update({
                state: 'DISPATCHED',
                dispatched_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .in('id', palletIds);
    }
}

// ============================================================================
// INVOICES
// ============================================================================

export async function fetchInvoices(): Promise<PackInvoice[]> {
    const { data, error } = await supabase
        .from('pack_invoices')
        .select(`
            *,
            pack_packing_lists!pack_invoices_packing_list_id_fkey (packing_list_number),
            profiles!pack_invoices_created_by_fkey (full_name)
        `)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((d: any) => ({
        ...d,
        packing_list_number: d.pack_packing_lists?.packing_list_number,
        created_by_name: d.profiles?.full_name,
    }));
}

export async function createInvoice(packingListId: string): Promise<PackInvoice> {
    const userId = await getCurrentUserId();
    const invNumber = generateNumber('INV');

    // Fetch packing list
    const { data: pl, error: plErr } = await supabase
        .from('pack_packing_lists')
        .select('*')
        .eq('id', packingListId)
        .eq('status', 'CONFIRMED')
        .single();

    if (plErr) throw plErr;

    const { data: inv, error: invErr } = await supabase
        .from('pack_invoices')
        .insert({
            invoice_number: invNumber,
            packing_list_id: packingListId,
            customer_code: pl.customer_code,
            customer_name: pl.customer_name,
            status: 'DRAFT',
            total_pallets: pl.total_pallets,
            total_quantity: pl.total_quantity,
            total_gross_weight_kg: pl.total_gross_weight_kg,
            created_by: userId,
        })
        .select()
        .single();

    if (invErr) throw invErr;

    // Update packing list status
    await supabase
        .from('pack_packing_lists')
        .update({ status: 'INVOICED', updated_at: new Date().toISOString() })
        .eq('id', packingListId);

    return inv;
}

// ============================================================================
// PROFORMA INVOICES
// ============================================================================

export async function fetchProformaInvoices(): Promise<ProformaInvoice[]> {
    const { data, error } = await supabase
        .from('pack_proforma_invoices')
        .select(`*, profiles!pack_proforma_invoices_created_by_fkey (full_name)`)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((d: any) => ({
        ...d,
        created_by_name: d.profiles?.full_name,
    }));
}

export async function createProforma(invoiceIds: string[]): Promise<ProformaInvoice> {
    const userId = await getCurrentUserId();
    const piNumber = generateNumber('PI');

    // Fetch invoices
    const { data: invoices, error: invErr } = await supabase
        .from('pack_invoices')
        .select('*')
        .in('id', invoiceIds)
        .eq('status', 'CONFIRMED');

    if (invErr) throw invErr;
    if (!invoices || invoices.length === 0) throw new Error('No confirmed invoices selected');

    const totalAmount = invoices.reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0);
    const totalPallets = invoices.reduce((s: number, i: any) => s + i.total_pallets, 0);
    const totalQty = invoices.reduce((s: number, i: any) => s + i.total_quantity, 0);

    const { data: pi, error: piErr } = await supabase
        .from('pack_proforma_invoices')
        .insert({
            proforma_number: piNumber,
            customer_name: invoices[0].customer_name,
            total_amount: totalAmount,
            status: 'DRAFT',
            total_invoices: invoices.length,
            total_pallets: totalPallets,
            total_quantity: totalQty,
            created_by: userId,
        })
        .select()
        .single();

    if (piErr) throw piErr;

    // Add invoice items
    const items = invoices.map((inv: any, idx: number) => ({
        proforma_id: pi.id,
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_amount: Number(inv.total_amount || 0),
        pallet_count: inv.total_pallets,
        total_quantity: inv.total_quantity,
        line_number: idx + 1,
    }));

    await supabase.from('pack_proforma_invoice_items').insert(items);

    // Mark invoices as PROFORMA_LINKED
    await supabase
        .from('pack_invoices')
        .update({ status: 'PROFORMA_LINKED', updated_at: new Date().toISOString() })
        .in('id', invoiceIds);

    return pi;
}

// ============================================================================
// DISPATCH READINESS VIEW
// ============================================================================

export async function fetchDispatchReadiness(): Promise<DispatchReadiness[]> {
    // Using the SQL view via RPC or raw query
    const { data, error } = await supabase.rpc('get_dispatch_readiness');
    if (error) {
        // Fallback: manual query
        return fetchDispatchReadinessFallback();
    }
    return data || [];
}

async function fetchDispatchReadinessFallback(): Promise<DispatchReadiness[]> {
    // Read from packing_specifications (not pack_contract_configs)
    const { data: specs, error: specErr } = await supabase
        .from('packing_specifications')
        .select(`
            item_code, outer_box_quantity, inner_box_quantity,
            items!packing_specifications_item_id_fkey (item_name, master_serial_no)
        `)
        .eq('is_active', true);

    if (specErr) throw specErr;
    if (!specs || specs.length === 0) return [];

    const itemCodes = specs.map((s: any) => s.item_code);
    const { data: pallets, error: palErr } = await supabase
        .from('pack_pallets')
        .select('item_code, state, current_qty, container_count')
        .in('item_code', itemCodes)
        .neq('state', 'CANCELLED');

    if (palErr) throw palErr;

    return specs.map((s: any) => {
        const itemPallets = (pallets || []).filter((p: any) => p.item_code === s.item_code);
        return {
            item_code: s.item_code,
            item_name: s.items?.item_name || s.item_code,
            master_serial_no: s.items?.master_serial_no,
            contract_outer_qty: s.outer_box_quantity,
            inner_box_qty: s.inner_box_quantity,
            customer_name: null,
            ready_pallets: itemPallets.filter((p: any) => p.state === 'READY').length,
            partial_pallets: itemPallets.filter((p: any) => ['OPEN', 'FILLING', 'ADJUSTMENT_REQUIRED'].includes(p.state)).length,
            locked_pallets: itemPallets.filter((p: any) => p.state === 'LOCKED').length,
            dispatched_pallets: itemPallets.filter((p: any) => p.state === 'DISPATCHED').length,
            ready_qty: itemPallets.filter((p: any) => p.state === 'READY').reduce((sum: number, p: any) => sum + p.current_qty, 0),
            partial_qty: itemPallets.filter((p: any) => ['OPEN', 'FILLING', 'ADJUSTMENT_REQUIRED'].includes(p.state)).reduce((sum: number, p: any) => sum + p.current_qty, 0),
            total_containers: itemPallets.reduce((sum: number, p: any) => sum + p.container_count, 0),
        };
    });
}

// ============================================================================
// TRACEABILITY
// ============================================================================

export async function fetchFullTrace(filters?: {
    item_code?: string;
    pallet_number?: string;
    invoice_number?: string;
    container_number?: string;
}): Promise<TraceRecord[]> {
    let query = supabase
        .from('pack_containers')
        .select(`
            *,
            profiles!pack_containers_created_by_fkey (full_name, employee_id),
            items!pack_containers_item_id_fkey (item_name, master_serial_no, part_number),
            pack_pallet_containers (
                position_sequence,
                pack_pallets (
                    pallet_number, state, target_qty, current_qty, ready_at,
                    pack_packing_list_items (
                        pack_packing_lists (packing_list_number, confirmed_at),
                        pack_packing_lists (
                            pack_invoices (
                                invoice_number, invoice_date, confirmed_at,
                                pack_proforma_invoice_items (
                                    pack_proforma_invoices (proforma_number, stock_moved_at)
                                )
                            )
                        )
                    )
                )
            )
        `)
        .order('created_at', { ascending: false })
        .limit(200);

    if (filters?.item_code) query = query.eq('item_code', filters.item_code);
    if (filters?.container_number) query = query.eq('container_number', filters.container_number);

    const { data, error } = await query;
    if (error) throw error;

    // Flatten the nested joins
    return (data || []).map((d: any) => {
        const pc = d.pack_pallet_containers?.[0];
        const pallet = pc?.pack_pallets;
        const pli = pallet?.pack_packing_list_items?.[0];
        const pl = pli?.pack_packing_lists;
        const inv = pl?.pack_invoices?.[0];
        const pii = inv?.pack_proforma_invoice_items?.[0];
        const pi = pii?.pack_proforma_invoices;

        return {
            container_number: d.container_number,
            container_qty: d.quantity,
            container_type: d.container_type,
            is_adjustment: d.is_adjustment,
            sticker_printed: d.sticker_printed,
            movement_number: d.movement_number,
            operator_name: d.profiles?.full_name || 'â€”',
            operator_employee_id: d.profiles?.employee_id,
            reference_doc_type: d.reference_doc_type,
            reference_doc_number: d.reference_doc_number,
            item_code: d.item_code,
            item_name: d.items?.item_name || d.item_code,
            master_serial_no: d.items?.master_serial_no,
            container_created: d.created_at,
            pallet_number: pallet?.pallet_number || null,
            pallet_state: pallet?.state || null,
            pallet_target: pallet?.target_qty || null,
            pallet_actual: pallet?.current_qty || null,
            packing_list_number: pl?.packing_list_number || null,
            packing_list_confirmed: pl?.confirmed_at || null,
            invoice_number: inv?.invoice_number || null,
            invoice_date: inv?.invoice_date || null,
            invoice_confirmed: inv?.confirmed_at || null,
            proforma_number: pi?.proforma_number || null,
            dispatch_timestamp: pi?.stock_moved_at || null,
        };
    });
}

// ============================================================================
// AGGREGATION COUNTERS
// ============================================================================

export async function fetchAggregationCounters() {
    const { data, error } = await supabase
        .from('pack_aggregation_counters')
        .select('*')
        .order('updated_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

// ============================================================================
// MASTER PACKING LIST DATA — Enterprise Packing List Header + Print
// ============================================================================

export interface PackingListData {
    id: string;
    packing_list_id: string;
    // Exporter
    exporter_name: string;
    exporter_address: string;
    exporter_phone: string;
    exporter_email: string;
    exporter_gstin: string;
    exporter_pan: string | null;
    exporter_ref: string | null;
    exporter_iec_code: string | null;
    exporter_ad_code: string | null;
    // Invoice/PO
    invoice_number: string | null;
    invoice_date: string | null;
    purchase_order_number: string | null;
    purchase_order_date: string | null;
    vendor_number: string | null;
    // Consignee
    consignee_name: string | null;
    consignee_address: string | null;
    consignee_phone: string | null;
    // Buyer
    buyer_name: string | null;
    buyer_phone: string | null;
    buyer_email: string | null;
    // Bill To
    bill_to_name: string | null;
    bill_to_address: string | null;
    // Shipping
    ship_via: string | null;
    pre_carriage_by: string | null;
    place_of_receipt: string | null;
    country_of_origin: string;
    country_of_destination: string | null;
    vessel_flight_no: string | null;
    port_of_loading: string | null;
    terms_of_delivery: string | null;
    payment_terms: string | null;
    port_of_discharge: string | null;
    final_destination: string | null;
    mode_of_transport: string | null;
    // Item description
    item_description_header: string | null;
    item_description_sub_header: string | null;
    batch_number: string | null;
    // Meta
    notes: string | null;
    extra_data: Record<string, any>;
    is_finalized: boolean;
    // Audit
    created_by: string;
    created_at: string;
    updated_at: string;
}

export interface PackingListPalletDetail {
    id: string;
    packing_list_data_id: string;
    packing_list_id: string;
    pallet_id: string;
    pallet_number: string;
    carton_number: string | null;
    batch_number: string | null;
    item_code: string;
    item_name: string | null;
    part_number: string | null;
    master_serial_no: string | null;
    hts_code: string | null;
    part_revision: string | null;
    num_pallets: number;
    qty_per_pallet: number;
    total_containers: number;
    pallet_length_cm: number | null;
    pallet_width_cm: number | null;
    pallet_height_cm: number | null;
    net_weight_kg: number;
    gross_weight_kg: number;
    invoice_number: string | null;
    po_number: string | null;
    line_number: number;
    extra_data: Record<string, any>;
    created_at: string;
}

/**
 * Fetch packing list data header for a given packing list
 */
export async function fetchPackingListData(packingListId: string): Promise<PackingListData | null> {
    const { data, error } = await supabase
        .from('pack_packing_list_data')
        .select('*')
        .eq('packing_list_id', packingListId)
        .maybeSingle();

    if (error) throw error;
    return data;
}

/**
 * Fetch all packing list data records (for the data management view)
 */
export async function fetchAllPackingListData(): Promise<(PackingListData & { packing_list_number?: string })[]> {
    const { data, error } = await supabase
        .from('pack_packing_list_data')
        .select(`
                *,
                pack_packing_lists!pack_packing_list_data_packing_list_id_fkey (packing_list_number, status, total_pallets, total_containers, total_quantity)
            `)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((d: any) => ({
        ...d,
        packing_list_number: d.pack_packing_lists?.packing_list_number,
        pl_status: d.pack_packing_lists?.status,
        pl_total_pallets: d.pack_packing_lists?.total_pallets,
        pl_total_containers: d.pack_packing_lists?.total_containers,
        pl_total_quantity: d.pack_packing_lists?.total_quantity,
    }));
}

/**
 * Default values for packing list data — pre-filled from company template.
 * Only Invoice No/Date, PO No/Date, Ship Via, Vendor No, and packing details
 * are entered by the user. Everything else uses these defaults.
 */
export const PACKING_LIST_DEFAULTS: Partial<Omit<PackingListData, 'id' | 'packing_list_id' | 'created_by' | 'created_at' | 'updated_at'>> = {
    // Exporter
    exporter_name: 'AUTOCRAT ENGINEERS',
    exporter_address: 'NO. 21 & 22, Export Promotion Industrial Park, Phase - I, Whitefield, Bangalore-560066, KARNATAKA - INDIA',
    exporter_phone: 'PH 91 80 43330127',
    exporter_email: 'dispatch@autocratengineers.in',
    exporter_gstin: '29ABLPK6831H1ZB',
    exporter_ref: '-NIL-',
    exporter_iec_code: '0702002747',
    exporter_ad_code: '6361504-8400009',
    // Consignee
    consignee_name: 'Milano Millworks, LLC',
    consignee_address: '9223 Industrial Blvd NE Leland, NC 28451 USA',
    consignee_phone: '(910) 443-3075',
    // Buyer
    buyer_name: 'Brown, Sherry',
    buyer_phone: '919-209-2411',
    buyer_email: 'sherry.brown@opwglobal.com',
    // Bill To
    bill_to_name: 'OPW Fueling Components, LLC',
    bill_to_address: '3250 US Highway 70 Business West, Smithfield, NC 27577, United States',
    // Shipping
    pre_carriage_by: 'Road',
    place_of_receipt: 'BANGALORE',
    country_of_origin: 'INDIA',
    country_of_destination: 'UNITED STATES',
    port_of_loading: 'BANGALORE, ICD',
    terms_of_delivery: 'DDP',
    payment_terms: 'Net-30',
    final_destination: 'UNITED STATES',
    mode_of_transport: 'SEA',
    // Item description
    item_description_header: 'PRECISION MACHINED COMPONENTS',
    item_description_sub_header: '(OTHERS FUELING COMPONENTS)',
};

/**
 * Create or update packing list data header.
 * On CREATE, merges PACKING_LIST_DEFAULTS with provided data
 * so all static fields are pre-filled.
 */
export async function upsertPackingListData(
    packingListId: string,
    data: Partial<Omit<PackingListData, 'id' | 'packing_list_id' | 'created_by' | 'created_at'>>
): Promise<PackingListData> {
    const userId = await getCurrentUserId();

    // Check if exists
    const existing = await fetchPackingListData(packingListId);

    if (existing) {
        const { data: updated, error } = await supabase
            .from('pack_packing_list_data')
            .update({
                ...data,
                updated_by: userId,
                updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
            .select()
            .single();

        if (error) throw error;
        return updated;
    }

    // New record: merge defaults with provided data (user data overrides defaults)
    const { data: created, error } = await supabase
        .from('pack_packing_list_data')
        .insert({
            ...PACKING_LIST_DEFAULTS,
            ...data,
            packing_list_id: packingListId,
            created_by: userId,
            updated_by: userId,
        })
        .select()
        .single();

    if (error) throw error;
    return created;
}

/**
 * Fetch pallet details for a packing list data record
 */
export async function fetchPackingListPalletDetails(packingListDataId: string): Promise<PackingListPalletDetail[]> {
    const { data, error } = await supabase
        .from('pack_packing_list_pallet_details')
        .select('*')
        .eq('packing_list_data_id', packingListDataId)
        .order('line_number');

    if (error) throw error;
    return data || [];
}

/**
 * Auto-populate pallet details from packing list pallets.
 * Fetches each pallet's data + item info + packing spec dimensions, and
 * creates detail rows for each pallet in the packing list.
 */
export async function autoPopulatePalletDetails(
    packingListId: string,
    packingListDataId: string,
): Promise<PackingListPalletDetail[]> {
    // Fetch packing list items (pallets in this PL)
    const { data: plItems, error: plErr } = await supabase
        .from('pack_packing_list_items')
        .select('pallet_id, line_number')
        .eq('packing_list_id', packingListId)
        .order('line_number');

    if (plErr) throw plErr;
    if (!plItems || plItems.length === 0) return [];

    const palletIds = plItems.map((i: any) => i.pallet_id);

    // Fetch pallets with item info
    const { data: pallets, error: palErr } = await supabase
        .from('pack_pallets')
        .select(`
                *,
                items!pack_pallets_item_id_fkey (item_name, master_serial_no, part_number, revision)
            `)
        .in('id', palletIds);

    if (palErr) throw palErr;

    // Fetch packing specs for dimensions
    const itemCodes = [...new Set((pallets || []).map((p: any) => p.item_code))];
    const specMap: Record<string, PackingSpec> = {};
    for (const ic of itemCodes) {
        const spec = await getPackingSpecForItem(ic);
        if (spec) specMap[ic] = spec;
    }

    // Build insert records
    const details = (pallets || []).map((p: any, idx: number) => {
        const spec = specMap[p.item_code];
        // Convert mm to cm for pallet dimensions
        const lengthCm = spec ? (spec.outer_box_length_mm / 10) : null;
        const widthCm = spec ? (spec.outer_box_width_mm / 10) : null;
        const heightCm = spec ? (spec.outer_box_height_mm / 10) : null;
        const netWt = spec ? Number(spec.inner_box_net_weight_kg || 0) * (p.container_count || 0) : 0;
        const grossWt = spec ? Number(spec.outer_box_gross_weight_kg || 0) * (p.container_count || 0) : 0;

        return {
            packing_list_data_id: packingListDataId,
            packing_list_id: packingListId,
            pallet_id: p.id,
            pallet_number: p.pallet_number,
            item_code: p.item_code,
            item_name: p.items?.item_name || p.item_code,
            part_number: p.items?.part_number || null,
            master_serial_no: p.items?.master_serial_no || null,
            qty_per_pallet: p.current_qty || 0,
            total_containers: p.container_count || 0,
            pallet_length_cm: lengthCm,
            pallet_width_cm: widthCm,
            pallet_height_cm: heightCm,
            net_weight_kg: netWt,
            gross_weight_kg: grossWt,
            line_number: idx + 1,
            part_revision: p.items?.revision || null,
        };
    });

    // Delete existing details for this PL data (re-populate)
    await supabase
        .from('pack_packing_list_pallet_details')
        .delete()
        .eq('packing_list_data_id', packingListDataId);

    // Insert new details
    const { data: inserted, error: insErr } = await supabase
        .from('pack_packing_list_pallet_details')
        .insert(details)
        .select();

    if (insErr) throw insErr;
    return inserted || [];
}

/**
 * Update a single pallet detail row (dispatch team edits)
 */
export async function updatePalletDetail(
    detailId: string,
    updates: Partial<Pick<
        PackingListPalletDetail,
        'carton_number' | 'batch_number' | 'hts_code' | 'part_revision' |
        'net_weight_kg' | 'gross_weight_kg' | 'invoice_number' | 'po_number' |
        'pallet_length_cm' | 'pallet_width_cm' | 'pallet_height_cm' | 'extra_data'
    >>
): Promise<PackingListPalletDetail> {
    const { data, error } = await supabase
        .from('pack_packing_list_pallet_details')
        .update({
            ...updates,
            updated_at: new Date().toISOString(),
        })
        .eq('id', detailId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Get full pallet backtrack for the packing list print.
 * Returns all containers, their movements, packing boxes, operators, etc.
 */
export async function getPackingListFullBacktrack(packingListId: string): Promise<{
    packingList: PackingList;
    headerData: PackingListData | null;
    palletDetails: PackingListPalletDetail[];
    containerTrace: Array<{
        pallet_number: string;
        container_number: string;
        container_type: string;
        quantity: number;
        is_adjustment: boolean;
        movement_number: string;
        operator_name: string;
        packing_box_id: string | null;
        reference_doc_type: string | null;
        reference_doc_number: string | null;
        created_at: string;
    }>;
}> {
    // 1. Fetch packing list
    const { data: pl, error: plErr } = await supabase
        .from('pack_packing_lists')
        .select('*')
        .eq('id', packingListId)
        .single();

    if (plErr) throw plErr;

    // 2. Fetch header data
    const headerData = await fetchPackingListData(packingListId);

    // 3. Fetch pallet details
    let palletDetails: PackingListPalletDetail[] = [];
    if (headerData) {
        palletDetails = await fetchPackingListPalletDetails(headerData.id);
    }

    // 3.5 Enrich missing part_revision from items table
    const needsRevision = palletDetails.filter(d => !d.part_revision && d.item_code);
    if (needsRevision.length > 0) {
        const itemCodes = [...new Set(needsRevision.map(d => d.item_code))];
        const { data: items } = await supabase
            .from('items')
            .select('item_code, revision')
            .in('item_code', itemCodes);
        if (items && items.length > 0) {
            const revMap: Record<string, string> = {};
            for (const it of items) { if (it.revision) revMap[it.item_code] = it.revision; }
            palletDetails = palletDetails.map(d => ({
                ...d,
                part_revision: d.part_revision || revMap[d.item_code] || null,
            }));
        }
    }

    // 4. Fetch all containers in this PL's pallets
    const { data: plItems } = await supabase
        .from('pack_packing_list_items')
        .select('pallet_id')
        .eq('packing_list_id', packingListId);

    const palletIds = (plItems || []).map((i: any) => i.pallet_id);
    let containerTrace: any[] = [];

    if (palletIds.length > 0) {
        const { data: pcJoin } = await supabase
            .from('pack_pallet_containers')
            .select(`
                    pack_pallets!inner (pallet_number),
                    pack_containers!inner (
                        container_number, container_type, quantity, is_adjustment,
                        movement_number, packing_box_id,
                        reference_doc_type, reference_doc_number, created_at,
                        profiles!pack_containers_created_by_fkey (full_name),
                        packing_boxes:packing_box_id (packing_id)
                    )
                `)
            .in('pallet_id', palletIds)
            .order('position_sequence');

        containerTrace = (pcJoin || []).map((row: any) => ({
            pallet_number: row.pack_pallets?.pallet_number,
            container_number: row.pack_containers?.container_number,
            container_type: row.pack_containers?.container_type,
            quantity: row.pack_containers?.quantity,
            is_adjustment: row.pack_containers?.is_adjustment,
            movement_number: row.pack_containers?.movement_number,
            operator_name: row.pack_containers?.profiles?.full_name || '—',
            packing_box_id: row.pack_containers?.packing_box_id,
            packing_id: row.pack_containers?.packing_boxes?.packing_id || null,
            reference_doc_type: row.pack_containers?.reference_doc_type,
            reference_doc_number: row.pack_containers?.reference_doc_number,
            created_at: row.pack_containers?.created_at,
        }));
    }

    return { packingList: pl, headerData, palletDetails, containerTrace };
}
