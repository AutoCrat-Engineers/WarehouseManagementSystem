/**
 * sessionService.ts — Frontend client for session Edge Functions.
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ARCHITECTURE RULE: Frontend NEVER writes to DB directly.   ║
 * ║  All session writes go through the session-manager Edge Fn. ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * This service provides a typed client for the session-manager
 * Edge Function. It handles:
 *   - Auth token forwarding
 *   - Structured error parsing
 *   - Type-safe request/response contracts
 */

import { getSupabaseClient } from '../utils/supabase/client';
import { projectId } from '../utils/supabase/info';

// ============================================================================
// TYPES
// ============================================================================

export type SessionType =
    | 'dispatch_selection'
    | 'packing_list_wizard'
    | 'stock_movement_form'
    | 'contract_config'
    | 'item_edit';

export type SessionStatus = 'draft' | 'in_progress' | 'completed' | 'abandoned';

// ── Error types returned by the Edge Function ──

export type SessionErrorCode =
    | 'VERSION_CONFLICT'
    | 'SESSION_NOT_FOUND'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'SESSION_EXPIRED'
    | 'SESSION_CLOSED'
    | 'INVALID_INPUT'
    | 'INTERNAL_ERROR';

export class SessionApiError extends Error {
    constructor(
        public code: SessionErrorCode,
        message: string,
        public httpStatus: number,
        public details?: Record<string, any>
    ) {
        super(message);
        this.name = 'SessionApiError';
    }

    /** True if this is a version conflict that can be resolved by re-fetching */
    get isConflict(): boolean {
        return this.code === 'VERSION_CONFLICT';
    }

    /** Server-side data available for reconciliation (only on VERSION_CONFLICT) */
    get serverVersion(): number | null {
        return this.details?.server_version ?? null;
    }

    get serverData(): Record<string, any> | null {
        return this.details?.server_data ?? null;
    }
}

// ============================================================================
// INTERNALS — Edge Function HTTP client
// ============================================================================

const EDGE_FN_NAME = 'session-manager';

/** Get the Supabase Edge Function URL */
function getEdgeFnUrl(): string {
    return `https://${projectId}.supabase.co/functions/v1/${EDGE_FN_NAME}`;
}

/** Get the current auth token */
async function getAuthToken(): Promise<string> {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new SessionApiError('UNAUTHORIZED', 'Not authenticated', 401);
    return session.access_token;
}

/** Make an authenticated request to the Edge Function */
async function edgeFetch<T = any>(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, any>,
    params?: Record<string, string>
): Promise<T> {
    const token = await getAuthToken();
    const baseUrl = getEdgeFnUrl();

    let url = `${baseUrl}${path}`;
    if (params) {
        const qs = new URLSearchParams(params).toString();
        url += `?${qs}`;
    }

    const init: RequestInit = {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    };

    if (body && method === 'POST') {
        init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    const json = await res.json();

    if (!res.ok || json.error) {
        throw new SessionApiError(
            json.error || 'INTERNAL_ERROR',
            json.message || 'Unknown error',
            res.status,
            json.details
        );
    }

    return json as T;
}

// ============================================================================
// PUBLIC API — All calls go through Edge Functions
// ============================================================================

/**
 * Create a new session or resume an existing one.
 * Idempotent — safe to call multiple times for the same workflow.
 *
 * @returns Session data including session_id and current version
 */
export async function createOrResumeSession(
    sessionType: SessionType,
    entityId?: string,
    entityType?: string,
    initialData: Record<string, any> = {}
): Promise<{
    session_id: string;
    version: number;
    session_data: Record<string, any>;
    status: string;
    is_new: boolean;
}> {
    return edgeFetch('/create', 'POST', {
        session_type: sessionType,
        entity_id: entityId,
        entity_type: entityType,
        initial_data: initialData,
    });
}

/**
 * PATCH session data with optimistic concurrency control.
 *
 * The patch is deep-merged into existing session_data on the server.
 * Only send the fields that changed — not the full state.
 *
 * @param sessionId - Session ID
 * @param patch     - Partial state update (only changed fields)
 * @param version   - Current client version (must match server)
 *
 * @throws SessionApiError with code='VERSION_CONFLICT' if version mismatch.
 *         The error contains serverVersion and serverData for reconciliation.
 */
export async function updateSession(
    sessionId: string,
    patch: Record<string, any>,
    version: number
): Promise<{
    session_id: string;
    version: number;
    session_data: Record<string, any>;
}> {
    return edgeFetch('/update', 'POST', {
        session_id: sessionId,
        patch,
        version,
    });
}

/**
 * Mark a session as completed. No further updates allowed.
 */
export async function completeSession(sessionId: string): Promise<void> {
    await edgeFetch('/complete', 'POST', { session_id: sessionId });
}

/**
 * Mark a session as abandoned (user discards work).
 */
export async function abandonSession(sessionId: string): Promise<void> {
    await edgeFetch('/abandon', 'POST', { session_id: sessionId });
}
