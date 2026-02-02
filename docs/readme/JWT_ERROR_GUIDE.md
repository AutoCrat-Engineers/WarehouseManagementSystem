# 🔧 JWT Validation Error - Debugging Guide

## 🚨 Current Error

```
API Error: HTTP 401: {
  "code": 401,
  "message": "Invalid JWT"
}
```

## 🎯 What This Means

The backend is receiving your access token, but Supabase is rejecting it as invalid. This usually means:

1. **Token is expired** (most common)
2. **Wrong Supabase project** (token from different project)
3. **Backend SUPABASE_ANON_KEY mismatch** (backend using different key than frontend)
4. **Token format is corrupted**

---

## 🔍 **DIAGNOSTIC TOOL ADDED**

I've added an **Authentication Debug Tool** to your dashboard that will appear when there's an auth error.

### How to Use It:

1. **Login** to the app
2. Go to **Dashboard**
3. If you see a **yellow debug panel**, click "**Test Authentication**"
4. It will show you:
   - ✅ If token is valid
   - ❌ If token is invalid (with reason)
   - Token format and length
   - Exact error from backend

---

## 🛠️ **FIXES APPLIED**

### 1. Enhanced Backend Logging

The backend now logs every authentication attempt:

```typescript
console.log('getUserFromToken: Validating token...');
console.log('getUserFromToken: Successfully validated user:', user.id);
// or
console.error('getUserFromToken: Auth validation error:', error);
```

**Check:** Supabase Dashboard → Functions → Logs

### 2. Debug Endpoint Created

New endpoint for testing auth:
```
GET /make-server-9c637d11/debug/auth
```

This endpoint will:
- ✅ Validate your token
- ✅ Return user info if valid
- ❌ Return exact error if invalid

### 3. Better Error Messages

All auth errors now include:
- HTTP status code
- Error message
- Error details (if available)

---

## 🔐 **Root Cause Analysis**

### The Issue

Your backend has **TWO** Supabase clients:

```typescript
// Admin client (SERVICE_ROLE_KEY) - for creating users
const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// User client (ANON_KEY) - for validating tokens
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
```

The `supabase` client (with ANON_KEY) validates user tokens.

### What Could Be Wrong

**Scenario 1: Environment Variable Mismatch**

```bash
# Frontend uses:
SUPABASE_ANON_KEY=ey...abc

# Backend uses:
SUPABASE_ANON_KEY=ey...xyz  # ← DIFFERENT!
```

**Solution:** Verify both use the SAME key

---

**Scenario 2: Token is Expired**

JWT tokens have expiration times (usually 1 hour).

**Solution:** Re-login to get fresh token

---

**Scenario 3: Different Supabase Projects**

Frontend and backend point to different projects.

**Solution:** Verify `projectId` matches in both

---

## ✅ **STEP-BY-STEP DEBUGGING**

### Step 1: Check Frontend Token

Open browser console and run:

```javascript
// Get current session
const supabase = window.supabase || 
  createClient('YOUR_URL', 'YOUR_ANON_KEY');

const { data: { session } } = await supabase.auth.getSession();
console.log('Session:', session);
console.log('Access Token:', session?.access_token);
console.log('Token expires at:', new Date(session?.expires_at * 1000));
```

**Expected:**
- ✅ `session` exists
- ✅ `access_token` is a long string with dots (JWT format)
- ✅ `expires_at` is in the future

**If token is expired:**
```javascript
// Re-login
await supabase.auth.signOut();
// Then login again through the UI
```

---

### Step 2: Test Token with Debug Tool

1. **Login** to your app
2. **Navigate** to Dashboard
3. **Click** "Test Authentication" button
4. **Read** the results:

**If Success:**
```json
{
  "success": true,
  "user": {
    "id": "...",
    "email": "user@example.com"
  }
}
```
✅ Token is valid! The issue is elsewhere.

**If Failed:**
```json
{
  "error": "Token validation failed",
  "details": "Invalid JWT",
  "code": 401
}
```
❌ Token is invalid. See solutions below.

---

### Step 3: Check Backend Environment Variables

Go to **Supabase Dashboard**:

1. **Select your project**
2. **Settings** → **API**
3. **Copy** the following:
   - Project URL
   - anon/public key
   - service_role key

Then go to **Edge Functions** → **make-server-9c637d11** → **Settings**:

4. **Verify** environment variables:
   ```
   SUPABASE_URL = <your project URL>
   SUPABASE_ANON_KEY = <anon public key>
   SUPABASE_SERVICE_ROLE_KEY = <service role key>
   ```

**CRITICAL:** The `SUPABASE_ANON_KEY` in backend MUST match the `publicAnonKey` in frontend!

---

