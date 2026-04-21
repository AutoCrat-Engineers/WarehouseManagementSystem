# `sm_get-reason-codes`

Returns reason code master data — either the full active list or a single record by code.

## Purpose

Replaces two direct DB calls on the client:
1. `fetchReasonCodes()` — loads all active reason codes on form mount
2. `handleOpenReview()` fallback — looks up a single reason code by value

## Module

Stock Movement

## Request

**Method:** `POST`
**Headers:**
- `Authorization: Bearer <jwt>` (required)
- `Content-Type: application/json`

**Body (all active):** `{}`

**Body (single lookup):**

```json
{ "reasonCode": "PROD_IN" }
```

## Response

**200 OK (all active):**

```json
{
  "reasonCodes": [
    { "id": "uuid", "reason_code": "PROD_IN", "category": "RECEIPT", "description": "Production Receipt" }
  ]
}
```

**200 OK (single lookup):**

```json
{
  "reasonCode": { "id": "uuid", "reason_code": "PROD_IN", "category": "RECEIPT", "description": "Production Receipt" }
}
```

`reasonCode` is `null` if no match.

## Error Codes

| Code | Reason |
|---|---|
| `401` | Missing/invalid JWT |
| `500` | DB or unexpected error |

## Env Vars Required

| Name | Source |
|---|---|
| `SUPABASE_URL` | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected |
| `PUBLISHABLE_KEY` | Custom secret |

## Deployment

```bash
./supabase.exe functions deploy sm_get-reason-codes \
  --project-ref <project-ref> \
  --no-verify-jwt
```

## Local Test

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/sm_get-reason-codes \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Dependencies

- `_shared/cors.ts`
- `@supabase/supabase-js@2`
