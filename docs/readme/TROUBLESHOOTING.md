# 🔧 Troubleshooting Guide

## 401 Unauthorized Error - FIXED ✅

### Problem
Dashboard and other modules were returning `APIError: HTTP 401: Unauthorized`

### Root Cause
The backend was using **SUPABASE_SERVICE_ROLE_KEY** for both:
1. Admin operations (creating users)
2. Validating user access tokens

This caused authentication to fail because user tokens from the frontend (created with ANON_KEY) couldn't be validated against the SERVICE_ROLE_KEY.

### Solution Implemented
Created **two separate Supabase clients** in the backend:

```typescript
// Admin client for server operations (creating users, etc.)
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Client for validating user tokens from frontend
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!
);
```

### What Changed
1. ✅ Backend now uses `supabase` (with ANON_KEY) to validate user tokens
2. ✅ Backend uses `supabaseAdmin` (with SERVICE_ROLE_KEY) for admin operations
3. ✅ Added detailed logging in `getUserFromToken` function
4. ✅ API client logs requests and authorization status

---

## Common Issues & Solutions

### 1. "Multiple GoTrueClient instances" Warning

**Symptom:** Console warning about multiple Supabase auth clients

**Solution:** Use the singleton Supabase client
```typescript
import { getSupabaseClient } from './utils/supabase/client';
const supabase = getSupabaseClient();
```

**Don't do:**
```typescript
// ❌ Creates multiple instances
const supabase = createClient(...);
```

---

### 2. Dashboard Shows Zero Values

**Symptom:** Dashboard displays all zeros even after loading sample data

**Cause:** No planning data generated yet

**Solution:**
1. Load sample data first
2. Navigate to "Planning" module
3. Click "Run Planning" button
4. Return to Dashboard

Or wait for automatic planning generation if implemented.

---

### 3. Network Error

**Symptom:** `Network error: Please check your connection`

**Possible Causes:**
- Backend function not deployed
- Invalid Supabase project ID
- CORS issues
- Internet connection problem

**Debug Steps:**
1. Check browser console for detailed error
2. Verify Supabase project ID in `/utils/supabase/info.tsx`
3. Test backend health endpoint manually:
   ```
   https://{projectId}.supabase.co/functions/v1/make-server-9c637d11/health
   ```
4. Check network tab in browser DevTools

---

### 4. TypeScript Errors

**Symptom:** Red squiggly lines in IDE

**Solution:**
- Ensure all types are imported from `/types/index.ts`
- Restart TypeScript server in IDE
- Run `npm install` if dependencies are missing

---

### 5. Empty Data After Login

**Symptom:** All modules show empty tables

**Cause:** Fresh database with no data

**Solution:**
1. Go to Dashboard
2. Click "🚀 Load Sample Data Now"
3. Wait for success message
4. Page will auto-reload with data

---

### 6. Planning Module Shows Empty

**Symptom:** Planning module has no recommendations

**Cause:** Planning hasn't been generated

**Solution:**
1. Ensure items and inventory exist
2. Click "Run Planning" button
3. System will analyze all items and generate recommendations

---

### 7. Forecast Generation Fails

**Symptom:** Error when generating forecasts

**Possible Causes:**
- No historical release data
- Invalid item selected
- Backend error

**Solution:**
1. Ensure sample data is loaded (includes historical releases)
2. Check browser console for detailed error
3. Verify item has associated blanket orders and releases

---

## Debugging Tips

### Enable Verbose Logging

The API client now logs all requests:
```
API Request: GET /dashboard
Authorization header present
API Success: GET /dashboard
```

Check browser console for these logs.

### Backend Logs

Backend logs to Supabase Functions logs:
- Authentication attempts
- Token validation
- Data fetching operations
- Errors with stack traces

Access via Supabase Dashboard > Functions > Logs

### Check Auth State

In browser console:
```javascript
const supabase = window.supabase;
const { data } = await supabase.auth.getSession();
console.log(data.session);
```

Should show:
- `access_token`: Present
- `user`: User object with ID and email

### Test Backend Directly

Use browser DevTools or Postman:

```bash
# Health check (no auth required)
GET https://{projectId}.supabase.co/functions/v1/make-server-9c637d11/health

# Dashboard (requires auth)
GET https://{projectId}.supabase.co/functions/v1/make-server-9c637d11/dashboard
Headers: 
  Authorization: Bearer {access_token}
  Content-Type: application/json
```

---

## Error Messages Reference

| Error | HTTP Code | Meaning | Solution |
|-------|-----------|---------|----------|
| Unauthorized | 401 | Invalid or missing token | Re-login |
| Not Found | 404 | Resource doesn't exist | Check item ID |
| Bad Request | 400 | Invalid input data | Validate form data |
| Internal Server Error | 500 | Backend crash | Check logs |
| Network Error | 0 | Can't reach server | Check internet |

---

## Performance Issues

### Slow Dashboard Load

**Causes:**
- Large amount of data in KV store
- Complex planning calculations
- Many API calls

**Solutions:**
- Implement pagination
- Add caching layer
- Use React Query for data caching
- Optimize backend queries

### Memory Leaks

**Symptoms:**
- Browser becomes slow over time
- Tab crashes

**Solutions:**
- Ensure useEffect cleanup functions
- Unsubscribe from listeners
- Clear intervals/timeouts
- Use React DevTools Profiler

---

## Security Checklist

✅ **Correct:**
- Frontend uses ANON_KEY
- Backend validates tokens with ANON_KEY
- Backend uses SERVICE_ROLE_KEY for admin ops only
- SERVICE_ROLE_KEY never exposed to frontend

❌ **Incorrect:**
- SERVICE_ROLE_KEY in frontend code
- Access tokens in localStorage (use Supabase auth)
- No authentication on endpoints
- Returning sensitive data without auth check

---

## Still Having Issues?

1. **Clear Browser Cache**
   - Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
   - Clear all site data in DevTools > Application > Storage

2. **Check Supabase Status**
   - Visit status.supabase.com
   - Check project quotas in Supabase Dashboard

3. **Verify Environment Variables**
   - Supabase Dashboard > Settings > API
   - Ensure SUPABASE_URL and SUPABASE_ANON_KEY are correct

4. **Review Console Logs**
   - Browser Console (F12)
   - Supabase Functions Logs
   - Network tab for failed requests

5. **Test in Incognito Mode**
   - Rules out extension conflicts
   - Fresh auth state

---

## Quick Fixes

### Clear Everything and Start Fresh

```javascript
// In browser console:
localStorage.clear();
sessionStorage.clear();
location.reload();
```

Then:
1. Login again
2. Load sample data
3. Run planning

### Force Logout and Login

```javascript
// In browser console:
const supabase = window.supabase;
await supabase.auth.signOut();
location.reload();
```

---

## Contact Support

If issues persist:
1. Collect error messages from console
2. Note steps to reproduce
3. Check ARCHITECTURE.md for system design
4. Review code in relevant module

**Last Updated:** January 2026
