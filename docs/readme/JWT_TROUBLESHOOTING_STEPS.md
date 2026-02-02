# 🔍 JWT Authentication Troubleshooting Steps

## Current Situation

You're seeing:
```
API Error: Invalid JWT {
  "code": 401,
  "message": "Invalid JWT"
}
```

## ✅ What We've Implemented

1. **AuthDebugPanel** - Shows real-time auth status (bottom-right corner)
2. **Enhanced API Client** - Auto-refreshes tokens on 401 errors
3. **Token Refresh** - Automatic every 45 minutes
4. **Better Logging** - Console shows detailed auth flow

## 🔧 Step-by-Step Diagnosis

### Step 1: Check the Debug Panel (Bottom-Right)

The **Auth Debug Panel** shows:
- ✅ **Session Active** or ❌ **No Session**
- User email
- Token expiry time
- Token preview (first 50 chars)
- Test API button

**Actions:**
1. Look at the debug panel
2. Click **"Test API"** button
3. Check the result

**Expected Results:**
- ✅ Session should be active
- ✅ Test API should pass
- ✅ Token should have a future expiry date

**If Session is Active but API fails:**
- The backend might not be deployed
- The backend might be using wrong environment variables
- Network issue between frontend and backend

### Step 2: Check Browser Console

Open DevTools Console (F12) and look for:

**Good Signs:**
```
✅ Checking for existing session...
✅ Valid session found, user: user@example.com
✅ Retrieved token from session: eyJhbGciOiJIUzI1NiIsInR5cC...
✅ API Request: GET /dashboard
✅ API Response: 200 OK
✅ API Success: GET /dashboard
```

**Bad Signs:**
```
❌ No active session found
❌ Error getting session
❌ API Response: 401 Unauthorized
❌ Received 401 Unauthorized, attempting token refresh...
❌ Token refresh failed
```

### Step 3: Test the Backend Directly

Click the **"Test API"** button in the debug panel. This tests:
```
GET https://sugvmurszfcneaeyoagv.supabase.co/functions/v1/make-server-9c637d11/health
```

**If this fails:**
1. Backend edge function might not be deployed
2. Backend might have errors
3. CORS issues

### Step 4: Click "Refresh Token"

In the debug panel, click **"Refresh Token"** button.

**Expected:**
- Token updates
- New expiry time shown
- Test API passes

**If refresh fails:**
- Session is truly expired (user needs to re-login)
- Supabase auth service issue
- Network connectivity issue

### Step 5: Force Re-Login

If nothing works:
1. Click **Logout** button
2. Clear browser data (optional)
3. Login again
4. Check if errors persist

## 🐛 Common Issues & Solutions

### Issue 1: "Invalid JWT" immediately after login

**Cause:** Token not properly saved or passed

**Solution:**
```typescript
// Check in LoginPage.tsx - line 34-35
if (data?.session) {
  onLogin(data.session.access_token, data.user);  // ← Must pass token
}
```

### Issue 2: Token works initially, then fails

**Cause:** Token expired (1 hour default)

**Solution:** Already implemented with auto-refresh
- Check console for refresh messages
- Verify refresh interval is running

### Issue 3: Backend always returns 401

**Cause:** Backend validation issue

**Debug the backend:**
1. Check `/supabase/functions/server/index.tsx`
2. Look at `getUserFromToken` function (line 58-98)
3. Ensure it's using `supabase.auth.getUser(token)`

**Backend validation code:**
```typescript
async function getUserFromToken(authHeader: string | null) {
  const token = authHeader?.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return user;
}
```

### Issue 4: CORS errors

**Symptom:** Network errors, CORS policy errors

**Solution:**
```typescript
// In server/index.tsx
app.use('*', cors());  // ← Must be first middleware
```

## 🎯 Quick Diagnostic Checklist

Run through this checklist:

- [ ] Debug panel shows "Session Active" (green checkmark)
- [ ] Debug panel shows your email address
- [ ] Token expiry is in the future
- [ ] Console shows "Valid session found"
- [ ] "Test API" button passes (green message)
- [ ] Dashboard loads without errors
- [ ] No 401 errors in Network tab

**If ALL checked:** System is working correctly

**If ANY unchecked:** Follow the corresponding step above

## 🔍 Advanced Debugging

### Check Network Tab

1. Open DevTools → Network tab
2. Make an API call (e.g., load dashboard)
3. Find the request to `/dashboard`
4. Click on it
5. Check **Headers** tab:
   - `Authorization: Bearer eyJhbGc...` should be present
6. Check **Response** tab:
   - Look for error details

### Check Backend Logs

If you have access to Supabase dashboard:
1. Go to Edge Functions
2. Find `make-server-9c637d11`
3. Check logs for errors

### Verify Environment Variables

Backend needs these env vars:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 🚨 Nuclear Option: Complete Reset

If nothing works:

1. **Logout** from the app
2. **Clear browser data**:
   - Press F12
   - Application tab
   - Storage → Clear site data
3. **Close all tabs**
4. **Re-open app**
5. **Create new account** (don't re-use old one)
6. **Try again**

## 📞 What to Report

If still broken, provide:

1. Screenshot of Auth Debug Panel
2. Console logs (F12 → Console → screenshot)
3. Network tab screenshot showing failing request
4. What you tried from this guide

## ✅ Expected Working State

When everything works, you should see:

**Console:**
```
Checking for existing session...
Valid session found, user: test@example.com
Token updated: eyJhbGciOiJIUzI1NiI...
API Request: GET /dashboard
Token (first 30 chars): eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp...
API Response: 200 OK
API Success: GET /dashboard
```

**Debug Panel:**
```
✅ Session Active
User: test@example.com
Expires: Jan 16, 2026, 11:30:00 PM
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImY...

[Test API] ✅ Health check passed: {"status":"ok","timestamp":"..."}
```

**UI:**
- Dashboard loads with data
- No error messages
- All modules work
- No 401 errors

---

## 🎉 Next Steps

1. **Check the debug panel** (bottom-right corner)
2. **Click "Test API"** to verify backend connection
3. **Check console** for detailed logs
4. **Try "Refresh Token"** if needed
5. **Report findings** if issue persists

The debug panel is your friend! It shows exactly what's happening with authentication in real-time.
