// ============================================================================
// PACKING MODULE — TYPE DEFINITIONS (v5)
// ============================================================================
// ARCHITECTURE CHANGE (v5):
//   - Movement ID = primary reference for the packing request
//   - Each BOX gets its own unique Packing ID (PKG-XXXXXXXX)
//   - Stock does NOT move on supervisor approval
//   - Stock moves from PRODUCTION → FG Warehouse only when operator
//     explicitly triggers stock transfer (partial or complete)
//   - Operator can do partial packing + partial stock transfer
//   - "Complete Packing" → confirms stock transfer to FG Warehouse
// ============================================================================

// ============================================================================
// STATUS TYPES
// ============================================================================

export type PackingRequestStatus =
    | 'APPROVED'              // Supervisor approved — packing can begin, NO stock moved yet
    | 'REJECTED'              // Supervisor rejected — no stock movement
    | 'PACKING_IN_PROGRESS'   // Operator started packing — creating boxes
    | 'PARTIALLY_TRANSFERRED' // Some boxes packed & stock partially moved to FG Warehouse
    | 'COMPLETED';            // All boxes packed, all stock transferred to FG Warehouse

export type PackingAuditAction =
    | 'PACKING_CREATED'
    | 'PACKING_REJECTED'
    | 'PACKING_STARTED'
    | 'BOX_CREATED'
    | 'BOX_DELETED'
    | 'STICKER_PRINTED'
    | 'STOCK_PARTIAL_TRANSFER'   // Partial stock moved to FG Warehouse
    | 'STOCK_FULL_TRANSFER'      // Full stock moved on complete packing
    | 'PACKING_COMPLETED';

// ============================================================================
// PACKING REQUEST ENTITY
// ============================================================================

export interface PackingRequest {
    id: string;
    movement_header_id: string;
    movement_number: string;
    item_code: string;
    total_packed_qty: number;
    status: PackingRequestStatus;
    created_by: string;
    approved_by: string | null;
    created_at: string;
    approved_at: string | null;
    rejected_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    operator_remarks: string | null;
    supervisor_remarks: string | null;

    // Stock transfer tracking
    transferred_qty?: number;          // How many PCS have been moved to FG Warehouse so far
    last_transfer_at?: string | null;  // Last stock transfer timestamp

    // Joined fields
    created_by_name?: string;
    approved_by_name?: string;
    item_name?: string;
    part_number?: string | null;
    master_serial_no?: string | null;
    revision?: string | null;

    // Computed from packing_boxes
    boxes_packed_qty?: number;
    boxes_count?: number;
    all_stickers_printed?: boolean;
}

// ============================================================================
// PACKING BOX ENTITY
// ============================================================================

export interface PackingBox {
    id: string;
    packing_request_id: string;
    packing_id: string;            // Unique PKG-XXXXXXXX for THIS box
    box_number: number;
    box_qty: number;
    sticker_printed: boolean;
    sticker_printed_at: string | null;
    is_transferred: boolean;       // Has this box's stock been moved to FG Warehouse?
    transferred_at: string | null; // When was this box's stock transferred?
    created_by: string;
    created_at: string;
    created_by_name?: string;
}

// ============================================================================
// PACKING AUDIT LOG ENTITY
// ============================================================================

export interface PackingAuditLog {
    id: string;
    packing_request_id: string;
    action_type: PackingAuditAction;
    performed_by: string;
    role: string | null;
    created_at: string;
    metadata: Record<string, any>;
    performed_by_name?: string;
}

// ============================================================================
// STICKER DATA (label generation for print)
// ============================================================================

export interface StickerData {
    packingId: string;          // Per-box PKG-XXXXXXXX
    partNumber: string;
    description: string;
    mslNo: string;
    revision: string;
    movementNumber: string;
    packingRequestId: string;
    boxNumber: number;
    totalBoxes: number;
    boxQuantity: number;
    totalQuantity: number;
    packingDate: string;
    itemCode: string;
    operatorName: string;
}

// ============================================================================
// STATUS DISPLAY CONFIG — ERP Standard (text-only)
// ============================================================================

export const PACKING_STATUS_CONFIG: Record<PackingRequestStatus, {
    color: string;
    bg: string;
    label: string;
}> = {
    APPROVED: {
        color: '#dc2626',
        bg: '#fef2f2',
        label: 'Pending',
    },
    REJECTED: {
        color: '#6b7280',
        bg: '#f3f4f6',
        label: 'Cancelled',
    },
    PACKING_IN_PROGRESS: {
        color: '#d97706',
        bg: '#fffbeb',
        label: 'In Progress',
    },
    PARTIALLY_TRANSFERRED: {
        color: '#d97706',
        bg: '#fffbeb',
        label: 'Partial Transfer',
    },
    COMPLETED: {
        color: '#16a34a',
        bg: '#f0fdf4',
        label: 'Completed',
    },
};

