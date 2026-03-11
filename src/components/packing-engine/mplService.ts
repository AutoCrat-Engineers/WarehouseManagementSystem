/**
 * mplService.ts — Master Packing List & Performa Invoice Service Layer
 *
 * Enterprise-grade service for:
 *   - Master Packing List (MPL) CRUD + state machine
 *   - Performa Invoice (PI) shipment workflow
 *   - MPL cancellation with pallet release
 *   - Dispatch audit logging
 *   - Full traceability chain
 *
 * References existing tables from presentschema.sql:
 *   - pack_pallets, pack_containers, pack_pallet_containers
 *   - pack_packing_lists, pack_packing_list_data, pack_packing_list_pallet_details
 *   - pack_proforma_invoices
 *   - inv_warehouse_stock, inv_stock_ledger (dispatch stock transfer)
 *   - profiles, items, packing_specifications
 *
 * Architecture: Dispatch (PI approval) writes directly to inv_stock_ledger
 * with the Proforma Invoice as the reference document. No inv_movement_headers
 * are created — those are reserved for the Stock Movement approval workflow.
 */

import { getSupabaseClient } from '../../utils/supabase/client';

const supabase = getSupabaseClient();

// ============================================================================
// TYPES
// ============================================================================

export type MplStatus = 'DRAFT' | 'CONFIRMED' | 'PRINTED' | 'DISPATCHED' | 'CANCELLED';

export interface MasterPackingList {
    id: string;
    mpl_number: string;
    packing_list_id: string;
    packing_list_data_id: string | null;
    invoice_number: string | null;
    po_number: string | null;
    total_pallets: number;
    total_containers: number;
    total_quantity: number;
    total_net_weight_kg: number;
    total_gross_weight_kg: number;
    item_code: string;
    item_name: string | null;
    status: MplStatus;
    printed_at: string | null;
    printed_by: string | null;
    print_count: number;
    dispatched_at: string | null;
    proforma_invoice_id: string | null;
    confirmed_at: string | null;
    cancelled_at: string | null;
    cancellation_reason: string | null;
    extra_data: Record<string, any>;
    notes: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
    row_version: number;
    // Joined
    created_by_name?: string;
    packing_list_number?: string;
    proforma_number?: string;
    printed_status?: string;
}

export interface MplPallet {
    id: string;
    mpl_id: string;
    pallet_id: string;
    pallet_number: string;
    item_code: string;
    item_name: string | null;
    quantity: number;
    container_count: number;
    net_weight_kg: number;
    gross_weight_kg: number;
    inner_box_details: InnerBoxDetail[];
    inner_box_qty: number | null;
    contract_outer_qty: number | null;
    line_number: number;
    status: 'ACTIVE' | 'RELEASED';
    released_at: string | null;
    created_at: string;
}

export interface InnerBoxDetail {
    packing_id: string;
    quantity: number;
    type: string;
    is_adjustment: boolean;
    operator: string;
    created_at: string;
}

export interface MplDashboardRow {
    id: string;
    mpl_number: string;
    po_number: string | null;
    invoice_number: string | null;
    item_code: string;
    item_name: string | null;
    total_pallets: number;
    total_quantity: number;
    created_by_name: string;
    created_at: string;
    printed_status: string;
    status: MplStatus;
    packing_list_number: string | null;
    proforma_number: string | null;
}

