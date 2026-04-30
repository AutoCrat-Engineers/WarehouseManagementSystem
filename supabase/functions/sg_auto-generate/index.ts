/**
 * sg_auto-generate — Edge Function
 *
 * Migrates `autoGenerateBoxes()` from the browser to the server.
 *
 * WHY: The original client-side function executed a sequential per-box loop
 * (processPackingBoxAsContainer) over the network. Each box triggered 5-7
 * DB round trips from the browser, producing 45+ seconds of latency for a
 * 50-box request. Moving the logic server-side collocates the loop with the
 * DB, and we additionally collapse Phase 5 (per-box writes) into an
 * in-memory simulation followed by bulk DB writes — reducing hundreds of
 * round-trips to a handful.
 *
 * BUSINESS LOGIC IS UNCHANGED. Every formula, regex, box-mix calculation,
 * pallet-routing rule (adjustment boxes → ADJUSTMENT_REQUIRED pallets first),
 * state-transition rule (OPEN / FILLING / ADJUSTMENT_REQUIRED / READY), and
 * audit-log shape is an exact port of the client-side code in:
 *   - src/components/packing/packingService.ts → autoGenerateBoxes()
 *   - src/components/packing-engine/packingEngineService.ts → processPackingBoxAsContainer()
 *
 * What IS optimised here (zero-semantic-change perf wins, no RPC):
 *   1) Spec / items / movement_header / pallet-cache all fetched in a single
 *      parallel batch instead of once per box.
 *   2) Phase 5 pallet routing runs entirely in-memory over the pre-fetched
 *      cache, so each box no longer re-reads pack_pallets from the DB.
 *   3) Container rows, pallet-container links, pallet upserts, and
 *      state-log rows are each written in ONE bulk INSERT/UPSERT at the end
 *      of the simulation rather than per iteration.
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';
import {
  generateMixedBoxBatch,
  generateNumber,
  generatePackingId,
  generateUUID,
} from '../_shared/packingUtils.ts';

// ── Request body shape ──
interface AutoGenerateBody {
  packing_request_id: string;
}

// ── Response shapes ──
interface GeneratedBox {
  id: string;
  packing_id: string;
  packing_request_id: string;
  box_number: number;
  box_qty: number;
  sticker_printed: boolean;
  is_transferred: boolean;
  created_by: string;
  created_at?: string;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── AUTH ──────────────────────────────────────────────────────────────
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
    const { data: { user }, error: authError } = await userClient.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── PARSE & VALIDATE BODY ─────────────────────────────────────────────
    const body: AutoGenerateBody = await req.json();
    const { packing_request_id: requestId } = body;

    if (!requestId) {
      return new Response(JSON.stringify({ error: 'packing_request_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 1: Parallel fetch — profile + request + existing boxes
    // Existing-boxes check is the idempotency guard.
    // ══════════════════════════════════════════════════════════════════════
    const [profileResult, reqResult, existingBoxesResult] = await Promise.all([
      db.from('profiles').select('role').eq('id', userId).single(),
      db.from('packing_requests')
        .select('status, total_packed_qty, item_code, movement_number, movement_header_id')
        .eq('id', requestId).single(),
      db.from('packing_boxes')
        .select('*')
        .eq('packing_request_id', requestId)
        .order('box_number', { ascending: true }),
    ]);

    const role: string = (profileResult.data as any)?.role || 'L1';

    if (reqResult.error || !reqResult.data) {
      return new Response(JSON.stringify({ error: 'Packing request not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const req_data = reqResult.data as any;
    const existingBoxes = (existingBoxesResult.data || []) as any[];

    // Idempotency: if boxes already exist, return them (same as client behavior)
    if (existingBoxes.length > 0) {
      const mapped = existingBoxes.map((b: any) => ({
        ...b,
        packing_id: b.packing_id || generatePackingId(b.id),
        is_transferred: b.is_transferred || false,
        transferred_at: b.transferred_at || null,
      }));
      return new Response(
        JSON.stringify({
          success: true,
          boxes: mapped,
          boxes_count: mapped.length,
          status: req_data.status,
          already_generated: true,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (req_data.status !== 'APPROVED') {
      return new Response(
        JSON.stringify({ error: 'Can only auto-generate boxes for APPROVED requests' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 1b: Parallel fetch — spec + item + openPallets +
    //           adjPalletsCount + movement-header notes.
    // This batch replaces the per-iteration reads that previously lived
    // inside processPackingBoxAsContainer, plus the three serial reads that
    // were Phase 1b / 1c / the notes lookup.
    // ══════════════════════════════════════════════════════════════════════
    const [
      specResult,
      itemResult,
      openPalletsResult,
      adjPalletsResult,
      notesResult,
    ] = await Promise.all([
      db.from('packing_specifications')
        .select('id, inner_box_quantity, outer_box_quantity')
        .eq('item_code', req_data.item_code)
        .eq('is_active', true)
        .single(),
      // items.item_code dropped in migration 018; match on part_number.
      db.from('items')
        .select('id')
        .eq('part_number', req_data.item_code)
        .is('deleted_at', null)
        .maybeSingle(),
      db.from('pack_pallets')
        .select('*')
        .eq('item_code', req_data.item_code)
        .in('state', ['OPEN', 'FILLING', 'ADJUSTMENT_REQUIRED'])
        .order('created_at', { ascending: true })
        .limit(10),
      db.from('pack_pallets')
        .select('id')
        .eq('item_code', req_data.item_code)
        .eq('state', 'ADJUSTMENT_REQUIRED'),
      req_data.movement_header_id
        ? db.from('inv_movement_headers')
            .select('notes')
            .eq('id', req_data.movement_header_id)
            .single()
        : Promise.resolve({ data: null, error: null } as any),
    ]);

    const packingSpec = specResult.data as any;
    if (!packingSpec || !packingSpec.inner_box_quantity || packingSpec.inner_box_quantity <= 0) {
      return new Response(
        JSON.stringify({ error: 'No valid packing specification found for this item. Please add one in Packing Details first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const specId: string = packingSpec.id;
    const innerBoxQty: number = packingSpec.inner_box_quantity;
    const outerBoxQty: number = packingSpec.outer_box_quantity || 0;
    let adjustmentQty: number = outerBoxQty > 0 ? outerBoxQty % innerBoxQty : 0;
    const totalQty: number = Number(req_data.total_packed_qty);

    const itemId: string | null = (itemResult.data as any)?.id || null;
    const openPallets = (openPalletsResult.data || []) as any[];
    const adjPalletsNeedingCompletion = adjustmentQty > 0
      ? ((adjPalletsResult.data || []) as any[]).length
      : 0;

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 2: Calculate the CORRECT box mix
    // Parses explicit overrides from movement notes, otherwise derives
    // from spec.  Business logic unchanged.
    // ══════════════════════════════════════════════════════════════════════
    let explicitNormalFullBoxes = 0;
    let explicitAdjustmentBoxCount = 0;
    let explicitAdjustmentQty = 0;
    let hasExplicitOverrides = false;

    const notesData = (notesResult as any).data;
    if (notesData && notesData.notes) {
      const notes: string = notesData.notes;
      const adjMatch = notes.match(/Boxes:\s*(\d+)\s*[x×]\s*\d+\s*PCS\/box\s*\+\s*(\d+)\s*(?:Adj|Top-off)\s*Box(?:es)?\s*[x×]\s*(\d+)\s*PCS/i);
      if (adjMatch) {
        explicitNormalFullBoxes = parseInt(adjMatch[1], 10);
        explicitAdjustmentBoxCount = parseInt(adjMatch[2], 10);
        explicitAdjustmentQty = parseInt(adjMatch[3], 10);
        hasExplicitOverrides = true;
      } else {
        const boxMatch = notes.match(/Boxes:\s*(\d+)\s*[x×]\s*\d+\s*PCS\/box\s*=/i);
        if (boxMatch) {
          explicitNormalFullBoxes = parseInt(boxMatch[1], 10);
          hasExplicitOverrides = true;
        }
      }
    }

    let adjustmentBoxCount = 0;
    let normalFullBoxes = 0;
    let normalRemainder = 0;

    if (hasExplicitOverrides) {
      adjustmentBoxCount = explicitAdjustmentBoxCount;
      if (explicitAdjustmentQty > 0) adjustmentQty = explicitAdjustmentQty;
      normalFullBoxes = explicitNormalFullBoxes;

      const calculatedExplicitTotal = (adjustmentBoxCount * adjustmentQty) + (normalFullBoxes * innerBoxQty);
      if (totalQty > calculatedExplicitTotal) {
        normalRemainder = totalQty - calculatedExplicitTotal;
      }
    } else {
      adjustmentBoxCount = Math.min(
        adjPalletsNeedingCompletion,
        adjustmentQty > 0 ? Math.floor(totalQty / adjustmentQty) : 0,
      );
      const adjustmentTotal = adjustmentBoxCount * adjustmentQty;
      const remainingQty = totalQty - adjustmentTotal;
      normalFullBoxes = Math.floor(remainingQty / innerBoxQty);
      normalRemainder = remainingQty % innerBoxQty;
    }

    const totalBoxes = adjustmentBoxCount + normalFullBoxes + (normalRemainder > 0 ? 1 : 0);

    if (totalBoxes <= 0) {
      return new Response(
        JSON.stringify({ error: 'Cannot generate boxes — total quantity is 0' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('[sg_auto-generate] boxMixCalculated', {
      requestId, totalQty, innerBoxQty, outerBoxQty, adjustmentQty,
      adjPalletsNeedingCompletion, adjustmentBoxCount,
      normalFullBoxes, normalRemainder, totalBoxes,
    });

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 3: Status transition + audit (parallel) — unchanged.
    // ══════════════════════════════════════════════════════════════════════
    const startedAt = new Date().toISOString();
    const [statusUpdate, startedAuditInsert] = await Promise.all([
      db.from('packing_requests').update({
        status: 'PACKING_IN_PROGRESS',
        started_at: startedAt,
      }).eq('id', requestId),
      db.from('packing_audit_logs').insert({
        packing_request_id: requestId,
        action_type: 'PACKING_STARTED',
        performed_by: userId,
        role,
        metadata: {
          movement_number: req_data.movement_number,
          auto_generated: true,
          total_boxes: totalBoxes,
          inner_box_qty: innerBoxQty,
          adjustment_boxes: adjustmentBoxCount,
          adjustment_qty: adjustmentQty,
        },
      }),
    ]);
    if (statusUpdate.error) throw statusUpdate.error;
    if (startedAuditInsert.error) throw startedAuditInsert.error;

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 4: BATCH INSERT boxes with pre-computed UUIDs + packing IDs.
    // Order: adjustment boxes FIRST, then normal inner, then remainder.
    // ══════════════════════════════════════════════════════════════════════
    const boxInserts = generateMixedBoxBatch(
      requestId, userId, innerBoxQty,
      adjustmentBoxCount, adjustmentQty,
      normalFullBoxes, normalRemainder,
    );

    const { data: insertedBoxes, error: insertError } = await db
      .from('packing_boxes')
      .insert(boxInserts)
      .select();
    if (insertError) throw insertError;

    const createdBoxes: GeneratedBox[] = ((insertedBoxes || []) as any[]).map((box: any, idx: number) => ({
      ...box,
      packing_id: boxInserts[idx]?.packing_id || generatePackingId(box.id),
    }));

    console.log('[sg_auto-generate] batchBoxInsert', {
      requestId, total_boxes: totalBoxes, inner_box_qty: innerBoxQty,
      adjustment_boxes: adjustmentBoxCount,
    });

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 5: PACKING ENGINE — in-memory simulation + bulk DB writes.
    //
    // Semantics: for every box, we resolve the same container + pallet
    // routing that processPackingBoxAsContainer would, using the pre-fetched
    // spec / item / openPallets cache instead of re-reading the DB. The
    // sequential dependence is preserved (each iteration sees the updated
    // pallet state) but runs entirely in memory.
    //
    // After the simulation we flush four bulk writes:
    //   1) INSERT pack_containers       (one call, all boxes)
    //   2) UPSERT pack_pallets          (one call — covers NEW pallets
    //                                    and UPDATED pallets together)
    //   3) INSERT pack_pallet_containers (one call, all assignments)
    //   4) INSERT pack_pallet_state_log  (one call, all transitions)
    //
    // If itemId is missing or simulation errors, the box rows from Phase 4
    // still remain, matching the original non-blocking behaviour.
    // ══════════════════════════════════════════════════════════════════════
    try {
      if (!itemId) throw new Error(`No item row for item_code ${req_data.item_code}`);

      const fullContainers = Math.floor(outerBoxQty / innerBoxQty);

      // Mutable simulation state. palletStates holds the final row for every
      // pallet we touch (existing OR newly created). newPalletIds separates
      // them so we can INSERT new vs UPSERT mixed at flush time.
      const palletStates = new Map<string, any>();
      for (const p of openPallets) {
        palletStates.set(p.id, { ...p });
      }
      const newPalletIds = new Set<string>();

      // Active candidate list — same ordering semantics as the DB query
      // (oldest first). When a pallet transitions to READY we drop it from
      // this list (no longer a routing candidate). New pallets we create get
      // appended, preserving creation order.
      const palletCandidates: any[] = openPallets.map((p) => palletStates.get(p.id));

      const containerInserts: any[] = [];
      const palletContainerInserts: any[] = [];
      const stateLogInserts: any[] = [];

      for (const box of createdBoxes) {
        const boxQty = Number(box.box_qty);
        const isAdjustmentBox = boxQty !== innerBoxQty && boxQty === adjustmentQty;

        // Pallet selection (mirror of processPackingBoxAsContainer Step 3)
        let pallet: any | null = null;
        if (isAdjustmentBox) {
          // Adjustment box → prefer ADJUSTMENT_REQUIRED pallet, else first open
          pallet = palletCandidates.find((p) => p.state === 'ADJUSTMENT_REQUIRED') ||
                   palletCandidates[0] || null;
        } else {
          // Inner box → skip ADJUSTMENT_REQUIRED pallets
          pallet = palletCandidates.find((p) => p.state !== 'ADJUSTMENT_REQUIRED') || null;
        }

        if (!pallet) {
          // Create new pallet in memory with pre-generated UUID
          const palletId = generateUUID();
          const palletNumber = generateNumber('PLT');
          pallet = {
            id: palletId,
            pallet_number: palletNumber,
            item_id: itemId,
            item_code: req_data.item_code,
            packing_spec_id: specId,
            target_qty: outerBoxQty,
            current_qty: 0,
            container_count: 0,
            adjustment_container_count: 0,
            state: 'OPEN',
            opened_at: new Date().toISOString(),
            created_by: userId,
          };
          palletStates.set(palletId, pallet);
          newPalletIds.add(palletId);
          palletCandidates.push(pallet);
        }

        // Pre-generated container UUID — avoids a read-after-write INSERT ... RETURNING
        const containerId = generateUUID();
        const containerNumber = generateNumber('CTN');

        containerInserts.push({
          id: containerId,
          container_number: containerNumber,
          movement_header_id: req_data.movement_header_id || null,
          movement_number: req_data.movement_number,
          packing_request_id: requestId,
          packing_box_id: box.id,
          item_id: itemId,
          item_code: req_data.item_code,
          packing_spec_id: specId,
          quantity: boxQty,
          is_adjustment: isAdjustmentBox,
          container_type: isAdjustmentBox ? 'ADJUSTMENT_BOX' : 'INNER_BOX',
          current_warehouse_id: null,
          reference_doc_type: null,
          reference_doc_number: null,
          created_by: userId,
        });

        const nextPosition = (pallet.container_count || 0) + 1;
        palletContainerInserts.push({
          pallet_id: pallet.id,
          container_id: containerId,
          position_sequence: nextPosition,
        });

        // Compute pallet's new state (mirrors processPackingBoxAsContainer Step 5)
        const prevState = pallet.state;
        const qtyBefore = pallet.current_qty || 0;
        const newQty = qtyBefore + boxQty;
        const newContainerCount = (pallet.container_count || 0) + 1;
        const newAdjCount = (pallet.adjustment_container_count || 0) + (isAdjustmentBox ? 1 : 0);

        let newState: string = 'FILLING';
        if (newQty >= outerBoxQty) {
          newState = 'READY';
        } else if (newContainerCount >= fullContainers && adjustmentQty > 0 && newAdjCount === 0) {
          newState = 'ADJUSTMENT_REQUIRED';
        }

        const nowIso = new Date().toISOString();
        pallet.current_qty = newQty;
        pallet.container_count = newContainerCount;
        pallet.adjustment_container_count = newAdjCount;
        pallet.state = newState;
        pallet.updated_at = nowIso;
        if (newState === 'READY' && !pallet.ready_at) pallet.ready_at = nowIso;

        // State transition audit (only if state changed — same as Step 6)
        if (prevState !== newState) {
          stateLogInserts.push({
            pallet_id: pallet.id,
            from_state: prevState,
            to_state: newState,
            trigger_type: 'CONTAINER_ADDED',
            metadata: {
              container_id: containerId,
              container_number: containerNumber,
              box_qty: boxQty,
              pallet_qty_before: qtyBefore,
              pallet_qty_after: newQty,
            },
            performed_by: userId,
          });
        }

        // Once READY, the pallet is no longer a routing candidate
        if (newState === 'READY') {
          const idx = palletCandidates.indexOf(pallet);
          if (idx !== -1) palletCandidates.splice(idx, 1);
        }
      }

      // ── Split pallet rows by INSERT vs UPDATE target ───────────────────
      const newPalletRows: any[] = [];
      const updatedPalletRows: any[] = [];
      for (const [id, p] of palletStates) {
        if (newPalletIds.has(id)) newPalletRows.push(p);
        else updatedPalletRows.push(p);
      }

      // ── Flush 1 (parallel): containers + pallets ─────────────────────
      //   - Containers must be INSERTed before pallet_containers (FK)
      //   - New pallets must be INSERTed before pallet_containers (FK)
      //   - Existing pallet UPDATEs have no FK dependency on container work
      //     but we still pair them here to keep latency to ONE round-trip.
      const flush1: Promise<any>[] = [];
      if (containerInserts.length > 0) {
        flush1.push(
          db.from('pack_containers').insert(containerInserts).then((r: any) => {
            if (r.error) throw new Error('pack_containers INSERT: ' + r.error.message);
          }),
        );
      }
      if (newPalletRows.length > 0) {
        flush1.push(
          db.from('pack_pallets').insert(newPalletRows).then((r: any) => {
            if (r.error) throw new Error('pack_pallets INSERT: ' + r.error.message);
          }),
        );
      }
      // Bulk UPDATE of existing pallets is expressed as upsert on id —
      // PostgREST turns this into one INSERT ... ON CONFLICT UPDATE call.
      if (updatedPalletRows.length > 0) {
        flush1.push(
          db.from('pack_pallets').upsert(updatedPalletRows, { onConflict: 'id' }).then((r: any) => {
            if (r.error) throw new Error('pack_pallets UPSERT: ' + r.error.message);
          }),
        );
      }
      await Promise.all(flush1);

      // ── Flush 2 (parallel): pallet_containers + state_log ───────────
      //   pack_pallet_containers FK-depends on both pack_containers.id and
      //   pack_pallets.id, so it must run AFTER flush 1.
      //   state_log FK-depends on pack_pallets.id — same constraint.
      const flush2: Promise<any>[] = [];
      if (palletContainerInserts.length > 0) {
        flush2.push(
          db.from('pack_pallet_containers').insert(palletContainerInserts).then((r: any) => {
            if (r.error) throw new Error('pack_pallet_containers INSERT: ' + r.error.message);
          }),
        );
      }
      if (stateLogInserts.length > 0) {
        flush2.push(
          db.from('pack_pallet_state_log').insert(stateLogInserts).then((r: any) => {
            if (r.error) throw new Error('pack_pallet_state_log INSERT: ' + r.error.message);
          }),
        );
      }
      await Promise.all(flush2);

      console.log('[sg_auto-generate] phase5Complete', {
        requestId,
        containers: containerInserts.length,
        new_pallets: newPalletRows.length,
        updated_pallets: updatedPalletRows.length,
        state_transitions: stateLogInserts.length,
      });
    } catch (engineErr: any) {
      // Non-blocking: container/pallet failures must not abort box creation,
      // same as the original handler — the box rows are already INSERTed.
      console.error('[sg_auto-generate] batchContainerCreation error', engineErr.message);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Final audit log — BOX_CREATED with auto-generation metadata
    // ══════════════════════════════════════════════════════════════════════
    const { error: boxAuditErr } = await db.from('packing_audit_logs').insert({
      packing_request_id: requestId,
      action_type: 'BOX_CREATED',
      performed_by: userId,
      role,
      metadata: {
        auto_generated: true,
        total_boxes: totalBoxes,
        adjustment_boxes: adjustmentBoxCount,
        inner_box_qty: innerBoxQty,
        adjustment_qty: adjustmentQty,
        total_qty: totalQty,
        movement_number: req_data.movement_number,
      },
    });
    if (boxAuditErr) throw boxAuditErr;

    return new Response(
      JSON.stringify({
        success: true,
        boxes: createdBoxes,
        boxes_count: createdBoxes.length,
        status: 'PACKING_IN_PROGRESS',
        already_generated: false,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[sg_auto-generate] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);
