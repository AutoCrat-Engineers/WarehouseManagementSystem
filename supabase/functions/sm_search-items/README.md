# `sm_search-items`

Searches the item master by item code, part number, or MSN.

## Purpose

Server-side item search used by the "New Stock Movement" modal. Supports partial match and returns a capped result set sorted by relevance.

## Module

Stock Movement

## Request

**Method:** `POST`
**Headers:**
- `Authorization: Bearer <jwt>` (required)
- `Content-Type: application/json`

**Body:**

```json
{ "query": "opw-57" }
```

`query` must be at least 2 characters. Shorter queries return an empty result set.

## Response

**200 OK**

```json
{
  "items": [
    {
      "itemCode": "C04179M",
      "partNumber": "FG02116",
      "msn": "OPW-57",
      "description": "Intermediate Body, Machined"
    }
  ]
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
./supabase.exe functions deploy sm_search-items \
  --project-ref <project-ref> \
  --no-verify-jwt
```

## Local Test

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/sm_search-items \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"query":"opw"}'
```

## Dependencies

- `_shared/cors.ts`
- `@supabase/supabase-js@2`

## Notes

- Client debounces input by 300ms before calling this function.
- Returns up to 50 items; tighten `query` for better precision.
