// ============================================================================
// MULTI-WAREHOUSE INVENTORY SERVICE
// Enterprise-grade inventory data access layer
// ============================================================================

import { getSupabaseClient } from '../utils/supabase/client';
import type {
    ItemStockDashboard,
    ItemStockDistribution,
    ItemWarehouseDetail,
    ItemStockSummary,
    BlanketReleaseReservation,
    RecentStockMovement,
    Warehouse,
    WarehouseType,
    WarehouseStock,
    StockQueryFilters,
    MovementQueryFilters,
} from '../types/inventory';

// ============================================================================
// SUPABASE CLIENT - Using existing singleton from utils
// ============================================================================

// Get the shared Supabase client instance
const supabase = getSupabaseClient();

// ============================================================================
// HELPER: Convert snake_case to camelCase
// ============================================================================

function toCamelCase<T>(obj: any): T {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(item => toCamelCase(item)) as T;
    if (typeof obj !== 'object') return obj;

    const newObj: any = {};
    for (const key in obj) {
        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        newObj[camelKey] = toCamelCase(obj[key]);
    }
    return newObj as T;
}

// ============================================================================
// DASHBOARD VIEW QUERIES
// ============================================================================

/**
 * Fetch stock dashboard data for a single item
 * Maps to: vw_item_stock_dashboard
 */
export async function getItemStockDashboard(itemCode: string): Promise<ItemStockDashboard | null> {
    const { data, error } = await supabase
        .from('vw_item_stock_dashboard')
        .select('*')
        .eq('item_code', itemCode)
        .single();

    if (error) {
        console.error('Error fetching item stock dashboard:', error);
        throw error;
    }

    return data ? toCamelCase<ItemStockDashboard>(data) : null;
}

/**
 * Fetch stock dashboard data for all items
 * Maps to: vw_item_stock_dashboard
 */
export async function getAllItemsStockDashboard(
    filters?: StockQueryFilters
): Promise<ItemStockDashboard[]> {
    let query = supabase
        .from('vw_item_stock_dashboard')
        .select('*');

    // Apply filters
    if (filters?.stockStatus) {
        query = query.eq('stock_status', filters.stockStatus);
    }
    if (filters?.hasAvailableStock) {
        query = query.gt('net_available_for_customer', 0);
    }
    if (filters?.limit) {
        query = query.limit(filters.limit);
    }
    if (filters?.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
    }

    const { data, error } = await query.order('item_code');

    if (error) {
        console.error('Error fetching all items stock dashboard:', error);
        throw error;
    }

    return toCamelCase<ItemStockDashboard[]>(data || []);
}

// ============================================================================
// DETAILED DISTRIBUTION QUERIES
// ============================================================================

/**
 * Fetch detailed stock distribution for an item
 * Maps to: vw_item_stock_distribution
 */
export async function getItemStockDistribution(
    itemCode: string
): Promise<ItemStockDistribution | null> {
    const { data, error } = await supabase
        .from('vw_item_stock_distribution')
        .select('*')
        .eq('item_code', itemCode)
        .single();

    if (error) {
        console.error('Error fetching item stock distribution:', error);
        throw error;
    }

    return data ? toCamelCase<ItemStockDistribution>(data) : null;
}

/**
 * Fetch stock distribution for all items
 */
export async function getAllItemsStockDistribution(): Promise<ItemStockDistribution[]> {
    const { data, error } = await supabase
        .from('vw_item_stock_distribution')
        .select('*')
        .order('item_code');

    if (error) {
        console.error('Error fetching stock distribution:', error);
        throw error;
    }

    return toCamelCase<ItemStockDistribution[]>(data || []);
}

// ============================================================================
// WAREHOUSE DETAIL QUERIES
// ============================================================================

/**
 * Fetch warehouse-level detail for an item
 * Maps to: vw_item_warehouse_detail
 */
export async function getItemWarehouseDetails(
    itemCode: string
): Promise<ItemWarehouseDetail[]> {
    const { data, error } = await supabase
        .from('vw_item_warehouse_detail')
        .select('*')
        .eq('item_code', itemCode)
        .order('warehouse_type_code');

    if (error) {
        console.error('Error fetching item warehouse details:', error);
        throw error;
    }

    return toCamelCase<ItemWarehouseDetail[]>(data || []);
}

/**
 * Fetch all stock details for a specific warehouse
 */
export async function getWarehouseStockDetails(
    warehouseCode: string
): Promise<ItemWarehouseDetail[]> {
    const { data, error } = await supabase
        .from('vw_item_warehouse_detail')
        .select('*')
        .eq('warehouse_code', warehouseCode)
        .order('item_code');

    if (error) {
        console.error('Error fetching warehouse stock details:', error);
        throw error;
    }

    return toCamelCase<ItemWarehouseDetail[]>(data || []);
}

