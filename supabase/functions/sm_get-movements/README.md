# `sm_get-movements`

Returns a paged, filtered list of stock movements with full server-side enrichment.

## Purpose

Replaces 4-5 separate direct `supabase.from(...)` calls that previously ran from the browser. Now a single authenticated POST runs all queries with the service role key, joins across headers + lines + reason codes + warehouses, parses box breakdowns, and applies status corrections (COMPLETED vs PARTIALLY_APPROVED).

## Module

Stock Movement

## Request

**Method:** `POST`
**Headers:**
- `Authorization: Bearer <jwt>` (required)
- `Content-Type: application/json`

**Body:**

```json
{
  "offset": 0,
  "pageSize": 20,
  "filters": {
    "status": "ALL",
    "movementType": "ALL",
    "stockType": "ALL",
    "dateFrom": "",
    "dateTo": "",
    "search": ""
  }
}
```

All filter values accept `"ALL"` to disable that filter. `search` matches item code / part number / MSN substring (server-side).

## Response

**200 OK**

```json
{
  "movements": [
    {
      "id": "uuid",
      "movementNumber": "MOV-MO43KPMQ",
      "movementType": "PRODUCTION_RECEIPT",
      "stockType": "STOCK_IN",
      "status": "COMPLETED",
      "itemCode": "C04179M",
      "msn": "OPW-57",
      "requestedQty": 896,
      "approvedQty": 896,
      "fromLabel": "Production",
      "toLabel": "FG Warehouse",
      "createdAt": "2026-04-18T07:00:00Z",
      "boxBreakdown": { "innerBoxes": 2, "innerBoxQty": 448 }
    }
  ],
  "totalCount": 570
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
./supabase.exe functions deploy sm_get-movements \
  --project-ref <project-ref> \
  --no-verify-jwt
```

## Local Test

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/sm_get-movements \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"offset":0,"pageSize":20,"filters":{"status":"ALL","movementType":"ALL","stockType":"ALL","dateFrom":"","dateTo":"","search":""}}'
```

## Dependencies

- `_shared/cors.ts`
- `@supabase/supabase-js@2`

## Notes

- Default response time ~400ms. Cold start can push first call to ~1s.
- Box breakdown is parsed server-side from the notes field using regex patterns.
