# `sm_get-item-stock`

Returns per-warehouse stock levels for a given item.

## Purpose

Powers the warehouse route selector on the New Stock Movement form, showing live available quantity across all warehouses.

## Module

Stock Movement

## Request

**Method:** `POST`
**Headers:**
- `Authorization: Bearer <jwt>` (required)
- `Content-Type: application/json`

**Body:**

```json
{ "itemCode": "FG02116" }
```

## Response

**200 OK**

```json
{
  "stocks": [
    { "warehouseCode": "PW", "warehouseName": "FG Warehouse", "quantity": 5400 },
    { "warehouseCode": "IT", "warehouseName": "In-Transit", "quantity": 0 }
  ]
}
```

## Error Codes

| Code | Reason |
|---|---|
| `400` | `itemCode` missing in body |
| `401` | Missing/invalid JWT |
| `404` | Item not found |
| `500` | DB or unexpected error |

## Env Vars Required

| Name | Source |
|---|---|
| `SUPABASE_URL` | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected |
| `PUBLISHABLE_KEY` | Custom secret |

## Deployment

```bash
./supabase.exe functions deploy sm_get-item-stock \
  --project-ref <project-ref> \
  --no-verify-jwt
```

## Local Test

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/sm_get-item-stock \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"itemCode":"FG02116"}'
```

## Dependencies

- `_shared/cors.ts`
- `@supabase/supabase-js@2`
