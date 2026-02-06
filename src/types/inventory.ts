// ============================================================================
// MULTI-WAREHOUSE INVENTORY TYPES
// Types for enterprise inventory management views and operations
// ============================================================================

// ============================================================================
// WAREHOUSE TYPES
// ============================================================================

export type WarehouseCategory =
    | 'PRODUCTION'
    | 'IN_TRANSIT'
    | 'SNV'
    | 'US_TRANSIT'
    | 'DISTRIBUTION'
    | 'RETURNS'
    | 'QUARANTINE';

export type MovementStatus =
    | 'DRAFT'
    | 'PENDING_APPROVAL'
    | 'APPROVED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'REJECTED';

export type ApprovalStatus =
    | 'PENDING'
    | 'APPROVED'
    | 'REJECTED'
    | 'ESCALATED';

export type StockStatus =
    | 'CRITICAL'
    | 'LOW'
    | 'MEDIUM'
    | 'HEALTHY';

export type StockHealthIndicator =
    | 'danger'
    | 'warning'
    | 'success';

// ============================================================================
// WAREHOUSE MASTER
// ============================================================================

export interface WarehouseType {
    id: string;
    typeCode: string;
    typeName: string;
    category: WarehouseCategory;
    description?: string;
    isTransitPoint: boolean;
    isProductionSite: boolean;
    canShipExternal: boolean;
    sortOrder: number;
    isActive: boolean;
}

export interface Warehouse {
    id: string;
    warehouseCode: string;
    warehouseName: string;
    warehouseTypeId: string;
    countryCode: string;
    region?: string;
    city?: string;
    address?: string;
    postalCode?: string;
    timezone: string;
    managerUserId?: string;
    parentWarehouseId?: string;
    capacityUnits?: number;
    currentUtilizationPct: number;
    isActive: boolean;
}

// ============================================================================
// STOCK DASHBOARD VIEW (Matches UI)
// ============================================================================

export interface ItemStockDashboard {
    itemCode: string;
    itemName: string;
    uom: string;

    // Warehouse Card
    warehouseAvailable: number;
    warehouseReserved: number;

    // In Transit Card
    inTransitQuantity: number;

    // Production Card
    productionFinishedStock: number;

    // Net Available Card
    netAvailableForCustomer: number;

    // Calculation breakdown
    snvStock: number;
    usTransitStock: number;
    inTransitStock: number;
    reservedNextMonth: number;

    // Formula display
    calculationFormula: string;

    // Status
    stockStatus: StockStatus;

    // Totals
    totalOnHand: number;
    totalAvailable: number;
    qualityHoldQty: number;
}

// ============================================================================
// STOCK DISTRIBUTION VIEW (Detailed)
// ============================================================================

export interface ItemStockDistribution {
    itemCode: string;
    itemName: string;
    uom: string;

    // Production Warehouse
    productionOnHand: number;
    productionAvailable: number;
    productionReserved: number;

    // In-Transit
    inTransitQty: number;
    inTransitAvailable: number;

    // S&V Warehouse
    snvOnHand: number;
    snvAvailable: number;
    snvReserved: number;
    snvAllocated: number;

    // US Transit
    usTransitOnHand: number;
    usTransitAvailable: number;
    usTransitReserved: number;

    // Distribution
    distributionOnHand: number;
    distributionAvailable: number;

    // Quality Hold
    quarantineQty: number;
    returnsQty: number;

    // Totals
    totalOnHand: number;
    totalAvailable: number;
    totalReserved: number;
    totalAllocated: number;

    // Blanket Reservations
    blanketPendingQty: number;
    blanketNextMonthReserved: number;

    // Calculated
    netAvailableForCustomer: number;
    warehouseAvailable: number;
    totalCustomerReserved: number;
}

// ============================================================================
// WAREHOUSE DETAIL VIEW
// ============================================================================

export interface ItemWarehouseDetail {
    itemCode: string;
    itemName: string;
    uom: string;
    warehouseCode: string;
    warehouseName: string;
    warehouseTypeCode: string;
    warehouseTypeName: string;
    warehouseCategory: WarehouseCategory;
    countryCode: string;
    lotNumber?: string;
    batchNumber?: string;
    quantityOnHand: number;
    quantityAllocated: number;
    quantityReserved: number;
    quantityAvailable: number;
    qualityStatus: string;
    storageLocation?: string;
    binNumber?: string;
    expiryDate?: string;
    lastReceiptDate?: string;
    lastIssueDate?: string;
    unitCost?: number;
    stockValue: number;
    lastUpdated: string;
}

