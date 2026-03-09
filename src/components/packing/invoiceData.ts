/**
 * invoiceData.ts — Dummy data & types for Against Invoice Packing List module.
 * Container logic: outer_box_quantity = 1 Container capacity.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface InnerBox {
    id: string;
    boxNumber: number;
    qty: number;
    status: 'Available' | 'Allocated' | 'Packed';
    containerId: string | null;
}

export interface Container {
    id: string;
    itemCode: string;
    containerNumber: number;
    capacity: number;        // = outer_box_quantity
    innerBoxQty: number;     // inner_box_quantity per box
    fullBoxCount: number;    // boxes per cycle (full)
    remainderQty: number;    // remainder box qty
    cycleSize: number;       // fullBoxCount + (remainder > 0 ? 1 : 0)
    filledBoxes: InnerBox[];
    totalFilled: number;
    remaining: number;
    status: 'Available' | 'Partially Filled' | 'Full' | 'Allocated' | 'Completed';
    invoiceId: string | null;
    createdAt: string;
}

export interface PackingListRecord {
    id: string;
    invoiceNo: string;
    invoiceDate: string;
    customer: string;
    destination: string;
    itemCode: string;
    itemName: string;
    partNumber: string;
    msn: string;
    containerCount: number;
    totalBoxes: number;
    totalQty: number;
    packedQty: number;
    status: 'Draft' | 'Packing In Progress' | 'Completed' | 'Cancelled';
    containerIds: string[];
    remarks: string;
    createdAt: string;
    operator: string;
}

export interface ItemSpec {
    itemCode: string;
    itemName: string;
    partNumber: string;
    msn: string;
    uom: string;
    outerBoxQty: number;
    innerBoxQty: number;
}

// ============================================================================
// ITEM SPECIFICATIONS (from packing_specifications)
// ============================================================================

export const ITEM_SPECS: ItemSpec[] = [
    { itemCode: 'ITM-001', itemName: 'Brake Pad Assembly LH', partNumber: 'BP-ASM-450-LH', msn: 'MSN-7742', uom: 'PCS', outerBoxQty: 30000, innerBoxQty: 450 },
    { itemCode: 'ITM-002', itemName: 'Clutch Plate Set RH', partNumber: 'CP-SET-500-RH', msn: 'MSN-8891', uom: 'PCS', outerBoxQty: 25000, innerBoxQty: 500 },
    { itemCode: 'ITM-003', itemName: 'Flywheel Ring Gear', partNumber: 'FW-RG-600', msn: 'MSN-3356', uom: 'PCS', outerBoxQty: 18000, innerBoxQty: 600 },
    { itemCode: 'ITM-004', itemName: 'Oil Seal Crankshaft Front', partNumber: 'OS-CS-200-F', msn: 'MSN-1120', uom: 'PCS', outerBoxQty: 10000, innerBoxQty: 200 },
];

// ============================================================================
// HELPER: Generate cycle-based inner boxes for a container
// ============================================================================

export function generateInnerBoxes(
    containerId: string,
    spec: ItemSpec,
    boxCount: number,
    startBoxNumber: number = 1,
): InnerBox[] {
    const full = Math.floor(spec.outerBoxQty / spec.innerBoxQty);
    const rem = spec.outerBoxQty % spec.innerBoxQty;
    const cyc = full + (rem > 0 ? 1 : 0);
    const boxes: InnerBox[] = [];
    for (let i = 0; i < boxCount; i++) {
        const posInCycle = (startBoxNumber - 1 + i) % cyc;
        const isRemainder = rem > 0 && posInCycle === full;
        boxes.push({
            id: `BOX-${containerId}-${startBoxNumber + i}`,
            boxNumber: startBoxNumber + i,
            qty: isRemainder ? rem : spec.innerBoxQty,
            status: 'Available',
            containerId,
        });
    }
    return boxes;
}

// ============================================================================
// HELPER: Compute total qty from cycle-based box count
// ============================================================================

export function computeCycleQty(outerQty: number, innerQty: number, boxCount: number): number {
    const full = Math.floor(outerQty / innerQty);
    const rem = outerQty % innerQty;
    const cyc = full + (rem > 0 ? 1 : 0);
    const completeCycles = Math.floor(boxCount / cyc);
    const leftover = boxCount % cyc;
    let total = completeCycles * outerQty;
    if (leftover <= full) {
        total += leftover * innerQty;
    } else {
        total += full * innerQty + rem;
    }
    return total;
}

// ============================================================================
// GENERATE DUMMY CONTAINERS
// ============================================================================

function makeContainers(spec: ItemSpec, count: number, allocatedTo: (string | null)[]): Container[] {
    const full = Math.floor(spec.outerBoxQty / spec.innerBoxQty);
    const rem = spec.outerBoxQty % spec.innerBoxQty;
    const cyc = full + (rem > 0 ? 1 : 0);
    return Array.from({ length: count }, (_, i) => {
        const isFull = i < count - 1; // last container partially filled
        const boxCount = isFull ? cyc : Math.floor(cyc * 0.6);
        const boxes = generateInnerBoxes(`CNT-${spec.itemCode}-${i + 1}`, spec, boxCount);
        const totalFilled = boxes.reduce((s, b) => s + b.qty, 0);
        const invId = allocatedTo[i] || null;
        return {
            id: `CNT-${spec.itemCode}-${i + 1}`,
            itemCode: spec.itemCode,
            containerNumber: i + 1,
            capacity: spec.outerBoxQty,
            innerBoxQty: spec.innerBoxQty,
            fullBoxCount: full,
            remainderQty: rem,
            cycleSize: cyc,
            filledBoxes: boxes.map(b => ({ ...b, status: invId ? 'Allocated' as const : b.status })),
            totalFilled,
            remaining: spec.outerBoxQty - totalFilled,
            status: invId ? 'Allocated' : (isFull ? 'Full' : 'Partially Filled') as Container['status'],
            invoiceId: invId,
            createdAt: new Date(Date.now() - (count - i) * 86400000).toISOString(),
        };
    });
}

export const DUMMY_CONTAINERS: Container[] = [
    ...makeContainers(ITEM_SPECS[0], 4, ['PKL-001', 'PKL-001', null, null]),
    ...makeContainers(ITEM_SPECS[1], 3, ['PKL-002', null, null]),
    ...makeContainers(ITEM_SPECS[2], 2, [null, null]),
    ...makeContainers(ITEM_SPECS[3], 2, [null, null]),
];

export const DUMMY_PACKING_LISTS: PackingListRecord[] = [
    {
        id: 'PKL-001', invoiceNo: 'INV-2026-0451', invoiceDate: '2026-02-23',
        customer: 'Tata Motors Ltd.', destination: 'Pune, Maharashtra',
        itemCode: 'ITM-001', itemName: 'Brake Pad Assembly LH', partNumber: 'BP-ASM-450-LH', msn: 'MSN-7742',
        containerCount: 2, totalBoxes: 134, totalQty: 60000, packedQty: 60000,
        status: 'Completed', containerIds: ['CNT-ITM-001-1', 'CNT-ITM-001-2'],
        remarks: 'Urgent dispatch', createdAt: '2026-02-23T10:00:00Z', operator: 'Prajeeth P',
    },
    {
        id: 'PKL-002', invoiceNo: 'INV-2026-0452', invoiceDate: '2026-02-22',
        customer: 'Mahindra & Mahindra', destination: 'Chennai, Tamil Nadu',
        itemCode: 'ITM-002', itemName: 'Clutch Plate Set RH', partNumber: 'CP-SET-500-RH', msn: 'MSN-8891',
        containerCount: 1, totalBoxes: 50, totalQty: 25000, packedQty: 18000,
        status: 'Packing In Progress', containerIds: ['CNT-ITM-002-1'],
        remarks: '', createdAt: '2026-02-22T14:00:00Z', operator: 'Arun K',
    },
    {
        id: 'PKL-003', invoiceNo: 'INV-2026-0453', invoiceDate: '2026-02-21',
        customer: 'Ashok Leyland', destination: 'Hosur, Tamil Nadu',
        itemCode: 'ITM-003', itemName: 'Flywheel Ring Gear', partNumber: 'FW-RG-600', msn: 'MSN-3356',
        containerCount: 0, totalBoxes: 0, totalQty: 0, packedQty: 0,
        status: 'Draft', containerIds: [],
        remarks: 'Awaiting container selection', createdAt: '2026-02-21T08:00:00Z', operator: '—',
    },
    {
        id: 'PKL-004', invoiceNo: 'INV-2026-0448', invoiceDate: '2026-02-20',
        customer: 'Hero MotoCorp', destination: 'Gurgaon, Haryana',
        itemCode: 'ITM-004', itemName: 'Oil Seal Crankshaft Front', partNumber: 'OS-CS-200-F', msn: 'MSN-1120',
        containerCount: 0, totalBoxes: 0, totalQty: 0, packedQty: 0,
        status: 'Cancelled', containerIds: [],
        remarks: 'Order cancelled by customer', createdAt: '2026-02-20T16:00:00Z', operator: '—',
    },
];

// ============================================================================
// STATUS CONFIG
// ============================================================================

export const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
    'Draft': { color: '#6b7280', bg: '#f3f4f6', label: 'Draft' },
    'Packing In Progress': { color: '#d97706', bg: '#fffbeb', label: 'In Progress' },
    'Completed': { color: '#16a34a', bg: '#f0fdf4', label: 'Completed' },
    'Cancelled': { color: '#dc2626', bg: '#fef2f2', label: 'Cancelled' },
    'Available': { color: '#2563eb', bg: '#eff6ff', label: 'Available' },
    'Partially Filled': { color: '#d97706', bg: '#fffbeb', label: 'Partial' },
    'Full': { color: '#16a34a', bg: '#f0fdf4', label: 'Full' },
    'Allocated': { color: '#7c3aed', bg: '#f5f3ff', label: 'Allocated' },
};