// ============================================================================
// STATE MACHINE
// ============================================================================

export const VALID_STATUS_TRANSITIONS: Record<PackingRequestStatus, PackingRequestStatus[]> = {
    APPROVED: ['PACKING_IN_PROGRESS'],
    REJECTED: [],
    PACKING_IN_PROGRESS: ['PARTIALLY_TRANSFERRED', 'COMPLETED'],
    PARTIALLY_TRANSFERRED: ['COMPLETED'],
    COMPLETED: [],
};

export function isValidTransition(
    from: PackingRequestStatus,
    to: PackingRequestStatus
): boolean {
    return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================================
// AUDIT ACTION LABELS
// ============================================================================

export const AUDIT_ACTION_LABELS: Record<PackingAuditAction, string> = {
    PACKING_CREATED: 'Packing Request Created',
    PACKING_REJECTED: 'Movement Rejected by Supervisor',
    PACKING_STARTED: 'Packing Started by Operator',
    BOX_CREATED: 'Box Added',
    BOX_DELETED: 'Box Removed',
    STICKER_PRINTED: 'Sticker Printed',
    STOCK_PARTIAL_TRANSFER: 'Partial Stock Transferred to FG Warehouse',
    STOCK_FULL_TRANSFER: 'Full Stock Transferred to FG Warehouse',
    PACKING_COMPLETED: 'Packing Completed',
};

// ============================================================================
// PACKING ID — Generated per BOX (unique identifier per box)
// Format: PKG- + first 8 hex chars of box UUID (uppercase)
// Each box in the system gets its own traceable PKG number.
// ============================================================================

export function generatePackingId(boxUUID: string): string {
    return 'PKG-' + boxUUID.replace(/-/g, '').substring(0, 8).toUpperCase();
}

// ============================================================================
// AUDIT METADATA FORMATTER — Human-readable, no UUIDs
// Handles both old data (has box_id) and new data (clean)
// ============================================================================

export function formatAuditDetails(actionType: string, metadata: Record<string, any> | null | undefined): string {
    if (!metadata || Object.keys(metadata).length === 0) return '—';
    const m = metadata;

    switch (actionType) {
        case 'PACKING_CREATED':
            return `Item: ${m.item_code || '—'} | Approved: ${m.approved_qty || '—'} PCS | Movement: ${m.movement_number || '—'}`;
        case 'PACKING_REJECTED':
            return `Item: ${m.item_code || '—'} | Requested: ${m.requested_qty || '—'} PCS | Reason: ${m.rejection_reason || '—'}`;
        case 'PACKING_STARTED':
            return '—';
        case 'BOX_CREATED':
            return `Box #${m.box_number ?? '—'} | ${m.box_qty ?? m.qty ?? '—'} PCS | PKG: ${m.packing_id || '—'}`;
        case 'BOX_DELETED':
            return `Box #${m.box_number ?? '—'} | ${m.box_qty ?? m.qty ?? '—'} PCS removed | PKG: ${m.packing_id || '—'}`;
        case 'STICKER_PRINTED':
            if (m.box_number) return `Box #${m.box_number} | ${m.qty ?? ''} PCS | PKG: ${m.packing_id || '—'}`;
            return 'Sticker printed';
        case 'STOCK_PARTIAL_TRANSFER':
            return `${m.transferred_qty || '—'} PCS moved to FG Warehouse | ${m.boxes_transferred || '—'} box(es) | Remaining: ${m.remaining_qty || '—'} PCS`;
        case 'STOCK_FULL_TRANSFER':
            return `${m.transferred_qty || '—'} PCS moved to FG Warehouse | All ${m.boxes_transferred || '—'} box(es) transferred`;
        case 'PACKING_COMPLETED':
            return `${m.total_packed_qty || '—'} PCS in ${m.boxes_count || '—'} boxes | All stock in FG Warehouse`;
        default:
            // Generic fallback: filter out UUID-like values and _id keys
            return Object.entries(m)
                .filter(([k, v]) => {
                    if (k.endsWith('_id') || k === 'id') return false;
                    if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)) return false;
                    return true;
                })
                .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
                .join(' | ') || '—';
    }
}
