/**
 * usePaginatedData — Shared hook for server-side paginated data + backend aggregates
 *
 * RULES (NON-NEGOTIABLE):
 *   ❌ Summary cards must NEVER use paginated data
 *   ✅ Summary cards must ALWAYS use backend aggregates
 *   ✅ Aggregates update when filters/search change
 *   ✅ Aggregates do NOT change when only page changes
 *
 * Architecture:
 *   1. Data query: paginated (page × limit rows)
 *   2. Aggregate query: parallel HEAD count queries (total + per-status)
 *   3. Both share the SAME filter/search/dateRange — ensuring consistency
 *   4. Page changes only re-fetch data, NOT aggregates (performance)
 *   5. Filter/search changes re-fetch BOTH data AND aggregates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient } from '../utils/supabase/client';
import {
  type FilterSpec,
  type SearchSpec,
  type DateRangeSpec,
  type OrderSpec,
  applyFilters,
  applySearch,
  applyDateRange,
  applyPagination,
  applyOrder,
  fetchAggregates,
} from '../utils/supabase/queryBuilder';

// ============================================================================
// TYPES
// ============================================================================

export interface UsePaginatedDataOptions {
  /** Supabase table name */
  tableName: string;
  /** Columns to select (e.g., 'id, status, item, quantity, date') — NO select('*') */
  selectColumns: string;
  /** Column used for status-based aggregate counts */
  statusField?: string;
  /** Status values to count (e.g., ['PENDING_APPROVAL', 'APPROVED', 'REJECTED']) */
  statusValues?: string[];
  /** Equality/IN/NEQ filters */
  filters?: FilterSpec;
  /** Search specification */
  search?: SearchSpec;
  /** Date range filter */
  dateRange?: DateRangeSpec;
  /** Order specification */
  orderBy?: OrderSpec;
  /** Current page (0-indexed) */
  page: number;
  /** Records per page */
  limit: number;
  /** Whether to run the query (default: true) */
  enabled?: boolean;
  /** Optional transform function for raw rows */
  transform?: (rows: any[]) => any[];
}

export interface UsePaginatedDataResult<T = any> {
  /** Paginated data for the current page */
  data: T[];
  /** Backend aggregate counts (total + per-status) */
  aggregates: Record<string, number>;
  /** Pagination metadata */
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
  /** True during initial load */
  loading: boolean;
  /** True during refresh (data already exists) */
  refreshing: boolean;
  /** Error message if any */
  error: string | null;
  /** Manual refresh function */
  refresh: () => Promise<void>;
  /** Force refresh aggregates (e.g., after a mutation) */
  refreshAggregates: () => Promise<void>;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function usePaginatedData<T = any>(
  options: UsePaginatedDataOptions
): UsePaginatedDataResult<T> {
  const {
    tableName,
    selectColumns,
    statusField,
    statusValues = [],
    filters,
    search,
    dateRange,
    orderBy,
    page,
    limit,
    enabled = true,
    transform,
  } = options;

  const [data, setData] = useState<T[]>([]);
  const [aggregates, setAggregates] = useState<Record<string, number>>({ total: 0 });
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = getSupabaseClient();
  const abortRef = useRef<AbortController | null>(null);
  const hasDataRef = useRef(false);

  // ── Serialize filter/search/dateRange for dependency tracking ──
  const filterKey = JSON.stringify(filters ?? {});
  const searchKey = JSON.stringify(search ?? {});
  const dateRangeKey = JSON.stringify(dateRange ?? {});

  // ── Fetch paginated data ──
  const fetchData = useCallback(async () => {
    if (!enabled) return;

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    const isFirstLoad = !hasDataRef.current;
    if (isFirstLoad) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      // Build paginated data query
      let query = supabase.from(tableName).select(selectColumns, { count: 'exact' });
      query = applyFilters(query, filters);
      query = applySearch(query, search);
      query = applyDateRange(query, dateRange);
      query = applyOrder(query, orderBy);
      query = applyPagination(query, { page, limit });

      const { data: rows, count, error: queryError } = await query;

      if (queryError) throw queryError;

      const processedRows = transform ? transform(rows || []) : (rows || []);
      setData(processedRows as T[]);
      setTotalCount(count ?? 0);
      hasDataRef.current = true;
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error(`[usePaginatedData] ${tableName} fetch error:`, err);
        setError(err.message || 'Failed to fetch data');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tableName, selectColumns, filterKey, searchKey, dateRangeKey, orderBy?.column, orderBy?.ascending, page, limit, enabled]);

  // ── Fetch aggregates (independent of page) ──
  const fetchAggregateData = useCallback(async () => {
    if (!enabled || !statusField || statusValues.length === 0) return;

    try {
      const aggs = await fetchAggregates(
        tableName,
        statusField,
        statusValues,
        filters,
        search,
        dateRange,
      );
      setAggregates(aggs);
    } catch (err: any) {
      console.error(`[usePaginatedData] ${tableName} aggregate error:`, err);
      // Non-critical: aggregates fail silently, data still works
    }
  }, [tableName, statusField, JSON.stringify(statusValues), filterKey, searchKey, dateRangeKey, enabled]);

  // ── Effect: Fetch data when page OR filters change ──
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Effect: Fetch aggregates only when filters change (NOT page) ──
  useEffect(() => {
    fetchAggregateData();
  }, [fetchAggregateData]);

  // ── Public refresh methods ──
  const refresh = useCallback(async () => {
    await Promise.all([fetchData(), fetchAggregateData()]);
  }, [fetchData, fetchAggregateData]);

  const refreshAggregates = useCallback(async () => {
    await fetchAggregateData();
  }, [fetchAggregateData]);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return {
    data,
    aggregates,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
    loading,
    refreshing,
    error,
    refresh,
    refreshAggregates,
  };
}
