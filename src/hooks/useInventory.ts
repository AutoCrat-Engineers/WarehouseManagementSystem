// ============================================================================
// MULTI-WAREHOUSE INVENTORY HOOKS
// React hooks for inventory data management
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { inventoryService } from '../services/inventoryService';
import type {
    ItemStockDashboard,
    ItemStockDistribution,
    ItemWarehouseDetail,
    ItemStockSummary,
    BlanketReleaseReservation,
    RecentStockMovement,
    Warehouse,
    WarehouseType,
    StockQueryFilters,
    MovementQueryFilters,
    StockStatus,
} from '../types/inventory';

// ============================================================================
// HOOK: useItemStockDashboard
// For the Stock Distribution & Movements card (single item)
// ============================================================================

interface UseItemStockDashboardResult {
    data: ItemStockDashboard | null;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

export function useItemStockDashboard(itemCode: string | null): UseItemStockDashboardResult {
    const [data, setData] = useState<ItemStockDashboard | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        if (!itemCode) {
            setData(null);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const result = await inventoryService.getItemStockDashboard(itemCode);
            setData(result);
        } catch (err: any) {
            console.error('useItemStockDashboard error:', err);
            setError(err.message || 'Failed to fetch stock dashboard');
        } finally {
            setLoading(false);
        }
    }, [itemCode]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return { data, loading, error, refetch: fetchData };
}

// ============================================================================
// HOOK: useAllItemsStockDashboard
// For the main inventory dashboard grid
// ============================================================================

interface UseAllItemsStockDashboardResult {
    items: ItemStockDashboard[];
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
    // Computed stats
    stats: {
        totalItems: number;
        criticalCount: number;
        lowCount: number;
        healthyCount: number;
        totalNetAvailable: number;
    };
}

export function useAllItemsStockDashboard(
    filters?: StockQueryFilters
): UseAllItemsStockDashboardResult {
    const [items, setItems] = useState<ItemStockDashboard[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const result = await inventoryService.getAllItemsStockDashboard(filters);
            setItems(result);
        } catch (err: any) {
            console.error('useAllItemsStockDashboard error:', err);
            setError(err.message || 'Failed to fetch stock dashboard');
        } finally {
            setLoading(false);
        }
    }, [JSON.stringify(filters)]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const stats = useMemo(() => {
        return {
            totalItems: items.length,
            criticalCount: items.filter(i => i.stockStatus === 'CRITICAL').length,
            lowCount: items.filter(i => i.stockStatus === 'LOW').length,
            healthyCount: items.filter(i => i.stockStatus === 'HEALTHY' || i.stockStatus === 'MEDIUM').length,
            totalNetAvailable: items.reduce((sum, i) => sum + (i.netAvailableForCustomer || 0), 0),
        };
    }, [items]);

    return { items, loading, error, refetch: fetchData, stats };
}

// ============================================================================
// HOOK: useItemStockDistribution
// For detailed stock breakdown modal
// ============================================================================

interface UseItemStockDistributionResult {
    data: ItemStockDistribution | null;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

export function useItemStockDistribution(
    itemCode: string | null
): UseItemStockDistributionResult {
    const [data, setData] = useState<ItemStockDistribution | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        if (!itemCode) {
            setData(null);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const result = await inventoryService.getItemStockDistribution(itemCode);
            setData(result);
        } catch (err: any) {
            console.error('useItemStockDistribution error:', err);
            setError(err.message || 'Failed to fetch stock distribution');
        } finally {
            setLoading(false);
        }
    }, [itemCode]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return { data, loading, error, refetch: fetchData };
}

// ============================================================================
// HOOK: useItemWarehouseDetails
// For warehouse-level drill-down
// ============================================================================

interface UseItemWarehouseDetailsResult {
    details: ItemWarehouseDetail[];
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
    // Grouped by warehouse type
    byWarehouseType: Record<string, ItemWarehouseDetail[]>;
}

export function useItemWarehouseDetails(
    itemCode: string | null
): UseItemWarehouseDetailsResult {
    const [details, setDetails] = useState<ItemWarehouseDetail[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        if (!itemCode) {
            setDetails([]);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const result = await inventoryService.getItemWarehouseDetails(itemCode);
            setDetails(result);
        } catch (err: any) {
            console.error('useItemWarehouseDetails error:', err);
            setError(err.message || 'Failed to fetch warehouse details');
        } finally {
            setLoading(false);
        }
    }, [itemCode]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const byWarehouseType = useMemo(() => {
        return details.reduce((acc, detail) => {
            const type = detail.warehouseTypeName || 'Other';
            if (!acc[type]) acc[type] = [];
            acc[type].push(detail);
            return acc;
        }, {} as Record<string, ItemWarehouseDetail[]>);
    }, [details]);

    return { details, loading, error, refetch: fetchData, byWarehouseType };
}

// ============================================================================
// HOOK: useItemStockSummary
// For main inventory table/grid
// ============================================================================

interface UseItemStockSummaryResult {
    items: ItemStockSummary[];
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

export function useItemStockSummary(
    filters?: StockQueryFilters
): UseItemStockSummaryResult {
    const [items, setItems] = useState<ItemStockSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const result = await inventoryService.getItemStockSummary(filters);
            setItems(result);
        } catch (err: any) {
            console.error('useItemStockSummary error:', err);
            setError(err.message || 'Failed to fetch stock summary');
        } finally {
            setLoading(false);
        }
    }, [JSON.stringify(filters)]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return { items, loading, error, refetch: fetchData };
}

// ============================================================================
// HOOK: useBlanketReleaseReservations
// For showing reserved stock against blanket orders
// ============================================================================

