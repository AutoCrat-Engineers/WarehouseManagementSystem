# `sm_calculate-pallet-impact`

Computes the pallet intelligence preview for a PRODUCTION_RECEIPT entry.

## Purpose

Given an item + box count, this function calculates:
- How many pallets the incoming quantity will fill
- Whether an existing partial pallet will be topped up
- Whether a stock adjustment is required first (to balance a partial pallet count)

The result drives a warning/info banner on the movement form and blocks submission when adjustment acknowledgment is required.

## Module

Stock Movement

## Request

**Method:** `POST`
**Headers:**
- `Authorization: Bearer <jwt>` (required)
- `Content-Type: application/json`

**Body:**

```json
{ "itemCode": "FG02116", "boxCount": 2 }
```

## Response

**200 OK**

```json
{
  "adjustedTotalQty": 896,
  "adjustmentBoxIncluded": false,
  "mustCreateAdjustmentFirst": false,
  "currentPallets": 3,
  "palletsAfter": 3,
  "message": "Will top up pallet PLT-0003"
}
```

## Error Codes

| Code | Reason |
|---|---|
| `400` | `itemCode` or `boxCount` missing/invalid |
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
./supabase.exe functions deploy sm_calculate-pallet-impact \
  --project-ref <project-ref> \
  --no-verify-jwt
```

## Local Test

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/sm_calculate-pallet-impact \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"itemCode":"FG02116","boxCount":2}'
```

## Dependencies

- `_shared/cors.ts`
- `_shared/palletImpact.ts` (core algorithm, shared with `sm_submit-movement-request`)
- `@supabase/supabase-js@2`

## Notes

- Client debounces this call while the user types box count (see `StockMovement.tsx`).
- The algorithm lives in `_shared/palletImpact.ts` so the submit function can re-run the exact same calculation for final quantity derivation.