export interface DispatchAuditEntry {
    id: string;
    entity_type: string;
    entity_id: string;
    entity_number: string | null;
    action: string;
    from_status: string | null;
    to_status: string | null;
    performed_by: string;
    performed_at: string;
    metadata: Record<string, any>;
    correlation_id: string | null;
    // Joined
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


// ============================================================================
// MASTER PACKING LIST — CRUD
// ============================================================================

/**
 * Fetch all MPLs for the home page dashboard.
 * Uses the v_mpl_dashboard view for optimized query.
 * Falls back to direct table query if view doesn't exist yet.
 */
export async function fetchMasterPackingLists(filters?: {
    status?: MplStatus;
    search?: string;
    limit?: number;
    offset?: number;
}): Promise<{ data: MasterPackingList[]; count: number }> {
    const limit = filters?.limit !== undefined ? filters.limit : 50;
    const offset = filters?.offset || 0;

    // Count-only mode (limit === 0): lightweight query just for the count
    if (limit === 0) {
        let countQuery = supabase
            .from('master_packing_lists')
            .select('id', { count: 'exact' })
            .limit(1); // Fetch minimal data, rely on count
        if (filters?.status) countQuery = countQuery.eq('status', filters.status);
        if (filters?.search) {
            const s = filters.search.trim();
            countQuery = countQuery.or(
                `mpl_number.ilike.%${s}%,` +
                `invoice_number.ilike.%${s}%,` +
                `po_number.ilike.%${s}%,` +
                `item_code.ilike.%${s}%,` +
                `item_name.ilike.%${s}%`
            );
        }
        const { count, error } = await countQuery;
        if (error) { console.error('[MPL Count]', error); throw error; }
        return { data: [], count: count || 0 };
    }

    let query = supabase
        .from('master_packing_lists')
        .select(`
            *,
            profiles!master_packing_lists_created_by_fkey (full_name),
            pack_packing_lists!master_packing_lists_packing_list_id_fkey (packing_list_number),
            pack_proforma_invoices (proforma_number)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (filters?.status) {
        query = query.eq('status', filters.status);
    }

    if (filters?.search) {
        const s = filters.search.trim();
        query = query.or(
            `mpl_number.ilike.%${s}%,` +
            `invoice_number.ilike.%${s}%,` +
            `po_number.ilike.%${s}%,` +
            `item_code.ilike.%${s}%,` +
            `item_name.ilike.%${s}%`
        );
    }

    const { data, error, count } = await query;
    if (error) throw error;

    // Secondary lookup: fetch master_serial_no from items table
    const itemCodes = [...new Set((data || []).map((d: any) => d.item_code).filter(Boolean))];
    let msnMap: Record<string, string> = {};
    if (itemCodes.length > 0) {
        const { data: items } = await supabase
            .from('items')
            .select('item_code, master_serial_no')
            .in('item_code', itemCodes);
        if (items) {
            msnMap = Object.fromEntries(items.map((i: any) => [i.item_code, i.master_serial_no || '']));
        }
    }

    const mapped = (data || []).map((d: any) => ({
        ...d,
        master_serial_no: msnMap[d.item_code] || null,
        created_by_name: d.profiles?.full_name || '—',
        packing_list_number: d.pack_packing_lists?.packing_list_number || null,
        proforma_number: d.pack_proforma_invoices?.proforma_number || null,
        printed_status: d.print_count > 0 ? 'PRINTED' : 'NOT PRINTED',
    }));

    return { data: mapped, count: count || 0 };
}

/**
 * Fetch a single MPL with full pallet breakdown.
 */
export async function fetchMplById(mplId: string): Promise<MasterPackingList | null> {
    const { data, error } = await supabase
        .from('master_packing_lists')
        .select(`
            *,
            profiles!master_packing_lists_created_by_fkey (full_name),
            pack_packing_lists!master_packing_lists_packing_list_id_fkey (packing_list_number),
            pack_proforma_invoices (proforma_number)
        `)
        .eq('id', mplId)
        .single();

    if (error || !data) return null;
    return {
        ...data,
        created_by_name: data.profiles?.full_name || '—',
        packing_list_number: data.pack_packing_lists?.packing_list_number || null,
        proforma_number: data.pack_proforma_invoices?.proforma_number || null,
        printed_status: data.print_count > 0 ? 'PRINTED' : 'NOT PRINTED',
    };
}

/**
 * Fetch MPL pallets with inner box breakdown.
 */
export async function fetchMplPallets(mplId: string): Promise<MplPallet[]> {
    const { data, error } = await supabase
        .from('master_packing_list_pallets')
        .select('*')
        .eq('mpl_id', mplId)
        .eq('status', 'ACTIVE')
        .order('line_number');

    if (error) throw error;
    return data || [];
}

/**
 * Create a Master Packing List from a confirmed packing list.
 * 
 * Workflow:
 *   1. Generate MPL-XXXXXX number (via sequence)
 *   2. Lock selected pallets (READY → LOCKED)
 *   3. Snapshot inner box details for each pallet
 *   4. Create MPL header with aggregated totals
 *   5. Create MPL ↔ Pallet junction records
 *   6. Log audit entry
 */
export async function createMasterPackingList(input: {
    packing_list_id: string;
    invoice_number?: string;
    po_number?: string;
    notes?: string;
}): Promise<MasterPackingList> {
    const userId = await getCurrentUserId();

    // 1. Generate MPL number via database sequence
    const { data: mplNumData, error: seqErr } = await supabase.rpc('generate_mpl_number');
    if (seqErr) throw seqErr;
    const mplNumber = mplNumData as string;

    // 2. Fetch packing list details
    const { data: pl, error: plErr } = await supabase
        .from('pack_packing_lists')
        .select('*')
        .eq('id', input.packing_list_id)
        .single();
    if (plErr || !pl) throw new Error('Packing list not found');

    // 3. Fetch packing list data (header info)
    const { data: plData } = await supabase
        .from('pack_packing_list_data')
        .select('*')
        .eq('packing_list_id', input.packing_list_id)
        .single();

    // 4. Fetch pallets in this packing list
    const { data: plItems, error: pliErr } = await supabase
        .from('pack_packing_list_items')
        .select('pallet_id, item_code, item_name, quantity, container_count, gross_weight_kg, net_weight_kg, line_number')
        .eq('packing_list_id', input.packing_list_id)
        .order('line_number');
    if (pliErr) throw pliErr;

    const palletIds = (plItems || []).map((i: any) => i.pallet_id);
    if (palletIds.length === 0) throw new Error('No pallets found in packing list');

    // 5. For each pallet, fetch inner container breakdown
    const palletJunctions: any[] = [];
    let totalQty = 0;
    let totalContainers = 0;
    let totalNet = 0;
    let totalGross = 0;
    let itemCode = '';
    let itemName = '';

    for (const plItem of (plItems || [])) {
        // Fetch containers for this pallet
        const { data: pcJoin } = await supabase
            .from('pack_pallet_containers')
            .select(`
                pallet_id, position_sequence,
                pack_containers!inner (
                    container_number, quantity, container_type, is_adjustment,
                    created_at, packing_box_id,
                    profiles!pack_containers_created_by_fkey (full_name),
                    packing_boxes:packing_box_id (packing_id)
                )
            `)
            .eq('pallet_id', plItem.pallet_id)
            .order('position_sequence');

        const innerBoxDetails: InnerBoxDetail[] = (pcJoin || []).map((pc: any) => ({
            packing_id: pc.pack_containers?.packing_boxes?.packing_id || '—',
            quantity: pc.pack_containers?.quantity || 0,
            type: pc.pack_containers?.container_type || 'INNER_BOX',
            is_adjustment: pc.pack_containers?.is_adjustment || false,
            operator: pc.pack_containers?.profiles?.full_name || '—',
            created_at: pc.pack_containers?.created_at || '',
        }));

        // Fetch packing spec for inner/outer qty
        const { data: pallet } = await supabase
            .from('pack_pallets')
            .select('packing_spec_id, item_code')
            .eq('id', plItem.pallet_id)
            .single();

        let innerBoxQty = null;
        let contractOuterQty = null;
        if (pallet?.packing_spec_id) {
            const { data: spec } = await supabase
                .from('packing_specifications')
                .select('inner_box_quantity, outer_box_quantity')
                .eq('id', pallet.packing_spec_id)
                .single();
            if (spec) {
                innerBoxQty = spec.inner_box_quantity;
                contractOuterQty = spec.outer_box_quantity;
            }
        }

        // Fetch pallet detail for weights
        let netWt = Number(plItem.net_weight_kg || 0);
        let grossWt = Number(plItem.gross_weight_kg || 0);
        if (plData) {
            const { data: palletDetail } = await supabase
                .from('pack_packing_list_pallet_details')
                .select('net_weight_kg, gross_weight_kg')
                .eq('packing_list_data_id', plData.id)
                .eq('pallet_id', plItem.pallet_id)
                .single();
            if (palletDetail) {
                netWt = Number(palletDetail.net_weight_kg || 0);
                grossWt = Number(palletDetail.gross_weight_kg || 0);
            }
        }

        palletJunctions.push({
            pallet_id: plItem.pallet_id,
            pallet_number: '', // Will be filled after pallet fetch
            item_code: plItem.item_code,
            item_name: plItem.item_name,
            quantity: plItem.quantity,
            container_count: plItem.container_count,
            net_weight_kg: netWt,
            gross_weight_kg: grossWt,
            inner_box_details: innerBoxDetails,
            inner_box_qty: innerBoxQty,
            contract_outer_qty: contractOuterQty,
            line_number: plItem.line_number,
        });

        totalQty += plItem.quantity;
        totalContainers += plItem.container_count;
        totalNet += netWt;
        totalGross += grossWt;
        itemCode = plItem.item_code;
        itemName = plItem.item_name || '';
    }

    // 6. Fetch pallet numbers
    const { data: pallets } = await supabase
        .from('pack_pallets')
        .select('id, pallet_number')
        .in('id', palletIds);

    const palletMap = new Map((pallets || []).map((p: any) => [p.id, p.pallet_number]));
    for (const pj of palletJunctions) {
        pj.pallet_number = palletMap.get(pj.pallet_id) || '';
    }

    // 7. Lock pallets (READY → LOCKED)
    for (const palletId of palletIds) {
        await supabase
            .from('pack_pallets')
            .update({
                state: 'LOCKED',
                locked_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                updated_by: userId,
                row_version: supabase.rpc ? undefined : undefined, // Will use SQL increment
            })
            .eq('id', palletId)
            .in('state', ['READY', 'LOCKED']); // Idempotent

        // Log state transition
        await supabase.from('pack_pallet_state_log').insert({
            pallet_id: palletId,
            from_state: 'READY',
            to_state: 'LOCKED',
            trigger_type: 'PALLET_LOCKED',
            metadata: { mpl_number: mplNumber },
            performed_by: userId,
        });
    }

    // 8. Create MPL header
    const { data: mpl, error: mplErr } = await supabase
        .from('master_packing_lists')
        .insert({
            mpl_number: mplNumber,
            packing_list_id: input.packing_list_id,
            packing_list_data_id: plData?.id || null,
            invoice_number: input.invoice_number || plData?.invoice_number || null,
            po_number: input.po_number || plData?.purchase_order_number || null,
            total_pallets: palletIds.length,
            total_containers: totalContainers,
            total_quantity: totalQty,
            total_net_weight_kg: totalNet,
            total_gross_weight_kg: totalGross,
            item_code: itemCode,
            item_name: itemName,
            status: 'DRAFT',
            created_by: userId,
        })
        .select()
        .single();

    if (mplErr) throw mplErr;

    // 9. Create MPL ↔ Pallet junction records
    for (const pj of palletJunctions) {
        await supabase.from('master_packing_list_pallets').insert({
            mpl_id: mpl.id,
            pallet_id: pj.pallet_id,
            pallet_number: pj.pallet_number,
            item_code: pj.item_code,
            item_name: pj.item_name,
            quantity: pj.quantity,
            container_count: pj.container_count,
            net_weight_kg: pj.net_weight_kg,
            gross_weight_kg: pj.gross_weight_kg,
            inner_box_details: pj.inner_box_details,
            inner_box_qty: pj.inner_box_qty,
            contract_outer_qty: pj.contract_outer_qty,
            line_number: pj.line_number,
        });
    }

    // 10. Audit log
    await logDispatchAudit({
        entity_type: 'MASTER_PACKING_LIST',
        entity_id: mpl.id,
        entity_number: mplNumber,
        action: 'CREATED',
        to_status: 'DRAFT',
        performed_by: userId,
        metadata: {
            packing_list_id: input.packing_list_id,
            packing_list_number: pl.packing_list_number,
            total_pallets: palletIds.length,
            total_quantity: totalQty,
        },
    });

    return mpl;
}


// ============================================================================
// MASTER PACKING LIST — STATE TRANSITIONS
// ============================================================================

/**
 * Confirm MPL: DRAFT → CONFIRMED
 */
export async function confirmMpl(mplId: string): Promise<void> {
    const userId = await getCurrentUserId();

    const { data: mpl, error } = await supabase
        .from('master_packing_lists')
        .select('id, mpl_number, status')
        .eq('id', mplId)
        .single();

    if (error || !mpl) throw new Error('MPL not found');
    if (mpl.status !== 'DRAFT') throw new Error(`Cannot confirm MPL in ${mpl.status} status`);

    await supabase
        .from('master_packing_lists')
        .update({
            status: 'CONFIRMED',
            confirmed_at: new Date().toISOString(),
            confirmed_by: userId,
            updated_at: new Date().toISOString(),
            updated_by: userId,
        })
        .eq('id', mplId);

    await logDispatchAudit({
        entity_type: 'MASTER_PACKING_LIST',
        entity_id: mplId,
        entity_number: mpl.mpl_number,
        action: 'CONFIRMED',
        from_status: 'DRAFT',
        to_status: 'CONFIRMED',
        performed_by: userId,
    });
}

/**
 * Mark MPL as printed: CONFIRMED → PRINTED
 */
export async function markMplPrinted(mplId: string): Promise<void> {
    const userId = await getCurrentUserId();

    const { data: mpl, error } = await supabase
        .from('master_packing_lists')
        .select('id, mpl_number, status, print_count')
        .eq('id', mplId)
        .single();

    if (error || !mpl) throw new Error('MPL not found');
    if (mpl.status !== 'CONFIRMED' && mpl.status !== 'PRINTED') {
        throw new Error(`Cannot print MPL in ${mpl.status} status`);
    }

    await supabase
        .from('master_packing_lists')
        .update({
            status: 'PRINTED',
            printed_at: new Date().toISOString(),
            printed_by: userId,
            print_count: (mpl.print_count || 0) + 1,
            updated_at: new Date().toISOString(),
            updated_by: userId,
        })
        .eq('id', mplId);

    await logDispatchAudit({
        entity_type: 'MASTER_PACKING_LIST',
        entity_id: mplId,
        entity_number: mpl.mpl_number,
        action: 'PRINTED',
        from_status: mpl.status,
        to_status: 'PRINTED',
        performed_by: userId,
        metadata: { print_count: (mpl.print_count || 0) + 1 },
    });
}

/**
 * Cancel MPL: DRAFT/CONFIRMED/PRINTED → CANCELLED
 * Calls the database function cancel_mpl() which handles pallet release.
 */
export async function cancelMpl(mplId: string, reason?: string): Promise<void> {
    const userId = await getCurrentUserId();

    const { error } = await supabase.rpc('cancel_mpl', {
        p_mpl_id: mplId,
        p_user_id: userId,
        p_reason: reason || null,
    });

    if (error) throw error;
}


// ============================================================================
// PERFORMA INVOICE — ENHANCED WORKFLOW
// ============================================================================

/**
 * Create a Performa Invoice from selected MPLs.
 * PI groups multiple MPLs into one outbound shipment.
 */
export async function createPerformaInvoice(mplIds: string[], meta?: {
    customer_name?: string;
    customer_code?: string;
}): Promise<any> {
    const userId = await getCurrentUserId();

    // Generate PI number
    const { data: piNumData, error: seqErr } = await supabase.rpc('generate_pi_number');
    if (seqErr) throw seqErr;
    const piNumber = piNumData as string;

    // Fetch MPLs
    const { data: mpls, error: mplErr } = await supabase
        .from('master_packing_lists')
        .select('*')
        .in('id', mplIds)
        .in('status', ['CONFIRMED', 'PRINTED']);

    if (mplErr) throw mplErr;
    if (!mpls || mpls.length === 0) throw new Error('No valid MPLs found');

    // Aggregate totals
    const totalPallets = mpls.reduce((s, m) => s + m.total_pallets, 0);
    const totalQty = mpls.reduce((s, m) => s + m.total_quantity, 0);
    const totalGross = mpls.reduce((s, m) => s + Number(m.total_gross_weight_kg || 0), 0);

    // Create PI header
    const { data: pi, error: piErr } = await supabase
        .from('pack_proforma_invoices')
        .insert({
            proforma_number: piNumber,
            customer_name: meta?.customer_name || mpls[0].item_name || null,
            customer_code: meta?.customer_code || null,
            total_amount: 0,
            currency_code: 'USD',
            status: 'DRAFT',
            total_invoices: mpls.length,
            total_pallets: totalPallets,
            total_quantity: totalQty,
            created_by: userId,
        })
        .select()
        .single();

    if (piErr) throw piErr;

    // Create PI ↔ MPL junction records
    for (let i = 0; i < mpls.length; i++) {
        const mpl = mpls[i];
        await supabase.from('proforma_invoice_mpls').insert({
            proforma_id: pi.id,
            mpl_id: mpl.id,
            mpl_number: mpl.mpl_number,
            invoice_number: mpl.invoice_number,
            po_number: mpl.po_number,
            item_code: mpl.item_code,
            total_pallets: mpl.total_pallets,
            total_quantity: mpl.total_quantity,
            total_gross_weight_kg: Number(mpl.total_gross_weight_kg || 0),
            line_number: i + 1,
        });

        // Link MPL to PI
        await supabase
            .from('master_packing_lists')
            .update({
                proforma_invoice_id: pi.id,
                updated_at: new Date().toISOString(),
                updated_by: userId,
            })
            .eq('id', mpl.id);
    }

    // Audit log
    await logDispatchAudit({
        entity_type: 'PROFORMA_INVOICE',
        entity_id: pi.id,
        entity_number: piNumber,
        action: 'CREATED',
        to_status: 'DRAFT',
        performed_by: userId,
        metadata: {
            mpl_count: mpls.length,
            total_pallets: totalPallets,
            total_quantity: totalQty,
            mpl_numbers: mpls.map(m => m.mpl_number),
        },
    });

    return pi;
}

/**
 * Approve Performa Invoice: CONFIRMED → STOCK_MOVED
 * Triggers automatic stock movement: FG Warehouse → In Transit Warehouse
 */
export async function approvePerformaInvoice(piId: string): Promise<void> {
    const userId = await getCurrentUserId();
    const correlationId = self.crypto?.randomUUID?.() || (Math.random().toString(36).substring(2) + Date.now().toString(36));

    // 1. Fetch PI
    const { data: pi, error: piErr } = await supabase
        .from('pack_proforma_invoices')
        .select('*')
        .eq('id', piId)
        .single();

    if (piErr || !pi) throw new Error('Performa Invoice not found');
    if (pi.status !== 'CONFIRMED') throw new Error(`PI must be CONFIRMED to approve, current: ${pi.status}`);

    // 2. Fetch linked MPLs
    const { data: piMpls } = await supabase
        .from('proforma_invoice_mpls')
        .select('*, master_packing_lists!inner (*)')
        .eq('proforma_id', piId);

    if (!piMpls || piMpls.length === 0) throw new Error('No MPLs linked to this PI');

    // 3. Find FG and In Transit warehouses
    // Warehouse codes match DB_CODE_MAP in StockMovement.tsx
    const { data: warehouses } = await supabase
        .from('inv_warehouses')
        .select('id, warehouse_code, warehouse_name')
        .in('warehouse_code', ['WH-PROD-FLOOR', 'WH-INTRANSIT']);

    const fgWarehouse = warehouses?.find((w: any) =>
        w.warehouse_code === 'WH-PROD-FLOOR'
    );
    const transitWarehouse = warehouses?.find((w: any) =>
        w.warehouse_code === 'WH-INTRANSIT'
    );

    if (!fgWarehouse || !transitWarehouse) {
        throw new Error('FG or In Transit warehouse not found. Please configure warehouses.');
    }

    // ══════════════════════════════════════════════════════════════════════
    // ARCHITECTURE: No inv_movement_headers or inv_movement_lines created.
    //
    // Movement records (inv_movement_headers) are ONLY for the Stock
    // Movement approval workflow (Production → FG). Downstream dispatch
    // flows use the Proforma Invoice itself as the transaction document.
    //
    // Stock traceability is maintained through:
    //   1. inv_stock_ledger   → Immutable ledger (debit/credit per warehouse)
    //   2. dispatch_audit_log → Cross-entity dispatch audit trail
    //   3. pack_pallet_state_log → Pallet lifecycle tracking
    //
    // Reference chain: PI → MPL → Packing List → Pallets → Containers
    // ══════════════════════════════════════════════════════════════════════

    // 4. AGGREGATE stock quantities by item_code across all MPLs
    //    A single PI may contain multiple MPLs for the same item_code.
    //    We aggregate FIRST, then do ONE deduction + ONE increment per item.
    //    This ensures:
    //      - No multiple read-modify-write on the same warehouse_stock row
    //      - Exactly 1 ledger entry per item per warehouse (clean journal)
    //      - Correct before/after quantities in the ledger

    const itemAgg: Record<string, { totalQty: number; mplNumbers: string[] }> = {};
    for (const piMpl of piMpls) {
        const mpl = piMpl.master_packing_lists;
        const itemCode = mpl.item_code;
        if (!itemAgg[itemCode]) {
            itemAgg[itemCode] = { totalQty: 0, mplNumbers: [] };
        }
        itemAgg[itemCode].totalQty += mpl.total_quantity;
        itemAgg[itemCode].mplNumbers.push(mpl.mpl_number);
    }

    // 4b. Execute ONE stock transfer per unique item_code
    for (const [itemCode, { totalQty, mplNumbers }] of Object.entries(itemAgg)) {
        const mplRef = mplNumbers.join(', ');

        // ── DEDUCT from FG Warehouse (single read-modify-write per item) ──
        const { data: srcStock } = await supabase
            .from('inv_warehouse_stock')
            .select('id, quantity_on_hand')
            .eq('warehouse_id', fgWarehouse.id)
            .eq('item_code', itemCode)
            .eq('is_active', true)
            .single();

        if (srcStock) {
            const newSrcQty = Math.max(0, srcStock.quantity_on_hand - totalQty);
            await supabase.from('inv_warehouse_stock').update({
                quantity_on_hand: newSrcQty,
                last_issue_date: new Date().toISOString(),
                updated_by: userId,
            }).eq('id', srcStock.id);

            await supabase.from('inv_stock_ledger').insert({
                warehouse_id: fgWarehouse.id,
                item_code: itemCode,
                transaction_type: 'DISPATCH_OUT',
                quantity_change: -totalQty,
                quantity_before: srcStock.quantity_on_hand,
                quantity_after: newSrcQty,
                reference_type: 'PROFORMA_INVOICE',
                reference_id: piId,
                notes: `OUT: ${totalQty} units | PI ${pi.proforma_number} | MPL: ${mplRef} | FG → In Transit`,
                created_by: userId,
            });
        }

        // ── INCREMENT In Transit Warehouse (single read-modify-write per item) ──
        const { data: dstStock } = await supabase
            .from('inv_warehouse_stock')
            .select('id, quantity_on_hand')
            .eq('warehouse_id', transitWarehouse.id)
            .eq('item_code', itemCode)
            .eq('is_active', true)
            .single();

        if (dstStock) {
            const newDstQty = dstStock.quantity_on_hand + totalQty;
            await supabase.from('inv_warehouse_stock').update({
                quantity_on_hand: newDstQty,
                last_receipt_date: new Date().toISOString(),
                updated_by: userId,
            }).eq('id', dstStock.id);

            await supabase.from('inv_stock_ledger').insert({
                warehouse_id: transitWarehouse.id,
                item_code: itemCode,
                transaction_type: 'DISPATCH_IN',
                quantity_change: totalQty,
                quantity_before: dstStock.quantity_on_hand,
                quantity_after: newDstQty,
                reference_type: 'PROFORMA_INVOICE',
                reference_id: piId,
                notes: `IN: ${totalQty} units | PI ${pi.proforma_number} | MPL: ${mplRef} | FG → In Transit`,
                created_by: userId,
            });
        } else {
            // No stock record exists in transit — create one
            await supabase.from('inv_warehouse_stock').insert({
                warehouse_id: transitWarehouse.id,
                item_code: itemCode,
                quantity_on_hand: totalQty,
                last_receipt_date: new Date().toISOString(),
                created_by: userId,
            });

            await supabase.from('inv_stock_ledger').insert({
                warehouse_id: transitWarehouse.id,
                item_code: itemCode,
                transaction_type: 'DISPATCH_IN',
                quantity_change: totalQty,
                quantity_before: 0,
                quantity_after: totalQty,
                reference_type: 'PROFORMA_INVOICE',
                reference_id: piId,
                notes: `IN: ${totalQty} units | PI ${pi.proforma_number} | MPL: ${mplRef} | FG → In Transit`,
                created_by: userId,
            });
        }
    }

    // 5. Update MPL and pallet statuses
    for (const piMpl of piMpls) {
        const mpl = piMpl.master_packing_lists;

        // Update MPL status to DISPATCHED
        await supabase
            .from('master_packing_lists')
            .update({
                status: 'DISPATCHED',
                dispatched_at: new Date().toISOString(),
                dispatched_by: userId,
                updated_at: new Date().toISOString(),
                updated_by: userId,
            })
            .eq('id', mpl.id);

        // Update pallets to DISPATCHED
        const { data: mplPallets } = await supabase
            .from('master_packing_list_pallets')
            .select('pallet_id')
            .eq('mpl_id', mpl.id)
            .eq('status', 'ACTIVE');

        for (const mp of (mplPallets || [])) {
            await supabase
                .from('pack_pallets')
                .update({
                    state: 'DISPATCHED',
                    dispatched_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    updated_by: userId,
                })
                .eq('id', mp.pallet_id);

            await supabase.from('pack_pallet_state_log').insert({
                pallet_id: mp.pallet_id,
                from_state: 'LOCKED',
                to_state: 'DISPATCHED',
                trigger_type: 'DISPATCH_EXECUTED',
                metadata: {
                    proforma_number: pi.proforma_number,
                },
                performed_by: userId,
            });
        }

        // Audit: MPL dispatched
        await logDispatchAudit({
            entity_type: 'MASTER_PACKING_LIST',
            entity_id: mpl.id,
            entity_number: mpl.mpl_number,
            action: 'DISPATCHED',
            from_status: mpl.status,
            to_status: 'DISPATCHED',
            performed_by: userId,
            metadata: { proforma_number: pi.proforma_number },
            correlation_id: correlationId,
        });
    }

    // 6. Update PI status (no stock_movement_id — PI is the reference doc itself)
    await supabase
        .from('pack_proforma_invoices')
        .update({
            status: 'STOCK_MOVED',
            stock_moved_at: new Date().toISOString(),
            stock_moved_by: userId,
            updated_at: new Date().toISOString(),
        })
        .eq('id', piId);

    // 7. Audit: PI approved & dispatched
    // (Email is sent by the frontend via the send-dispatch-email Edge Function)
    await logDispatchAudit({
        entity_type: 'PROFORMA_INVOICE',
        entity_id: piId,
        entity_number: pi.proforma_number,
        action: 'STOCK_MOVED',
        from_status: 'CONFIRMED',
        to_status: 'STOCK_MOVED',
        performed_by: userId,
        metadata: {
            source_warehouse: fgWarehouse.warehouse_name,
            dest_warehouse: transitWarehouse.warehouse_name,
            total_quantity: pi.total_quantity,
            total_pallets: pi.total_pallets,
        },
        correlation_id: correlationId,
    });
}


// ============================================================================
// SEARCH — Multi-field search optimized for indexed columns
// ============================================================================

/**
 * Search MPLs by multiple criteria (uses indexed columns).
 */
export async function searchMasterPackingLists(criteria: {
    po_number?: string;
    invoice_number?: string;
    packing_list_id?: string;
    pallet_id?: string;
    inner_box_id?: string;
    item_code?: string;
}): Promise<MasterPackingList[]> {
    let query = supabase
        .from('master_packing_lists')
        .select(`
            *,
            profiles!master_packing_lists_created_by_fkey (full_name),
            pack_packing_lists!master_packing_lists_packing_list_id_fkey (packing_list_number)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

    if (criteria.po_number) {
        query = query.ilike('po_number', `%${criteria.po_number}%`);
    }
    if (criteria.invoice_number) {
        query = query.ilike('invoice_number', `%${criteria.invoice_number}%`);
    }
    if (criteria.item_code) {
        query = query.ilike('item_code', `%${criteria.item_code}%`);
    }
    if (criteria.packing_list_id) {
        query = query.eq('packing_list_id', criteria.packing_list_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    let results = (data || []).map((d: any) => ({
        ...d,
        created_by_name: d.profiles?.full_name || '—',
        packing_list_number: d.pack_packing_lists?.packing_list_number || null,
        printed_status: d.print_count > 0 ? 'PRINTED' : 'NOT PRINTED',
    }));

    // If searching by pallet_id or inner_box_id, filter via junction tables
    if (criteria.pallet_id) {
        const { data: mplPallets } = await supabase
            .from('master_packing_list_pallets')
            .select('mpl_id')
            .eq('pallet_id', criteria.pallet_id);
        const mplIds = (mplPallets || []).map((mp: any) => mp.mpl_id);
        results = results.filter(r => mplIds.includes(r.id));
    }

    if (criteria.inner_box_id) {
        // Search pack_containers by container_number, then trace to pallet, then to MPL
        const { data: containers } = await supabase
            .from('pack_containers')
            .select('id')
            .ilike('container_number', `%${criteria.inner_box_id}%`);

        if (containers && containers.length > 0) {
            const ctnIds = containers.map((c: any) => c.id);
            const { data: pcJoin } = await supabase
                .from('pack_pallet_containers')
                .select('pallet_id')
                .in('container_id', ctnIds);

            const palletIds = (pcJoin || []).map((pc: any) => pc.pallet_id);
            const { data: mplPallets } = await supabase
                .from('master_packing_list_pallets')
                .select('mpl_id')
                .in('pallet_id', palletIds);

            const mplIds = (mplPallets || []).map((mp: any) => mp.mpl_id);
            results = results.filter(r => mplIds.includes(r.id));
        } else {
            results = [];
        }
    }

    return results;
}


// ============================================================================
// DISPATCH AUDIT LOG
// ============================================================================

async function logDispatchAudit(entry: {
    entity_type: string;
    entity_id: string;
    entity_number?: string;
    action: string;
    from_status?: string;
    to_status?: string;
    performed_by: string;
    metadata?: Record<string, any>;
    correlation_id?: string;
    parent_audit_id?: string;
}): Promise<void> {
    await supabase.from('dispatch_audit_log').insert({
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        entity_number: entry.entity_number || null,
        action: entry.action,
        from_status: entry.from_status || null,
        to_status: entry.to_status || null,
        performed_by: entry.performed_by,
        metadata: entry.metadata || {},
        correlation_id: entry.correlation_id || null,
        parent_audit_id: entry.parent_audit_id || null,
    });
}

/**
 * Fetch audit trail for an entity.
 */
export async function fetchDispatchAuditLog(entityId: string, entityType?: string): Promise<DispatchAuditEntry[]> {
    let query = supabase
        .from('dispatch_audit_log')
        .select('*, profiles!dispatch_audit_log_performed_by_fkey (full_name)')
        .eq('entity_id', entityId)
        .order('performed_at', { ascending: false });

    if (entityType) {
        query = query.eq('entity_type', entityType);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((d: any) => ({
        ...d,
        performer_name: d.profiles?.full_name || '—',
    }));
}

/**
 * Fetch audit trail by correlation ID (related events across entities).
 */
export async function fetchCorrelatedAuditLog(correlationId: string): Promise<DispatchAuditEntry[]> {
    const { data, error } = await supabase
        .from('dispatch_audit_log')
        .select('*, profiles!dispatch_audit_log_performed_by_fkey (full_name)')
        .eq('correlation_id', correlationId)
        .order('performed_at', { ascending: true });

    if (error) throw error;

    return (data || []).map((d: any) => ({
        ...d,
        performer_name: d.profiles?.full_name || '—',
    }));
}
