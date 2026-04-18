/**
 * get-movements — Edge Function
 *
 * Replaces fetchMovements() in StockMovement.tsx.
 * Runs the full multi-table query + enrichment + status correction server-side.
 *
 * Previously: 4-5 direct supabase client calls from the browser.
 * Now: single authenticated POST → server runs all queries with service role key.
 *
 * Business logic is UNCHANGED — same filters, same enrichment, same
 * COMPLETED vs PARTIALLY_APPROVED status correction.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ── Constants mirrored from StockMovement.tsx ──────────────────────────────
const REVERSE_MOVEMENT_TYPES = [
  'CUSTOMER_RETURN',
  'RETURN_TO_PRODUCTION_FLOW',
  'RETURN_TO_PRODUCTION',
  'REJECTION_DISPOSAL',
];

const DB_CODE_MAP: Record<string, string> = {
  'WH-PROD-FLOOR': 'PW',
  'WH-INTRANSIT': 'IT',
  'WH-SNV-MAIN': 'SV',
  'WH-US-TRANSIT': 'US',
};

const LOCATION_NAMES: Record<string, string> = {
  PW: 'FG Warehouse',
  IT: 'In-Transit',
  SV: 'S&V Warehouse',
  US: 'US Warehouse',
  PF: 'Production Floor',
};

function resolveWarehouseLabel(warehouseCode: string | null, warehouseName: string | null, fallback = '—'): string {
  if (warehouseCode) {
    const locCode = DB_CODE_MAP[warehouseCode];
    if (locCode && LOCATION_NAMES[locCode]) return LOCATION_NAMES[locCode];
  }
  return warehouseName || fallback;
}

// ── ISSUE 4 MIGRATION: Server-side box breakdown parsing ─────────────────────
// Previously done via regex in StockMovement.tsx handlePrintSlip lines 1019-1051.
// Exact same regex patterns and fallback logic — no changes to parsing behavior.
// Result is included in each movement record so the client uses structured data.
function parseBoxBreakdown(
  notes: string | null,
  movementType: string,
  referenceDocType: string | null,
): { boxes: number; perBox: number; total: number; adjBoxes?: number; adjQty?: number } | null {
  if (!notes) return null;
  if (movementType !== 'PRODUCTION_RECEIPT' && referenceDocType !== 'INVENTORY_ADJUSTMENT') return null;

  // New format: "... | Boxes: 67 x 450 PCS/box + 1 Top-off Box x 300 PCS = 30450 PCS | ..."
  const adjMatch = notes.match(
    /Boxes:\s*(\d+)\s*x\s*(\d+)\s*PCS\/box\s*\+\s*(\d+)\s*(?:Adj|Top-off)\s*Box(?:es)?\s*x\s*(\d+)\s*PCS\s*=\s*([\d,]+)\s*PCS/i,
  );
  if (adjMatch) {
    return {
      boxes: parseInt(adjMatch[1], 10),
      perBox: parseInt(adjMatch[2], 10),
      adjBoxes: parseInt(adjMatch[3], 10),
      adjQty: parseInt(adjMatch[4], 10),
      total: parseInt(adjMatch[5].replace(/,/g, ''), 10),
    };
  }

  // Old format: "... | Boxes: 68 × 450 PCS/box = 30450 PCS | ..."
  const boxMatch = notes.match(/Boxes:\s*(\d+)\s*[×x]\s*(\d+)\s*PCS\/box\s*=\s*([\d,]+)\s*PCS/i);
  if (boxMatch) {
    const innerBoxes = parseInt(boxMatch[1], 10);
    const perBox = parseInt(boxMatch[2], 10);
    const total = parseInt(boxMatch[3].replace(/,/g, ''), 10);
    const expectedTotal = innerBoxes * perBox;
    if (total !== expectedTotal && total < expectedTotal) {
      const adjQtyCalc = total - ((innerBoxes - 1) * perBox);
      if (adjQtyCalc > 0 && adjQtyCalc < perBox) {
        return { boxes: innerBoxes - 1, perBox, total, adjBoxes: 1, adjQty: adjQtyCalc };
      }
      return { boxes: innerBoxes, perBox, total };
    }
    return { boxes: innerBoxes, perBox, total };
  }

  return null;
}
// ── END ISSUE 4 ───────────────────────────────────────────────────────────────

interface Filters {
  status: string;
  movementType: string;
  stockType: string;
  dateFrom: string;
  dateTo: string;
  search: string;
}

interface RequestBody {
  offset: number;
  pageSize: number;
  filters: Filters;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── AUTH ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, Deno.env.get('PUBLISHABLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── PARSE BODY ────────────────────────────────────────────────────────────
    const body: RequestBody = await req.json();
    const { offset = 0, pageSize = 20, filters } = body;
    const f: Filters = filters || { status: 'ALL', movementType: 'ALL', stockType: 'ALL', dateFrom: '', dateTo: '', search: '' };

    // ── PRE-SEARCH: Cross-table text search (item_code, part_number, MSN) ──
    let searchHeaderIds: string[] | null = null;
    if (f.search) {
      const term = f.search;
      const { data: matchingItems } = await db
        .from('items')
        .select('item_code')
        .or(`item_code.ilike.%${term}%,part_number.ilike.%${term}%,master_serial_no.ilike.%${term}%`)
        .limit(200);
      const matchingItemCodes = (matchingItems || []).map((i: any) => i.item_code);
      if (matchingItemCodes.length > 0) {
        const { data: matchingLines } = await db
          .from('inv_movement_lines')
          .select('header_id')
          .in('item_code', matchingItemCodes);
        searchHeaderIds = [...new Set((matchingLines || []).map((l: any) => l.header_id as string))];
      } else {
        searchHeaderIds = [];
      }
    }


    // ── BUILD QUERY: Filters applied BEFORE pagination (critical — same as client) ──
    let query = db
      .from('inv_movement_headers')
      .select(
        `
        id, movement_number, movement_date, movement_type, status,
        reason_code, reason_description, notes, created_at,
        requested_by, approval_status,
        reference_document_type, reference_document_number,
        source_warehouse_id, destination_warehouse_id,
        source_warehouse:source_warehouse_id ( warehouse_name, warehouse_code ),
        destination_warehouse:destination_warehouse_id ( warehouse_name, warehouse_code )
      `,
        { count: 'exact' },
      );

    // Status filter — DB only has APPROVED (not COMPLETED/PARTIALLY_APPROVED)
    if (f.status !== 'ALL') {
      if (f.status === 'COMPLETED' || f.status === 'PARTIALLY_APPROVED') {
        // Both map to APPROVED in DB; server will post-filter by corrected status
        query = query.eq('status', 'APPROVED');
      } else {
        query = query.eq('status', f.status);
      }
    }

    // Movement type filter
    if (f.movementType !== 'ALL') {
      query = query.eq('movement_type', f.movementType);
    }

    // Stock type filter (maps to movement type groups)
    if (f.stockType !== 'ALL') {
      if (f.stockType === 'REJECTION') {
        query = query.in('movement_type', REVERSE_MOVEMENT_TYPES);
      } else {
        query = (query as any).not('movement_type', 'in', `(${REVERSE_MOVEMENT_TYPES.join(',')})`);
      }
    }

    // Date range filter
    if (f.dateFrom) query = query.gte('movement_date', f.dateFrom);
    if (f.dateTo) query = query.lte('movement_date', f.dateTo);

    // Search filter (movement_number + pre-searched item header IDs)
    if (f.search) {
      const term = f.search;
      if (searchHeaderIds && searchHeaderIds.length > 0) {
        const limitedIds = searchHeaderIds.slice(0, 100);
        query = query.or(`movement_number.ilike.%${term}%,id.in.(${limitedIds.join(',')})`);
      } else if (searchHeaderIds !== null && searchHeaderIds.length === 0) {
        // Search term matched no items — only match by movement_number
        query = query.ilike('movement_number', `%${term}%`);
      } else {
        query = query.ilike('movement_number', `%${term}%`);
      }
    }

    // Ordering + Pagination applied AFTER all filters
    const { data: headers, count, error: headErr } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (headErr) throw headErr;

    const totalCount = count ?? 0;
    const headerIds = (headers || []).map((h: any) => h.id);
    const userIds = [...new Set((headers || []).map((h: any) => h.requested_by).filter(Boolean))];

    // Fetch lines + profiles IN PARALLEL (both depend only on headers)
    const [linesResult, profilesResult] = await Promise.all([
      headerIds.length > 0
        ? db.from('inv_movement_lines')
          .select('header_id, item_code, actual_quantity, requested_quantity, approved_quantity')
          .in('header_id', headerIds)
        : Promise.resolve({ data: [] }),
      userIds.length > 0
        ? db.from('profiles').select('id, full_name').in('id', userIds as string[])
        : Promise.resolve({ data: [] }),
    ]);

    // Build lines map
    const linesMap: Record<string, { item_code: string; actual_quantity: number; requested_quantity: number; approved_quantity: number }> = {};
    ((linesResult as any).data || []).forEach((l: any) => {
      if (!linesMap[l.header_id]) {
        linesMap[l.header_id] = {
          item_code: l.item_code,
          actual_quantity: l.actual_quantity || 0,
          requested_quantity: l.requested_quantity || 0,
          approved_quantity: l.approved_quantity || 0,
        };
      }
    });

    // Build user name map
    const userNameMap: Record<string, string> = {};
    ((profilesResult as any).data || []).forEach((p: any) => {
      if (p.full_name) userNameMap[p.id] = p.full_name;
    });

    // Fetch item details (depends on lines data)
    const itemCodes = [...new Set(Object.values(linesMap).map(l => l.item_code))];
    const itemInfoMap: Record<string, { item_name: string; part_number: string | null; master_serial_no: string | null }> = {};
    if (itemCodes.length > 0) {
      const { data: items } = await db
        .from('items')
        .select('item_code, item_name, part_number, master_serial_no')
        .in('item_code', itemCodes as string[]);
      (items || []).forEach((i: any) => {
        itemInfoMap[i.item_code] = {
          item_name: i.item_name,
          part_number: i.part_number || null,
          master_serial_no: i.master_serial_no || null,
        };
      });
    }

    // Map to MovementRecord shape with smart status correction
    let records = (headers || []).map((h: any) => {
      const line = linesMap[h.id];
      const reqQty = line?.requested_quantity || 0;
      const apprQty = line?.approved_quantity || 0;

      // Smart status correction:
      // - DB says APPROVED but approved < requested → PARTIALLY_APPROVED
      // - DB says APPROVED and approved >= requested → COMPLETED (full approval)
      let correctedStatus = h.status;
      if (h.status === 'APPROVED') {
        if (apprQty > 0 && reqQty > 0 && apprQty < reqQty) {
          correctedStatus = 'PARTIALLY_APPROVED';
        } else {
          correctedStatus = 'COMPLETED';
        }
      }

      return {
        id: h.id,
        movement_number: h.movement_number,
        movement_date: h.movement_date,
        movement_type: h.movement_type,
        status: correctedStatus,
        reason_description: h.reason_description,
        notes: h.notes,
        created_at: h.created_at,
        source_warehouse: resolveWarehouseLabel(
          h.source_warehouse?.warehouse_code || null,
          h.source_warehouse?.warehouse_name || null,
        ),
        destination_warehouse: resolveWarehouseLabel(
          h.destination_warehouse?.warehouse_code || null,
          h.destination_warehouse?.warehouse_name || null,
        ),
        source_warehouse_id: h.source_warehouse_id || null,
        destination_warehouse_id: h.destination_warehouse_id || null,
        item_code: line?.item_code || null,
        item_name: line ? (itemInfoMap[line.item_code]?.item_name || line.item_code) : null,
        part_number: line ? (itemInfoMap[line.item_code]?.part_number || null) : null,
        master_serial_no: line ? (itemInfoMap[line.item_code]?.master_serial_no || null) : null,
        quantity: line?.actual_quantity || null,
        requested_quantity: reqQty || null,
        approved_quantity: apprQty || null,
        rejected_quantity: h.status === 'REJECTED'
          ? reqQty
          : (reqQty > 0 && apprQty > 0 ? reqQty - apprQty : 0),
        supervisor_note: null,
        requested_by: h.requested_by || null,
        requested_by_name: h.requested_by ? (userNameMap[h.requested_by] || null) : null,
        reason_code: h.reason_code || null,
        reference_document_type: h.reference_document_type || null,
        reference_document_number: h.reference_document_number || null,
        box_breakdown: parseBoxBreakdown(h.notes, h.movement_type, h.reference_document_type),
      };
    });

    // Post-filter for COMPLETED / PARTIALLY_APPROVED — same logic as original client
    // (movements.filter(m => m.status === filterStatus))
    if (f.status === 'COMPLETED' || f.status === 'PARTIALLY_APPROVED') {
      records = records.filter(r => r.status === f.status);
    }

    return new Response(
      JSON.stringify({ data: records, totalCount }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[get-movements] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);
