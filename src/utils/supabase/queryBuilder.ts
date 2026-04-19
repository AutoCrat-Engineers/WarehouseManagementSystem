/**
 * queryBuilder.ts — Shared Supabase query builder utilities
 *
 * Provides helper functions to build consistent, optimized Supabase queries
 * with proper filtering, search, date ranges, and pagination.
 */

import { getSupabaseClient } from './client';

// ============================================================================
// TYPES
// ============================================================================

export interface FilterSpec {
  /** Equality filters: { column: value } */
  eq?: Record<string, string | number | boolean>;
  /** IN filters: { column: [values] } */
  in?: Record<string, (string | number)[]>;
  /** NOT filters: { column: value } */
  neq?: Record<string, string | number | boolean>;
}

export interface SearchSpec {
  /** Columns to search across */
  columns: string[];
  /** Search term */
  term: string;
}

export interface DateRangeSpec {
  /** Column name for date filtering */
  field: string;
  /** Start date (YYYY-MM-DD) */
  from?: string;
  /** End date (YYYY-MM-DD) */
  to?: string;
}

export interface PaginationSpec {
  page: number;
  limit: number;
}

export interface OrderSpec {
  column: string;
  ascending: boolean;
}

// ============================================================================
// AGGREGATE COUNT - Lightweight HEAD queries
// ============================================================================

/**
 * Fetch aggregate counts for a table using HEAD (count-only) queries.
 * Returns { total, ...statusCounts } in a single batch of parallel requests.
 */
export async function fetchAggregates(
  tableName: string,
  statusField: string,
  statusValues: string[],
  filters?: FilterSpec,
  search?: SearchSpec,
  dateRange?: DateRangeSpec,
): Promise<Record<string, number>> {
  const supabase = getSupabaseClient();

  const buildBaseQuery = () => {
    let query = supabase.from(tableName).select('id', { count: 'exact', head: true });
    query = applyFilters(query, filters);
    query = applySearch(query, search);
    query = applyDateRange(query, dateRange);
    return query;
  };

  // Total count + per-status counts in parallel
  const promises = [
    buildBaseQuery(),
    ...statusValues.map(status => {
      const q = buildBaseQuery();
      return q.eq(statusField, status);
    }),
  ];

  const results = await Promise.all(promises);

  const aggregates: Record<string, number> = {
    total: results[0].count ?? 0,
  };

  statusValues.forEach((status, idx) => {
    aggregates[status.toLowerCase()] = results[idx + 1].count ?? 0;
  });

  return aggregates;
}

// ============================================================================
// QUERY MODIFIER HELPERS
// ============================================================================

/** Apply equality/IN/NEQ filters to a query */
export function applyFilters(query: any, filters?: FilterSpec): any {
  if (!filters) return query;
  if (filters.eq) {
    for (const [col, val] of Object.entries(filters.eq)) {
      query = query.eq(col, val);
    }
  }
  if (filters.in) {
    for (const [col, vals] of Object.entries(filters.in)) {
      if (vals.length > 0) {
        query = query.in(col, vals);
      }
    }
  }
  if (filters.neq) {
    for (const [col, val] of Object.entries(filters.neq)) {
      query = query.neq(col, val);
    }
  }
  return query;
}

/** Apply ilike search across multiple columns using .or() */
export function applySearch(query: any, search?: SearchSpec): any {
  if (!search || !search.term.trim() || search.columns.length === 0) return query;
  const term = search.term.trim();
  const orClauses = search.columns.map(col => `${col}.ilike.%${term}%`).join(',');
  return query.or(orClauses);
}

/** Apply date range filter using .gte() and .lte() */
export function applyDateRange(query: any, dateRange?: DateRangeSpec): any {
  if (!dateRange) return query;
  if (dateRange.from) {
    query = query.gte(dateRange.field, dateRange.from);
  }
  if (dateRange.to) {
    query = query.lte(dateRange.field, dateRange.to + 'T23:59:59');
  }
  return query;
}

/** Apply pagination using .range() */
export function applyPagination(query: any, pagination: PaginationSpec): any {
  const from = pagination.page * pagination.limit;
  const to = from + pagination.limit - 1;
  return query.range(from, to);
}

/** Apply ordering */
export function applyOrder(query: any, order?: OrderSpec): any {
  if (!order) return query;
  return query.order(order.column, { ascending: order.ascending });
}
