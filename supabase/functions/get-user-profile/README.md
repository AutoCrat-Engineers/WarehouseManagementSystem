# `get-user-profile`

Fetches the authenticated user's profile record from the `profiles` table.

## Purpose

Replaces the client-side `fetchCurrentUser()` that previously used `supabase.auth.getSession()` + `supabase.from('profiles').select()` directly. Now JWT is validated server-side and the profile is fetched with the service role key.

## Module

Shared / cross-module utility. Consumed by the Stock Movement UI (and eligible for others).

## Request

**Method:** `POST`
**Headers:**
- `Authorization: Bearer <jwt>` (required)
- `Content-Type: application/json`

**Body:** `{}`  *(no parameters needed — uses `user.id` from the JWT)*

## Response

**200 OK**

```json
{ "fullName": "Shashanth" }
```

`fullName` is `null` if the profile row has no `full_name` set.

## Error Codes

| Code | Reason |
|---|---|
| `401` | Missing or invalid `Authorization` header, or JWT failed validation |
| `500` | Internal error (DB failure, unexpected exception) |

## Env Vars Required

| Name | Source |
|---|---|
| `SUPABASE_URL` | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected |
| `PUBLISHABLE_KEY` | Custom secret |

## Deployment

```bash
./supabase.exe functions deploy get-user-profile \
  --project-ref <project-ref> \
  --no-verify-jwt
```

## Local Test

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/get-user-profile \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Dependencies

- `_shared/cors.ts`
- `@supabase/supabase-js@2` (via esm.sh)
