/**
 * refresh_views_cron — Edge Function
 *
 * Refreshes materialized views (`mv_rack_view`, `mv_bpa_fulfillment_dashboard`)
 * concurrently. Called by:
 *   - Supabase scheduled job (every 5 minutes as safety net)
 *   - Client after a heavy write batch for immediate consistency
 *
 * The DB triggers already emit pg_notify for debounced refresh; this is
 * a fallback that guarantees eventual consistency even if notify delivery
 * is missed.
 *
 * INPUT (JSON):
 *   { views?: string[] }    // default: refresh both
 *
 * OUTPUT:
 *   { success, refreshed: ['mv_rack_view', ...], duration_ms }
 *
 * Role: any authenticated user can trigger (cheap + idempotent).
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody } from '../_shared/schemas.ts';

const KNOWN_VIEWS: Record<string, string> = {
    mv_rack_view:                'refresh_mv_rack_view',
    mv_bpa_fulfillment_dashboard: 'refresh_mv_bpa_dashboard',
};

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const requested = Array.isArray(body.views) && body.views.length > 0
        ? body.views as string[]
        : Object.keys(KNOWN_VIEWS);

    const invalid = requested.filter(v => !KNOWN_VIEWS[v]);
    if (invalid.length > 0) {
        return errorResponse('VALIDATION_FAILED',
            `Unknown view(s): ${invalid.join(', ')}. Allowed: ${Object.keys(KNOWN_VIEWS).join(', ')}`,
            { origin });
    }

    const start = Date.now();
    const refreshed: string[] = [];
    const errors: Array<{view: string; error: string}> = [];

    for (const view of requested) {
        const fn = KNOWN_VIEWS[view];
        const { error } = await ctx.db.rpc(fn);
        if (error) errors.push({ view, error: error.message });
        else refreshed.push(view);
    }

    const duration = Date.now() - start;

    if (errors.length > 0 && refreshed.length === 0) {
        return errorResponse('INTERNAL_ERROR',
            'All view refreshes failed',
            { origin, details: errors });
    }

    return jsonResponse({
        success:     refreshed.length > 0,
        refreshed,
        errors,
        duration_ms: duration,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
