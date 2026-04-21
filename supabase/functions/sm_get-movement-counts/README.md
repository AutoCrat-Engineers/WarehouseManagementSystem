# `sm_get-movement-counts`

Returns summary counts (total / pending / approved / rejected) for the movements dashboard.

## Purpose

Powers the 4 KPI cards at the top of the Stock Movements page.

## Module

Stock Movement

## Request

**Method:** `POST`
**Headers:**
- `Authorization: Bearer <jwt>` (required)
- `Content-Type: application/json`

**Body:** `{}`

## Response

**200 OK**

```json
{
  "total": 570,
  "pending": 19,
  "completed": 522,
  "rejected": 19
}
```

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
./supabase.exe functions deploy sm_get-movement-counts \
  --project-ref <project-ref> \
  --no-verify-jwt
```

## Local Test

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/sm_get-movement-counts \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Dependencies

- `_shared/cors.ts`
- `@supabase/supabase-js@2`

## Notes

- Called in parallel with `sm_get-movements` on page load.