// ============================================================================
// STOCK SUMMARY QUERIES
// ============================================================================

/**
 * Fetch stock summary for all items (grid view)
 * Maps to: vw_item_stock_summary
 */
export async function getItemStockSummary(
    filters?: StockQueryFilters
): Promise<ItemStockSummary[]> {
    let query = supabase
        .from('vw_item_stock_summary')
        .select('*');

    if (filters?.limit) {
        query = query.limit(filters.limit);
    }

    const { data, error } = await query.order('item_code');

    if (error) {
        console.error('Error fetching item stock summary:', error);
        throw error;
    }

    return toCamelCase<ItemStockSummary[]>(data || []);
}

// ============================================================================
// BLANKET RELEASE RESERVATIONS
// ============================================================================

/**
 * Fetch pending blanket release reservations
 * Maps to: vw_blanket_release_reservations
 */
export async function getBlanketReleaseReservations(
    itemCode?: string
): Promise<BlanketReleaseReservation[]> {
    let query = supabase
        .from('vw_blanket_release_reservations')
        .select('*');

    if (itemCode) {
        query = query.eq('item_code', itemCode);
    }

    const { data, error } = await query.order('requested_delivery_date');

    if (error) {
        console.error('Error fetching blanket release reservations:', error);
        throw error;
    }

    return toCamelCase<BlanketReleaseReservation[]>(data || []);
}

/**
 * Get next month's reserved quantity for an item
 */
export async function getNextMonthReservedQty(itemCode: string): Promise<number> {
    const { data, error } = await supabase
        .from('vw_blanket_release_reservations')
        .select('pending_quantity')
        .eq('item_code', itemCode)
        .eq('delivery_period', 'NEXT_MONTH');

    if (error) {
        console.error('Error fetching next month reserved:', error);
        return 0;
    }

    return data?.reduce((sum, row) => sum + (row.pending_quantity || 0), 0) ?? 0;
}

// ============================================================================
// STOCK MOVEMENT HISTORY
// ============================================================================

/**
 * Fetch recent stock movements
 * Maps to: vw_recent_stock_movements
 */
export async function getRecentStockMovements(
    filters?: MovementQueryFilters
): Promise<RecentStockMovement[]> {
    let query = supabase
        .from('vw_recent_stock_movements')
        .select('*');

    if (filters?.itemCode) {
        query = query.eq('item_code', filters.itemCode);
    }
    if (filters?.warehouseId) {
        query = query.eq('warehouse_code', filters.warehouseId);
    }
    if (filters?.movementType) {
        query = query.eq('movement_type', filters.movementType);
    }
    if (filters?.startDate) {
        query = query.gte('movement_date', filters.startDate);
    }
    if (filters?.endDate) {
        query = query.lte('movement_date', filters.endDate);
    }
    if (filters?.limit) {
        query = query.limit(filters.limit);
    }

    const { data, error } = await query.order('movement_date', { ascending: false });

    if (error) {
        console.error('Error fetching recent stock movements:', error);
        throw error;
    }

    return toCamelCase<RecentStockMovement[]>(data || []);
}

// ============================================================================
// WAREHOUSE MASTER DATA
// ============================================================================

/**
 * Fetch all warehouse types
 */
export async function getWarehouseTypes(): Promise<WarehouseType[]> {
    const { data, error } = await supabase
        .from('inv_warehouse_types')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

    if (error) {
        console.error('Error fetching warehouse types:', error);
        throw error;
    }

    return toCamelCase<WarehouseType[]>(data || []);
}

/**
 * Fetch all warehouses
 */
export async function getWarehouses(category?: string): Promise<Warehouse[]> {
    let query = supabase
        .from('inv_warehouses')
        .select(`
      *,
      inv_warehouse_types (
        type_code,
        type_name,
        category
      )
    `)
        .eq('is_active', true);

    const { data, error } = await query.order('warehouse_code');

    if (error) {
        console.error('Error fetching warehouses:', error);
        throw error;
    }

    // Filter by category if provided
    let filtered = data || [];
    if (category) {
        filtered = filtered.filter((w: any) => w.inv_warehouse_types?.category === category);
    }

    return toCamelCase<Warehouse[]>(filtered);
}

/**
 * Fetch warehouse by code
 */
