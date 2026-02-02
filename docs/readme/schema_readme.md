# Schema & Item Master (Direct DB)

## Current DB schema

- `src/schema/current-database-schema.sql` – reference for `public.items` and `public.inventory` (context only, not to run as-is).

## Item Master without auth errors (direct Supabase)

Data was failing with an auth error when using the Edge Function. This repo adds a path that **skips the Edge Function** and talks to **Supabase (public.items) directly** with the user’s session:

1. **`src/utils/api/itemsSupabase.ts`** – CRUD for `public.items` using `getSupabaseClient()`. Uses the current Supabase session; no Edge Function, so no function auth errors.
2. **`src/components/ItemMasterSupabase.tsx`** – Item Master UI that uses the above client (search, table, create/edit/delete).

### How to use it in the app

In `App.tsx`, for the view that shows Item Master, render `ItemMasterSupabase` instead of `ItemMaster`:

```tsx
import { ItemMasterSupabase } from './components/ItemMasterSupabase';

// Where you currently have:
// return <ItemMaster accessToken={accessToken} />;

// Use:
return <ItemMasterSupabase />;
```

`ItemMasterSupabase` does not need `accessToken`; it relies on the Supabase client session (user must be signed in).

### RLS (Row Level Security)

For direct Supabase access to work, `public.items` must allow the signed-in user to read/write. If you see “permission” or policy errors:

1. In Supabase Dashboard → **Table Editor** → **items** → enable **RLS**.
2. Add policies, for example:
   - **SELECT**: `auth.role() = 'authenticated'` (or your role).
   - **INSERT / UPDATE / DELETE**: same condition if authenticated users can manage items.

If RLS is not set up, Supabase may reject the request and you’ll get a permission error instead of data.
