/**
 * _shared/schemas.ts — Lightweight input validation for Edge Functions
 *
 * Rationale: we don't pull in `zod` (adds ~100kb bundle + cold-start hit).
 * These are tiny, handwritten validators — enough for the shape + type
 * assertions we need at the edge. Server-side DB constraints are the
 * final authority; this just rejects obvious garbage fast.
 *
 * Usage:
 *   const body = await req.json().catch(() => ({}));
 *   const res = validate(body, {
 *     part_number: 'string',
 *     quantity:    'positive_int',
 *     pallet_ids:  'uuid_array',
 *   });
 *   if (!res.ok) return errorResponse('VALIDATION_FAILED', res.error);
 *   const input = res.value;   // fully typed
 */

export type FieldType =
    | 'string'
    | 'string_optional'
    | 'uuid'
    | 'uuid_optional'
    | 'uuid_array'
    | 'int'
    | 'int_optional'
    | 'positive_int'
    | 'number'
    | 'number_optional'
    | 'date_iso'
    | 'date_iso_optional'
    | 'bool'
    | 'bool_optional'
    | 'jsonb_object'
    | 'jsonb_array';

export interface ValidationResult<T> {
    ok: true;
    value: T;
}
export interface ValidationError {
    ok: false;
    error: string;
    field?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function checkField(value: unknown, type: FieldType): { ok: true } | { ok: false; reason: string } {
    const isNull = value === null || value === undefined;

    if (type.endsWith('_optional') && isNull) return { ok: true };

    switch (type) {
        case 'string':
        case 'string_optional':
            if (typeof value !== 'string' || !value.trim()) return { ok: false, reason: 'must be non-empty string' };
            return { ok: true };

        case 'uuid':
        case 'uuid_optional':
            if (typeof value !== 'string' || !UUID_RE.test(value)) return { ok: false, reason: 'must be UUID' };
            return { ok: true };

        case 'uuid_array':
            if (!Array.isArray(value) || value.length === 0) return { ok: false, reason: 'must be non-empty array' };
            for (const v of value) {
                if (typeof v !== 'string' || !UUID_RE.test(v)) return { ok: false, reason: 'all items must be UUIDs' };
            }
            return { ok: true };

        case 'int':
        case 'int_optional':
            if (typeof value !== 'number' || !Number.isInteger(value)) return { ok: false, reason: 'must be integer' };
            return { ok: true };

        case 'positive_int':
            if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return { ok: false, reason: 'must be positive integer' };
            return { ok: true };

        case 'number':
        case 'number_optional':
            if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'must be finite number' };
            return { ok: true };

        case 'date_iso':
        case 'date_iso_optional':
            if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return { ok: false, reason: 'must be ISO-8601 date' };
            return { ok: true };

        case 'bool':
        case 'bool_optional':
            if (typeof value !== 'boolean') return { ok: false, reason: 'must be boolean' };
            return { ok: true };

        case 'jsonb_object':
            if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, reason: 'must be object' };
            return { ok: true };

        case 'jsonb_array':
            if (!Array.isArray(value)) return { ok: false, reason: 'must be array' };
            return { ok: true };

        default:
            return { ok: false, reason: 'unknown field type' };
    }
}

export function validate<T extends Record<string, unknown>>(
    input: unknown,
    shape: Record<keyof T, FieldType>,
): ValidationResult<T> | ValidationError {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, error: 'Body must be a JSON object' };
    }
    const obj = input as Record<string, unknown>;
    for (const [field, type] of Object.entries(shape) as [string, FieldType][]) {
        const r = checkField(obj[field], type);
        if (!r.ok) return { ok: false, error: `Field '${field}': ${r.reason}`, field };
    }
    return { ok: true, value: obj as T };
}

/** Safe JSON parse — returns empty object on parse error. */
export async function parseBody(req: Request): Promise<Record<string, unknown>> {
    try {
        return await req.json() as Record<string, unknown>;
    } catch {
        return {};
    }
}

/** Parse query-string into a plain object with common coercions. */
export function parseQuery(url: string): Record<string, string> {
    const out: Record<string, string> = {};
    const u = new URL(url);
    for (const [k, v] of u.searchParams) out[k] = v;
    return out;
}
