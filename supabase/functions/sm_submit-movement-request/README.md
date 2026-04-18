# `sm_submit-movement-request`

Creates a stock movement request (header + line) with full server-side validation.

## Purpose

Replaces the client-side `handleSubmit()` flow that previously did direct inserts. All validation, warehouse ID resolution, stock availability checks, and server-side quantity derivation (for PRODUCTION_RECEIPT) happen here atomically.

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
  "itemCode": "FG02116",
  "movementType": "PRODUCTION_RECEIPT",
  "fromLocation": "PRODUCTION",
  "toLocation": "PW",
  "finalQty": 896,
  "boxCount": 2,
  "innerBoxQty": 448,
  "stockType": "STOCK_IN",
  "reasonCode": "PROD_RECV",
  "note": "Production receipt",
  "routeLabel": "Production → FG Warehouse",
  "referenceType": "WORK_ORDER",
  "referenceDocNumber": "AE/WO/D/42"
}
```

## Response

**200 OK**

```json
{
  "movementId": "uuid",
  "movementNumber": "MOV-MO43KPMQ",
  "status": "PENDING"
}
```

## Error Codes

| Code | Reason |
|---|---|
| `400` | Missing/invalid required fields |
| `401` | Missing/invalid JWT |
| `403` | User lacks permission to create movements |
| `409` | Stock availability conflict (insufficient stock for STOCK_OUT) |
| `500` | DB or unexpected error |

## Env Vars Required

| Name | Source |
|---|---|
| `SUPABASE_URL` | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected |
| `PUBLISHABLE_KEY` | Custom secret |

## Deployment

```bash
./supabase.exe functions deploy sm_submit-movement-request \
  --project-ref <project-ref> \
  --no-verify-jwt
```

## Local Test

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/sm_submit-movement-request \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d @payload.json
```

## Dependencies

- `_shared/cors.ts`
- `_shared/palletImpact.ts`
- `@supabase/supabase-js@2`

## Notes

- For `PRODUCTION_RECEIPT`, `finalQty` is re-derived server-side from `boxCount` × spec — the client-provided value is overridden.
- Inserts a supervisor notification after header + line creation.
- Multiple sequential DB writes are currently non-transactional; see roadmap for RPC/transaction migration.
