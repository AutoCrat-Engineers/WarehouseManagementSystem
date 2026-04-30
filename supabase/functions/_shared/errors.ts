/**
 * _shared/errors.ts — Typed error helpers for Edge Functions
 *
 * Provides:
 *   - Stable error codes (client can branch on them)
 *   - Single `jsonResponse`/`errorResponse` helpers with CORS
 *   - Mapping from Postgres SQLSTATE to friendly errors
 *
 * All Edge Functions MUST return JSON; never HTML.
 */
import { getCorsHeaders } from './cors.ts';

export type ErrorCode =
    | 'MISSING_AUTH'
    | 'INVALID_TOKEN'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'VALIDATION_FAILED'
    | 'CONFLICT'              // unique violation, state conflict
    | 'CONCURRENT_MODIFICATION'
    | 'OVER_RELEASE'
    | 'INVALID_STATE_TRANSITION'
    | 'RATE_LIMITED'
    | 'INTERNAL_ERROR';

export interface ErrorBody {
    error: {
        code:    ErrorCode;
        message: string;
        details?: unknown;
    };
}

/** Standard success JSON response (200). */
export function jsonResponse(
    body: unknown,
    init: { status?: number; origin?: string } = {},
): Response {
    const { status = 200, origin } = init;
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...getCorsHeaders(origin),
            'Content-Type': 'application/json',
        },
    });
}

/** Standard error JSON response with stable code. */
export function errorResponse(
    code: ErrorCode,
    message: string,
    init: { status?: number; origin?: string; details?: unknown } = {},
): Response {
    const defaultStatus: Record<ErrorCode, number> = {
        MISSING_AUTH:             401,
        INVALID_TOKEN:            401,
        FORBIDDEN:                403,
        NOT_FOUND:                404,
        VALIDATION_FAILED:        400,
        CONFLICT:                 409,
        CONCURRENT_MODIFICATION:  409,
        OVER_RELEASE:             422,
        INVALID_STATE_TRANSITION: 422,
        RATE_LIMITED:             429,
        INTERNAL_ERROR:           500,
    };
    const { status = defaultStatus[code], origin, details } = init;
    const body: ErrorBody = { error: { code, message } };
    if (details !== undefined) body.error.details = details;
    return jsonResponse(body, { status, origin });
}

/** Common 401s. */
export function unauthorized(origin?: string) {
    return errorResponse('MISSING_AUTH', 'Authorization header missing or invalid.', { origin });
}
export function forbidden(origin?: string, message = 'Access denied.') {
    return errorResponse('FORBIDDEN', message, { origin });
}

/**
 * Map a Postgres error (from supabase-js) to an ErrorCode + user message.
 * Used after calling an RPC so clients get consistent, typed errors.
 */
export function mapPgError(err: { code?: string; message?: string }): {
    code: ErrorCode;
    message: string;
} {
    const msg = err.message || 'Database error';
    switch (err.code) {
        case '22023':  return { code: 'INVALID_STATE_TRANSITION', message: msg };
        case '23505':  return { code: 'CONFLICT',                 message: msg };
        case '23514':
            return msg.toLowerCase().includes('over-release')
                ? { code: 'OVER_RELEASE',     message: msg }
                : { code: 'VALIDATION_FAILED', message: msg };
        case '23503':  return { code: 'VALIDATION_FAILED',        message: 'Referenced record does not exist: ' + msg };
        case 'P0001':  return { code: 'NOT_FOUND',                message: msg };
        case 'P0002':  return { code: 'CONCURRENT_MODIFICATION',  message: msg };
        default:       return { code: 'INTERNAL_ERROR',           message: msg };
    }
}

/** Wrap an edge function handler and convert uncaught errors to 500 JSON. */
export function withErrorHandler(
    handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
    return async (req) => {
        const origin = req.headers.get('origin') ?? undefined;
        if (req.method === 'OPTIONS') {
            return new Response('ok', { headers: getCorsHeaders(origin) });
        }
        try {
            return await handler(req);
        } catch (e: unknown) {
            const err = e as { message?: string; code?: string; stack?: string };
            console.error('[edge]', err?.stack ?? err?.message ?? e);
            if (err?.code && /^[0-9A-Z]{5}$/.test(err.code)) {
                const mapped = mapPgError(err);
                return errorResponse(mapped.code, mapped.message, { origin });
            }
            return errorResponse('INTERNAL_ERROR', err?.message ?? 'Internal server error', { origin });
        }
    };
}
