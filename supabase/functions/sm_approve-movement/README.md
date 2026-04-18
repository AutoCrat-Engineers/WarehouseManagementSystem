# `sm_approve-movement`

Approves or rejects a pending stock movement, deducts/increments stock, and emits audit + notification records.

## Purpose

Supervisor-side action. Performs the point-of-no-return writes for the stock movement workflow: stock deduction, status change, audit log, packing request creation (for PRODUCTION_RECEIPT), operator notification.

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
  "movementId": "9e01dbfc-77bd-470b-9c92-a8a4772318d6",
  "action": "APPROVED",
  "approvedQty": 896,
  "supervisorNote": "Looks good"
}
```

`action` is one of `APPROVED`, `REJECTED`, `PARTIALLY_APPROVED`. For `PARTIALLY_APPROVED`, `approvedQty` must be less than the requested qty.

## Response

**200 OK**

```json
{
  "success": true,
  "movementId": "uuid",
  "status": "COMPLETED",
  "packingRequestId": "uuid-or-null"
}
```

## Error Codes

| Code | Reason |
|---|---|
| `400` | Missing/invalid body fields, or partial-approve rules violated |
| `401` | Missing/invalid JWT |
| `403` | User lacks supervisor role |
| `404` | Movement not found |
| `409` | Movement already approved/rejected (state conflict) or stock race condition |
| `500` | DB or unexpected error |

## Env Vars Required

| Name | Source |
|---|---|
| `SUPABASE_URL` | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected |
| `PUBLISHABLE_KEY` | Custom secret |

## Deployment

```bash
./supabase.exe functions deploy sm_approve-movement \
  --project-ref <project-ref> \
  --no-verify-jwt
```

## Local Test

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/sm_approve-movement \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"movementId":"uuid","action":"APPROVED","approvedQty":896,"supervisorNote":"ok"}'
```

## Dependencies

- `_shared/cors.ts`
- `@supabase/supabase-js@2`

## Notes

- Partial-approval rules enforced server-side (prevents client tampering).
- TOCTOU protection on stock levels via conditional updates where possible.
- Stock adjustment is the LAST write in the sequence to minimize partial-state risk.
- Multiple DB writes happen sequentially without a transaction; see ADR-0002 for roadmap.