// ============================================================================
// STOCK SUMMARY VIEW (Grid)
// ============================================================================

export interface ItemStockSummary {
    itemCode: string;
    itemName: string;
    uom: string;
    productionStock: number;
    inTransitStock: number;
    warehouseStock: number;
    warehouseAvailable: number;
    warehouseReserved: number;
    qualityHold: number;
    upcomingReleases: number;
    netAvailableForCustomer: number;
    grandTotal: number;
    availabilityPct: number;
    healthIndicator: StockHealthIndicator;
}

// ============================================================================
// BLANKET RELEASE RESERVATIONS
// ============================================================================

export type DeliveryPeriod =
    | 'OVERDUE'
    | 'CURRENT_MONTH'
    | 'NEXT_MONTH'
    | 'FUTURE';

export interface BlanketReleaseReservation {
    itemCode: string;
    itemName: string;
    blanketOrderNumber: string;
    customerName: string;
    releaseNumber: string;
    releaseDate: string;
    requestedDeliveryDate: string;
    requestedQuantity: number;
    deliveredQuantity: number;
    pendingQuantity: number;
    status: string;
    deliveryPeriod: DeliveryPeriod;
    createdAt: string;
    updatedAt: string;
}

// ============================================================================
// STOCK MOVEMENTS
// ============================================================================

export interface RecentStockMovement {
    itemCode: string;
    itemName: string;
    warehouseCode: string;
    warehouseName: string;
    warehouseType: string;
    movementType: string;
    quantityChange: number;
    quantityBefore: number;
    quantityAfter: number;
    lotNumber?: string;
    batchNumber?: string;
    referenceType?: string;
    referenceNumber?: string;
    reasonCode?: string;
    notes?: string;
    sourceWarehouse?: string;
    destinationWarehouse?: string;
    movementDate: string;
    createdByName?: string;
}

// ============================================================================
// MOVEMENT DOCUMENTS
// ============================================================================

export interface MovementHeader {
    id: string;
    movementNumber: string;
    movementDate: string;
    movementType: string;
    sourceWarehouseId?: string;
    destinationWarehouseId?: string;
    status: MovementStatus;
    approvalStatus: ApprovalStatus;
    priority: string;
    referenceDocumentType?: string;
    referenceDocumentNumber?: string;
    reasonCode?: string;
    reasonDescription?: string;
    notes?: string;
    requestedBy: string;
    requestedAt: string;
    approvedBy?: string;
    approvedAt?: string;
    completedBy?: string;
    completedAt?: string;
}

export interface MovementLine {
    id: string;
    headerId: string;
    lineNumber: number;
    itemCode: string;
    lotNumber?: string;
    batchNumber?: string;
    requestedQuantity: number;
    approvedQuantity?: number;
    actualQuantity?: number;
    unitCost?: number;
    lineStatus: string;
    notes?: string;
}

// ============================================================================
// WAREHOUSE STOCK
// ============================================================================

export interface WarehouseStock {
    id: string;
    warehouseId: string;
    itemCode: string;
    lotNumber?: string;
    batchNumber?: string;
    quantityOnHand: number;
    quantityAllocated: number;
    quantityReserved: number;
    quantityInTransit: number;
    quantityAvailable: number;
    unitCost?: number;
    lastReceiptDate?: string;
    lastIssueDate?: string;
    expiryDate?: string;
    manufactureDate?: string;
    qualityStatus: string;
    storageLocation?: string;
    binNumber?: string;
    rowVersion: number;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface InventoryDashboardResponse {
    items: ItemStockDashboard[];
    lastUpdated: string;
}

export interface WarehouseStockResponse {
    warehouses: Warehouse[];
    stock: WarehouseStock[];
}

export interface StockMovementResponse {
    movements: RecentStockMovement[];
    totalCount: number;
}

// ============================================================================
// FILTER/QUERY TYPES
// ============================================================================

export interface StockQueryFilters {
    itemCode?: string;
    warehouseId?: string;
    warehouseCategory?: WarehouseCategory;
    stockStatus?: StockStatus;
    hasAvailableStock?: boolean;
    limit?: number;
    offset?: number;
}

export interface MovementQueryFilters {
    itemCode?: string;
    warehouseId?: string;
    movementType?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
}
