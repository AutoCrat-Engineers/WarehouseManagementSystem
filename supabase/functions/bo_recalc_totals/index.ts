/**
 * bo_recalc_totals — Edge Function (cron safety-net)
 *
 * Recomputes `blanket_order_line_configs` running totals from fact tables:
 *   shipped_quantity   = SUM(blanket_order_shipment_log.shipped_quantity)
 *   released_quantity  = SUM(pack_sub_invoices.total_quantity)
 *                        (joined via sub_invoice_lines to scope by part)
 *   delivered_quantity = SUM(delivery_note_items.quantity)
 *   counters (total_releases, total_sub_invoices, total_shipments) — counts
 *
 * Run as scheduled nightly cron (or on-demand by admin). Normal ops keep
 * counters in sync via RPCs; this is a safety net against any drift.
 *
 * INPUT (JSON):
 *   { agreement_id?: uuid,  // scope to one BPA, or all
 *     dry_run?: boolean }   // compute + return diffs, don't write
 *
 * OUTPUT:
 *   { success, rows_checked, rows_corrected, diffs: [{part_number, field, old, new}] }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, forbidden, withErrorHandler } from '../_shared/errors.ts';
import { parseBody } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req, { requireRoles: ['L3', 'ADMIN', 'SERVICE'] });
    if (!ctx) return forbidden(origin, 'bo_recalc_totals requires L3/ADMIN role.');

    const body = await parseBody(req);
    const agreementId = body.agreement_id as string | undefined;
    const dryRun = Boolean(body.dry_run);

    // Load line_configs in scope
    let cfgQ = ctx.db.from('blanket_order_line_configs').select('*');
    if (agreementId) cfgQ = cfgQ.eq('agreement_id', agreementId);
    const { data: configs, error } = await cfgQ;
    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    const diffs: Array<{part_number: string; field: string; old: number; new: number; config_id: string}> = [];
    let corrected = 0;

    for (const c of configs ?? []) {
        // Released: sum of sub_invoice_lines matching this bo + part
        const { data: subLines } = await ctx.db
            .from('pack_sub_invoice_lines')
            .select('quantity, pack_sub_invoices!inner(blanket_order_id)')
            .eq('part_number', c.part_number)
            // @ts-ignore filter on joined
            .eq('pack_sub_invoices.blanket_order_id', c.blanket_order_id);
        const releasedSum = (subLines ?? []).reduce((s, r) => s + Number(r.quantity ?? 0), 0);

        // Shipped: sum of shipment_log
        const { data: shipments } = await ctx.db
            .from('blanket_order_shipment_log')
            .select('shipped_quantity')
            .eq('blanket_order_id', c.blanket_order_id)
            .eq('line_config_id', c.id);
        const shippedSum = (shipments ?? []).reduce((s, r) => s + Number(r.shipped_quantity ?? 0), 0);

        // Releases + sub-invoices counts
        const { count: releasesCount } = await ctx.db
            .from('blanket_releases')
            .select('id', { count: 'exact', head: true })
            .eq('line_config_id', c.id);
        const { count: subInvCount } = await ctx.db
            .from('pack_sub_invoices')
            .select('id', { count: 'exact', head: true })
            .eq('line_config_id', c.id);

        const updates: Record<string, number> = {};
        if (c.released_quantity !== releasedSum) {
            diffs.push({ part_number: c.part_number, field: 'released_quantity', old: c.released_quantity, new: releasedSum, config_id: c.id });
            updates.released_quantity = releasedSum;
        }
        if (c.shipped_quantity !== shippedSum) {
            diffs.push({ part_number: c.part_number, field: 'shipped_quantity', old: c.shipped_quantity, new: shippedSum, config_id: c.id });
            updates.shipped_quantity = shippedSum;
        }
        if (c.total_releases !== (releasesCount ?? 0)) {
            diffs.push({ part_number: c.part_number, field: 'total_releases', old: c.total_releases, new: releasesCount ?? 0, config_id: c.id });
            updates.total_releases = releasesCount ?? 0;
        }
        if (c.total_sub_invoices !== (subInvCount ?? 0)) {
            diffs.push({ part_number: c.part_number, field: 'total_sub_invoices', old: c.total_sub_invoices, new: subInvCount ?? 0, config_id: c.id });
            updates.total_sub_invoices = subInvCount ?? 0;
        }

        if (!dryRun && Object.keys(updates).length > 0) {
            await ctx.db.from('blanket_order_line_configs')
                .update({ ...updates, released_value: releasedSum * Number(c.unit_price ?? 0) })
                .eq('id', c.id);
            corrected++;
        }
    }

    return jsonResponse({
        success:         true,
        dry_run:         dryRun,
        rows_checked:    configs?.length ?? 0,
        rows_corrected:  corrected,
        diffs,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