interface UseBlanketReleaseReservationsResult {
    reservations: BlanketReleaseReservation[];
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
    // Grouped by period
    byPeriod: {
        overdue: BlanketReleaseReservation[];
        currentMonth: BlanketReleaseReservation[];
        nextMonth: BlanketReleaseReservation[];
        future: BlanketReleaseReservation[];
    };
    // Totals
    totals: {
        overdueQty: number;
        currentMonthQty: number;
        nextMonthQty: number;
        futureQty: number;
        grandTotal: number;
    };
}

export function useBlanketReleaseReservations(
    itemCode?: string
): UseBlanketReleaseReservationsResult {
    const [reservations, setReservations] = useState<BlanketReleaseReservation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const result = await inventoryService.getBlanketReleaseReservations(itemCode);
            setReservations(result);
        } catch (err: any) {
            console.error('useBlanketReleaseReservations error:', err);
            setError(err.message || 'Failed to fetch reservations');
        } finally {
            setLoading(false);
        }
    }, [itemCode]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const byPeriod = useMemo(() => {
        return {
            overdue: reservations.filter(r => r.deliveryPeriod === 'OVERDUE'),
            currentMonth: reservations.filter(r => r.deliveryPeriod === 'CURRENT_MONTH'),
            nextMonth: reservations.filter(r => r.deliveryPeriod === 'NEXT_MONTH'),
            future: reservations.filter(r => r.deliveryPeriod === 'FUTURE'),
        };
    }, [reservations]);

    const totals = useMemo(() => {
        const sumQty = (list: BlanketReleaseReservation[]) =>
            list.reduce((sum, r) => sum + (r.pendingQuantity || 0), 0);

        return {
            overdueQty: sumQty(byPeriod.overdue),
            currentMonthQty: sumQty(byPeriod.currentMonth),
            nextMonthQty: sumQty(byPeriod.nextMonth),
            futureQty: sumQty(byPeriod.future),
            grandTotal: sumQty(reservations),
        };
    }, [byPeriod, reservations]);

    return { reservations, loading, error, refetch: fetchData, byPeriod, totals };
}

// ============================================================================
// HOOK: useRecentStockMovements
// For movement history display
// ============================================================================

interface UseRecentStockMovementsResult {
    movements: RecentStockMovement[];
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

export function useRecentStockMovements(
    filters?: MovementQueryFilters
): UseRecentStockMovementsResult {
    const [movements, setMovements] = useState<RecentStockMovement[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const result = await inventoryService.getRecentStockMovements(filters);
            setMovements(result);
        } catch (err: any) {
            console.error('useRecentStockMovements error:', err);
            setError(err.message || 'Failed to fetch movements');
        } finally {
            setLoading(false);
        }
    }, [JSON.stringify(filters)]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return { movements, loading, error, refetch: fetchData };
}

// ============================================================================
// HOOK: useWarehouses
// For warehouse master data
// ============================================================================

interface UseWarehousesResult {
    warehouses: Warehouse[];
    warehouseTypes: WarehouseType[];
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

export function useWarehouses(): UseWarehousesResult {
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [warehouseTypes, setWarehouseTypes] = useState<WarehouseType[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const [whResult, typeResult] = await Promise.all([
                inventoryService.getWarehouses(),
                inventoryService.getWarehouseTypes(),
            ]);
            setWarehouses(whResult);
            setWarehouseTypes(typeResult);
        } catch (err: any) {
            console.error('useWarehouses error:', err);
            setError(err.message || 'Failed to fetch warehouses');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return { warehouses, warehouseTypes, loading, error, refetch: fetchData };
}

// ============================================================================
// HOOK: useStockValidation
// For blanket release stock validation
// ============================================================================

interface UseStockValidationResult {
    isValid: boolean | null;
    validating: boolean;
    error: string | null;
    validate: (warehouseId: string, itemCode: string, quantity: number, lotNumber?: string) => Promise<boolean>;
}

export function useStockValidation(): UseStockValidationResult {
    const [isValid, setIsValid] = useState<boolean | null>(null);
    const [validating, setValidating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const validate = useCallback(async (
        warehouseId: string,
        itemCode: string,
        quantity: number,
        lotNumber?: string
    ): Promise<boolean> => {
        setValidating(true);
        setError(null);

        try {
            const result = await inventoryService.validateStockForRelease(
                warehouseId,
                itemCode,
                quantity,
                lotNumber
            );
            setIsValid(result);
            return result;
        } catch (err: any) {
            console.error('useStockValidation error:', err);
            setError(err.message || 'Validation failed');
            setIsValid(false);
            return false;
        } finally {
            setValidating(false);
        }
    }, []);

    return { isValid, validating, error, validate };
}

// ============================================================================
// HOOK: useStockHealthSummary
// For dashboard summary cards
// ============================================================================

interface UseStockHealthSummaryResult {
    summary: {
        critical: number;
        low: number;
        medium: number;
        healthy: number;
        total: number;
    };
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

export function useStockHealthSummary(): UseStockHealthSummaryResult {
    const [summary, setSummary] = useState({
        critical: 0,
        low: 0,
        medium: 0,
        healthy: 0,
        total: 0,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const result = await inventoryService.getStockHealthSummary();
            setSummary(result);
        } catch (err: any) {
            console.error('useStockHealthSummary error:', err);
            setError(err.message || 'Failed to fetch health summary');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return { summary, loading, error, refetch: fetchData };
}

// ============================================================================
// EXPORT ALL HOOKS
// ============================================================================

export const inventoryHooks = {
    useItemStockDashboard,
    useAllItemsStockDashboard,
    useItemStockDistribution,
    useItemWarehouseDetails,
    useItemStockSummary,
    useBlanketReleaseReservations,
    useRecentStockMovements,
    useWarehouses,
    useStockValidation,
    useStockHealthSummary,
};
