# `sm_get-movement-review-data`

Returns packing specification and box breakdown data needed for movement review / approval.

## Purpose

Used by the supervisor review panel to show proposed box breakdown (inner boxes × qty) before a PRODUCTION_RECEIPT is approved. Also used when the item is first selected in the form to prefill spec-aware defaults.

## Module

Stock Movement

## Request

**Method:** `POST`
**Headers:**
- `Authorization: Bearer <jwt>` (required)
- `Content-Type: application/json`

**Body:**

```json
{ "itemCode": "FG02116", "reqQty": 896 }
```

`reqQty` is optional; when provided the server computes suggested box counts.

## Response

**200 OK**

```json
{
  "packingSpec": {
    "innerBoxQty": 448,
    "outerBoxQty": 1792,
    "palletQty": 7168
  },
  "boxBreakdown": {
    "innerBoxes": 2,
    "totalQty": 896
  }
}
```

Fields are `null` if the item has no packing spec.

## Error Codes

| Code | Reason |
|---|---|
| `400` | `itemCode` missing |
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
./supabase.exe functions deploy sm_get-movement-review-data \
  --project-ref <project-ref> \
  --no-verify-jwt
```

## Local Test

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/sm_get-movement-review-data \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"itemCode":"FG02116","reqQty":896}'
```

## Dependencies

- `_shared/cors.ts`
- `@supabase/supabase-js@2`

## Notes

- Box breakdown math mirrors the client-side formula that was deprecated; business logic unchanged.