### Step 4: Check Frontend Configuration

Open `/utils/supabase/info.tsx`:

```typescript
export const projectId = 'xxxxxxxxxx';
export const publicAnonKey = 'eyJhbGc...';
```

**Verify:**
- ✅ `projectId` matches your Supabase project
- ✅ `publicAnonKey` matches the anon key in Supabase Dashboard

---

### Step 5: Force Fresh Login

Sometimes cached credentials are stale:

```javascript
// In browser console:
localStorage.clear();
sessionStorage.clear();
location.reload();
```

Then login again.

---

## 🎯 **MOST LIKELY SOLUTIONS**

### Solution 1: Update Backend Environment Variables

**Problem:** Backend has wrong SUPABASE_ANON_KEY

**Fix:**
1. Go to Supabase Dashboard → Project → Settings → API
2. Copy the "anon public" key
3. Go to Edge Functions → make-server-9c637d11 → Settings
4. Update `SUPABASE_ANON_KEY` environment variable
5. **Redeploy** the edge function

---

### Solution 2: Token Expiration

**Problem:** Your token expired

**Fix:**
1. Logout of the app
2. Login again
3. Test immediately

---

### Solution 3: Clear Session and Re-login

**Problem:** Corrupted session data

**Fix:**
```javascript
// Browser console:
const supabase = window.supabase;
await supabase.auth.signOut();
localStorage.clear();
location.reload();
// Then login through UI
```

---

## 📊 **What to Check in Logs**

### Frontend Console Logs

Look for:
```
API Request: GET /dashboard
Authorization header present
API Error: HTTP 401: Invalid JWT
```

### Backend Function Logs

Look for:
```
getUserFromToken: Validating token...
getUserFromToken: Auth validation error: Invalid JWT
```

**If you see "Invalid JWT":**
- Token is malformed OR
- ANON_KEY mismatch OR
- Token is expired

---

## 🔬 **Advanced Debugging**

### Decode JWT Token

Use https://jwt.io to decode your token:

1. Copy your access token from browser console
2. Paste into jwt.io
3. Check:
   - `exp` (expiration) - should be in future
   - `iss` (issuer) - should match your Supabase project URL
   - `aud` (audience) - should be "authenticated"

**If `exp` is in the past:**
- Token is expired, re-login

**If `iss` doesn't match your project:**
- Frontend is using wrong Supabase project

---

## 💡 **Prevention**

### Auto-Refresh Tokens

Add to `App.tsx`:

```typescript
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (event, session) => {
      if (event === 'TOKEN_REFRESHED') {
        setAccessToken(session?.access_token || null);
      }
    }
  );

  return () => subscription.unsubscribe();
}, []);
```

This will automatically update the token when Supabase refreshes it.

---

## 🎓 **Understanding the Flow**

```
1. User logs in
   ↓
2. Supabase creates session with access_token (JWT)
   ↓
3. Frontend stores token in state
   ↓
4. Frontend sends: Authorization: Bearer <token>
   ↓
5. Backend receives token
   ↓
6. Backend calls: supabase.auth.getUser(token)
   ↓
7. Supabase validates JWT signature
   ↓
8. If valid → returns user
   If invalid → returns "Invalid JWT" error
```

**The error happens at step 7-8.**

---

## 📝 **Checklist**

Before asking for help, verify:

- [ ] Logged out and logged back in (fresh token)
- [ ] Checked browser console for token format
- [ ] Used debug tool to test authentication
- [ ] Verified backend environment variables
- [ ] Checked Supabase function logs
- [ ] Confirmed frontend and backend use same project
- [ ] Token is not expired (check jwt.io)
- [ ] Cleared browser cache/localStorage

---

## 🆘 **Still Not Working?**

### Collect This Information:

1. **Debug tool output** (screenshot or JSON)
2. **Browser console logs** (full error)
3. **Backend function logs** (from Supabase Dashboard)
4. **Token info:**
   - First 30 characters
   - Length
   - Expiration time (from jwt.io)
5. **Environment:**
   - Browser
   - Supabase project ID
   - When the error started occurring

---

## 🎯 **Quick Fix Commands**

### Force Logout and Fresh Login
```javascript
// Browser console:
await window.supabase.auth.signOut();
localStorage.clear();
location.reload();
```

### Check Current Session
```javascript
const { data } = await window.supabase.auth.getSession();
console.log('Valid until:', new Date(data.session.expires_at * 1000));
```

### Test Backend Directly
```javascript
const token = '<your-access-token>';
const response = await fetch(
  'https://<project>.supabase.co/functions/v1/make-server-9c637d11/debug/auth',
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);
console.log(await response.json());
```

---

**Last Updated:** January 2026  
**Status:** 🔍 Debugging Active