export async function getWarehouseByCode(warehouseCode: string): Promise<Warehouse | null> {
    const { data, error } = await supabase
        .from('inv_warehouses')
        .select(`
      *,
      inv_warehouse_types (
        type_code,
        type_name,
        category
      )
    `)
        .eq('warehouse_code', warehouseCode)
        .single();

    if (error) {
        console.error('Error fetching warehouse:', error);
        throw error;
    }

    return data ? toCamelCase<Warehouse>(data) : null;
}

// ============================================================================
// WAREHOUSE STOCK OPERATIONS
// ============================================================================

/**
 * Validate stock availability for blanket release
 */
export async function validateStockForRelease(
    warehouseId: string,
    itemCode: string,
    quantity: number,
    lotNumber?: string
): Promise<boolean> {
    const { data, error } = await supabase.rpc('inv_validate_stock_for_release', {
        p_warehouse_id: warehouseId,
        p_item_code: itemCode,
        p_quantity: quantity,
        p_lot_number: lotNumber || null,
    });

    if (error) {
        console.error('Error validating stock:', error);
        return false;
    }

    return data === true;
}

/**
 * Execute blanket release stock out
 */
export async function executeBlanketRelease(
    releaseId: string,
    warehouseId: string,
    itemCode: string,
    quantity: number,
    lotNumber?: string,
    userId?: string
): Promise<string> {
    const { data, error } = await supabase.rpc('inv_execute_blanket_release', {
        p_release_id: releaseId,
        p_warehouse_id: warehouseId,
        p_item_code: itemCode,
        p_quantity: quantity,
        p_lot_number: lotNumber || null,
        p_user_id: userId || null,
    });

    if (error) {
        console.error('Error executing blanket release:', error);
        throw error;
    }

    return data as string;
}

/**
 * Get current stock for item in warehouse
 */
export async function getWarehouseStock(
    warehouseId: string,
    itemCode: string
): Promise<WarehouseStock | null> {
    const { data, error } = await supabase
        .from('inv_warehouse_stock')
        .select('*')
        .eq('warehouse_id', warehouseId)
        .eq('item_code', itemCode)
        .eq('is_active', true)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
        console.error('Error fetching warehouse stock:', error);
        throw error;
    }

    return data ? toCamelCase<WarehouseStock>(data) : null;
}

// ============================================================================
// AGGREGATE FUNCTIONS
// ============================================================================

/**
 * Get total stock across all warehouses for an item
 */
export async function getTotalStockForItem(itemCode: string): Promise<{
    totalOnHand: number;
    totalAvailable: number;
    totalReserved: number;
    warehouseCount: number;
}> {
    const { data, error } = await supabase
        .from('vw_item_stock_distribution')
        .select('total_on_hand, total_available, total_reserved')
        .eq('item_code', itemCode)
        .single();

    if (error) {
        console.error('Error fetching total stock:', error);
        return { totalOnHand: 0, totalAvailable: 0, totalReserved: 0, warehouseCount: 0 };
    }

    const details = await getItemWarehouseDetails(itemCode);

    return {
        totalOnHand: data?.total_on_hand || 0,
        totalAvailable: data?.total_available || 0,
        totalReserved: data?.total_reserved || 0,
        warehouseCount: details.length,
    };
}

/**
 * Get stock health summary across all items
 */
export async function getStockHealthSummary(): Promise<{
    critical: number;
    low: number;
    medium: number;
    healthy: number;
    total: number;
}> {
    const { data, error } = await supabase
        .from('vw_item_stock_dashboard')
        .select('stock_status');

    if (error) {
        console.error('Error fetching stock health summary:', error);
        throw error;
    }

    const summary = {
        critical: 0,
        low: 0,
        medium: 0,
        healthy: 0,
        total: data?.length || 0,
    };

    data?.forEach((item: any) => {
        const status = item.stock_status?.toLowerCase();
        if (status in summary) {
            summary[status as keyof typeof summary]++;
        }
    });

    return summary;
}

// ============================================================================
// EXPORT ALL
// ============================================================================

export const inventoryService = {
    // Dashboard
    getItemStockDashboard,
    getAllItemsStockDashboard,

    // Distribution
    getItemStockDistribution,
    getAllItemsStockDistribution,

    // Warehouse Detail
    getItemWarehouseDetails,
    getWarehouseStockDetails,

    // Summary
    getItemStockSummary,

    // Blanket Releases
    getBlanketReleaseReservations,
    getNextMonthReservedQty,

    // Movements
    getRecentStockMovements,

    // Master Data
    getWarehouseTypes,
    getWarehouses,
    getWarehouseByCode,

    // Stock Operations
    validateStockForRelease,
    executeBlanketRelease,
    getWarehouseStock,

    // Aggregates
    getTotalStockForItem,
    getStockHealthSummary,
};

export default inventoryService;
