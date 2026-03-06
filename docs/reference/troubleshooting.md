# Troubleshooting Guide

> **Version:** 0.4.1 | **Last Updated:** 2026-03-06

## Authentication Issues

### 401 Unauthorized Error

**Root Cause:** Mismatch between frontend ANON_KEY tokens and backend SERVICE_ROLE_KEY validation.

**Solution:** The backend uses two separate Supabase clients:
- `supabase` (ANON_KEY) — validates user tokens from frontend
- `supabaseAdmin` (SERVICE_ROLE_KEY) — admin operations only

### "Multiple GoTrueClient instances" Warning

**Fix:** Always use the singleton Supabase client:
```typescript
import { getSupabaseClient } from './utils/supabase/client';
const supabase = getSupabaseClient();
```

### Force Logout
```javascript
// Browser console:
const supabase = window.supabase;
await supabase.auth.signOut();
location.reload();
```

---

## Data Issues

### Dashboard Shows Zero Values
1. Load sample data (Dashboard → "Load Sample Data")
2. Run Planning module → click "Run Planning"
3. Return to Dashboard

### Empty Tables After Login
Database has no data. Load sample data from Dashboard.

### Sticker Generation Slow
Run performance indexes migration:
```
supabase/migrations/packing_engine/013_performance_indexes.sql
```

---

## Network Issues

### Network Error
1. Check browser console for detailed error
2. Verify Supabase project ID in `src/utils/supabase/info.tsx`
3. Check Network tab in DevTools

### CORS Issues
Supabase handles CORS automatically. If issues persist, check that the Supabase project URL is correct.

---

## Permissions Issues

### Module Not Visible in Sidebar
1. Check user role: L1 may not have view permission
2. Verify granular permissions: `SELECT * FROM get_effective_permissions('USER_UUID');`
3. Check `module_registry` has the module registered

### Can't Create/Edit/Delete
1. Verify permission: `userPerms['module.action'] === true`
2. Ask L3 admin to grant access via Grant Access Modal
3. Permission cache expires every 60 seconds — wait or hard refresh

---

## Development Issues

### TypeScript Errors (Red Squiggles)
- Restart TypeScript server in IDE
- Run `npm install` if dependencies are missing
- UI components use Vite aliases — `tsc` shows false errors for `@radix-ui@version` imports; `vite build` resolves them

### Build Warnings
- Chunk size warnings are expected for large applications
- Use `npm run build` to verify — should complete with exit code 0

---

## Quick Reset

```javascript
// Browser console — clear everything:
localStorage.clear();
sessionStorage.clear();
location.reload();
```

Then: Login → Load sample data → Run planning

---

## Error Messages

| Error | Code | Meaning | Fix |
|-------|------|---------|-----|
| Unauthorized | 401 | Invalid/missing token | Re-login |
| Not Found | 404 | Resource missing | Check ID |
| Bad Request | 400 | Invalid input | Validate form |
| Internal Server Error | 500 | Backend crash | Check Supabase logs |
| Network Error | 0 | Can't reach server | Check internet |

---

## Security Checklist

| Item | Status |
|------|--------|
| Frontend uses ANON_KEY | ✅ |
| SERVICE_ROLE_KEY never in frontend | ✅ |
| Backend validates tokens with ANON_KEY | ✅ |
| RLS enabled on all tables | ✅ |
| Audit trail for sensitive operations | ✅ |

---

## Debugging Tips

### Browser Console
Structured logs appear as: `[MODULE] { ...json }`
```
[PACKING] {"operation":"autoGenerateBoxes","duration_ms":847,...}
```

### Supabase Dashboard
- **Functions > Logs** — Edge Function execution
- **Table Editor** — Direct data inspection
- **Authentication > Users** — User management

### Check Auth State
```javascript
const { data } = await supabase.auth.getSession();
console.log(data.session);
```

---

## Performance

### Slow Queries
1. Ensure performance indexes are applied (`013_performance_indexes.sql`)
2. Check structured log `duration_ms` for slow operations
3. Verify `Promise.all()` is used for parallel fetches

### Memory Leaks
- Ensure `useEffect` cleanup functions
- Unsubscribe from Supabase real-time listeners
- Use React DevTools Profiler
