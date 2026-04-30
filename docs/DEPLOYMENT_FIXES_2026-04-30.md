# Deployment Fixes Report — 2026-04-30

**Branch:** `deploy/pre-prod`
**Server:** `http://20.164.2.189` (Azure VM)
**Container Registry:** `warehouseae.azurecr.io/wms-service:latest`
**Supabase Project:** `sugvmurszfcneaeyoagv`

This document is the post-mortem and full record of the deployment incident on 2026-04-30: what was broken, why it was broken, what was fixed, and how the system is wired now. It supersedes ad-hoc Slack/PR notes — anyone debugging a future deploy should start here.

---

## 1. Executive Summary

Four independent failures stacked on top of each other and produced a single confusing symptom: **"the deploy goes green in CI, but the site doesn't update."**

| # | Layer | Failure | Fix Commit |
|---|---|---|---|
| 1 | CI build | `docker build` did not pass `VITE_*` build args → bundle baked empty Supabase URL/key → `[FATAL]` on app boot | `c843f1f` |
| 2 | Container nginx | `${PDF_API_KEY}` placeholder copied verbatim → nginx crash-loop, port 8080 never opened | `6f18dab` |
| 3 | Host nginx | Ubuntu's default site shadowed the `wms` reverse-proxy site on port 80 → served stale `/var/www/html` | `b4af133` |
| 4 | GitHub secrets | Only 1 of 4 required `VITE_*` secrets existed; existing one had a typo (`supabase.covite`) → all REST/Auth/Realtime DNS-failed | manual (secrets) |

All four are now fixed. The branch is current with `origin/deploy/pre-prod`.

Two known follow-up issues are **out of scope** for this report but documented at the end:
- `crypto.randomUUID is not a function` on write screens (HTTP secure-context issue)
- The site is served over plain HTTP, not HTTPS

---

## 2. Symptoms Observed

| Where | What the user saw |
|---|---|
| Login page | Loaded fine, login succeeded |
| Stock Movements | Worked end-to-end |
| Dashboard / Proforma Invoice | "TypeError: Failed to fetch", empty cards |
| Verify MPL screen | "crypto.randomUUID is not a function" red banner |
| Sticker generation | Modal opens but data never loads |
| BPA / Release / Move Pallet / Receive | Buttons did nothing |
| After "redeploy" | Browser kept showing previously-cached working bundle, so it looked like deploy didn't run |

The split between working and broken modules was not random — it tracked exactly with which code paths touched the Supabase auth client during the failure window.

---

## 3. Root Cause #1 — Missing `VITE_*` Build Args (Fix: `c843f1f`)

### What was wrong

[`Dockerfile`](../Dockerfile) declares four build-time arguments:

```dockerfile
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_PDF_SERVICE_URL
ARG VITE_PDF_SERVICE_API_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_PDF_SERVICE_URL=$VITE_PDF_SERVICE_URL
ENV VITE_PDF_SERVICE_API_KEY=$VITE_PDF_SERVICE_API_KEY
```

These get **baked into the JS bundle** by Vite at `npm run build` time — `import.meta.env.VITE_*` references in source code are statically replaced with their string values. Without the args, the env vars resolve to empty strings.

The previous version of [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) ran:

```yaml
docker build --no-cache -t warehouseae.azurecr.io/wms-service:latest -f Dockerfile .
```

No `--build-arg` flags. The Dockerfile's `ARG` statements default to empty. Vite produced a bundle with:

```js
const supabaseUrl = "";
const supabaseAnonKey = "";
```

[`src/utils/supabase/info.tsx`](../src/utils/supabase/info.tsx) has a fail-fast check:

```ts
if (!supabaseUrl) {
  throw new Error('[FATAL] VITE_SUPABASE_URL is not set. ...');
}
```

So every container started with a bundle that threw at module-load time, white-screened the app, and never recovered. The browser cached `index.html` and the previous (working) bundle, so users kept seeing the old page — making it look like the deploy "didn't update".

### Why this masquerades as "deploy not running"

1. CI workflow goes green (build + push succeed; the bundle is just broken at runtime, not build time).
2. The Azure VM pulls the new image fine.
3. The container starts; nginx serves the new `index.html`, which references the new bundle hash.
4. Browser fetches the new bundle → JS loads → throws `[FATAL]` immediately → React never mounts → blank page.
5. But because step 4 happens silently in DevTools and most users have a cached `index.html`/old bundle from a prior session, they see the old working app and conclude "nothing changed."

### Fix

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) build step now passes all four args:

```yaml
- name: Build Docker image
  run: |
    docker pull node:20-alpine || true
    docker build --no-cache \
      --build-arg VITE_SUPABASE_URL="${{ secrets.VITE_SUPABASE_URL }}" \
      --build-arg VITE_SUPABASE_ANON_KEY="${{ secrets.VITE_SUPABASE_ANON_KEY }}" \
      --build-arg VITE_PDF_SERVICE_URL="${{ secrets.VITE_PDF_SERVICE_URL }}" \
      --build-arg VITE_PDF_SERVICE_API_KEY="${{ secrets.VITE_PDF_SERVICE_API_KEY }}" \
      -t warehouseae.azurecr.io/wms-service:latest -f Dockerfile .
```

The dead pre-Docker `npm ci` / `npm run build` steps were also removed — they were no-ops because `docker build --no-cache` rebuilds inside the image regardless.

### Required GitHub secrets

Settings → Secrets and variables → Actions:

| Name | Value | Where to find it |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://sugvmurszfcneaeyoagv.supabase.co` | Supabase dashboard → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi...` (anon key) | Supabase dashboard → Project Settings → API → anon `public` key |
| `VITE_PDF_SERVICE_URL` | `https://autocrat-pdf-service.yellowtree-adf7b03e.centralindia.azurecontainerapps.io` | Azure Portal → Container Apps → autocrat-pdf-service → Application URL |
| `VITE_PDF_SERVICE_API_KEY` | (PDF service API key) | Same as runtime `PDF_API_KEY` value |

`VITE_FUNCTIONS_URL` is **not** required — [`info.tsx`](../src/utils/supabase/info.tsx) auto-derives it from `VITE_SUPABASE_URL`.

> ⚠️ **`VITE_SUPABASE_URL` was previously set incorrectly to `https://sugvmurszfcneaeyoagv.supabase.covite`.** The trailing `vite` is a copy-paste accident. Verify the value contains *exactly* `.co` and nothing more. This typo caused all REST/Auth/Realtime calls to DNS-fail with `ERR_NAME_NOT_RESOLVED`. See §7 for why only some modules failed.

---

## 4. Root Cause #2 — Container nginx Crash Loop (Fix: `6f18dab`)

### What was wrong

[`devops/nginx/nginx.conf`](../devops/nginx/nginx.conf) contains lines like:

```nginx
proxy_set_header X-API-Key "${PDF_API_KEY}";
```

The `${PDF_API_KEY}` is **shell-style** placeholder, intended to be substituted at container start time. nginx itself uses `$variable` (no braces) for its own variables (`$remote_addr`, `$uri`, etc.).

An earlier commit (`bf75b07`) had simplified the Dockerfile to copy this conf directly:

```dockerfile
COPY devops/nginx/nginx.conf /etc/nginx/conf.d/default.conf
```

With direct copy, no substitution happens. nginx tried to parse `${PDF_API_KEY}` as a literal variable name, found it undefined at startup, and crashed:

```
nginx: [emerg] unknown "PDF_API_KEY" variable
```

Docker restart policy `unless-stopped` then put the container into a restart loop. Port 8080 never opened. The deploy script's health check (`curl -f http://localhost:8080`) failed — but only after the validation container check, so the workflow sometimes still succeeded for the first container before failing on the swap.

### Fix

Use the official `nginx:1.27-alpine` image's built-in template mechanism:

```dockerfile
# Copy nginx config as a template — nginx image's docker-entrypoint runs
# envsubst on /etc/nginx/templates/*.template at container start and writes
# the result to /etc/nginx/conf.d/. NGINX_ENVSUBST_FILTER_VARIABLES restricts
# substitution to PDF_API_KEY so nginx's own $remote_addr, $uri, $scheme, etc.
# are left untouched. PDF_API_KEY itself is supplied at `docker run --env`.
COPY devops/nginx/nginx.conf /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER_VARIABLES=PDF_API_KEY

# Remove the default nginx server config so it doesn't conflict with ours
RUN rm -f /etc/nginx/conf.d/default.conf
```

### Why `NGINX_ENVSUBST_FILTER_VARIABLES` matters

Without it, the entrypoint would substitute **every** `${...}` in the template — including nginx's own variables like `${remote_addr}` (if anyone wrote that form). The filter restricts substitution to the single variable `PDF_API_KEY`, so the conf file can keep `$remote_addr`, `$uri`, `$scheme`, `$host`, `$server_port`, etc. as nginx variables (no braces or in unfiltered form), and only `${PDF_API_KEY}` gets replaced.

`PDF_API_KEY` itself is injected at `docker run`:

```bash
docker run -d --name wms \
  -p 127.0.0.1:8080:80 \
  --env PDF_API_KEY=${{ secrets.PDF_API_KEY }} \
  --restart unless-stopped \
  warehouseae.azurecr.io/wms-service:latest
```

Note: `PDF_API_KEY` (runtime, no `VITE_` prefix) is **different** from `VITE_PDF_SERVICE_API_KEY` (build time). The first is used by container nginx to authenticate the proxy call to the Azure PDF service. The second is baked into the JS bundle so the browser can include it as a header on direct calls (currently routed through the proxy).

---

## 5. Root Cause #3 — Host nginx Default Site Shadowing (Fix: `b4af133`)

### What was wrong

The Azure VM has **two layers** of nginx:

```
Internet → port 80 on VM → host nginx → 127.0.0.1:8080 → container nginx → static files
```

The host nginx is the one running on the VM directly (managed by `systemctl`). It's there to (a) terminate port 80 and (b) reverse-proxy to the Docker container, with the config in [`devops/nginx/host-reverse-proxy.conf`](../devops/nginx/host-reverse-proxy.conf).

Ubuntu installs nginx with a default site at `/etc/nginx/sites-enabled/default`. That site:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    root /var/www/html;
    server_name _;
    ...
}
```

The `default_server` directive means: "if no other `server` block matches the requested `Host` header, serve this one." Since the WMS site uses `server_name _;` (also a catch-all) but **without** `default_server`, the Ubuntu default wins the tiebreaker. Result: requests to `http://20.164.2.189/` were served from `/var/www/html` (the Apache-style "Welcome to nginx!" page or stale HTML) instead of being proxied to the container.

The deploy script previously only removed `/etc/nginx/conf.d/default.conf` but not `/etc/nginx/sites-enabled/default`, leaving the second copy active.

### Fix

The deploy SSH script now runs both removals **and** reloads nginx so the change takes effect immediately:

```bash
echo "===== CLEANUP STALE HOST NGINX CONFIGS ====="
# The Ubuntu default site listens on port 80 with default_server and
# would intercept traffic before our wms reverse-proxy site, serving
# stale /var/www/html instead of proxying to the container on 8080.
sudo rm -f /etc/nginx/conf.d/default.conf
sudo rm -f /etc/nginx/sites-enabled/default

echo "===== RELOAD HOST NGINX ====="
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` tests config syntax before `systemctl reload` applies it — so a broken conf surfaces in the deploy log instead of bricking nginx.

### Required host config

The wms reverse-proxy site must be installed on the host VM at:

```
/etc/nginx/sites-available/wms
/etc/nginx/sites-enabled/wms  → symlink to ../sites-available/wms
```

Or alternatively at `/etc/nginx/conf.d/wms.conf`. Contents come from [`devops/nginx/host-reverse-proxy.conf`](../devops/nginx/host-reverse-proxy.conf). This is a one-time install per VM — the deploy script only manages the *removal* of the default site, not the *creation* of the wms site.

---

## 6. Root Cause #4 — Wrong / Missing GitHub Secrets

### What was wrong

The repo's GitHub Actions secrets had:

| Secret | State |
|---|---|
| `VITE_SUPABASE_URL` | ✅ Existed, but value was `https://sugvmurszfcneaeyoagv.supabase.covite` (typo: trailing `vite`) |
| `VITE_SUPABASE_ANON_KEY` | ❌ Did not exist |
| `VITE_PDF_SERVICE_URL` | ❌ Did not exist |
| `VITE_PDF_SERVICE_API_KEY` | ❌ Did not exist |
| `PDF_API_KEY` | ✅ Existed (runtime, used by container nginx) |
| `ACR_USERNAME`, `ACR_PASSWORD`, `VM_IP`, `SSH_PRIVATE_KEY` | ✅ Existed |

After the deploy.yml fix in §3, builds started passing build args — but with mostly empty values, since the secrets weren't there. So the bundle still booted broken.

### How the typo created the "only-some-modules-work" pattern

[`src/utils/supabase/info.tsx`](../src/utils/supabase/info.tsx) builds the edge function URL by **regex-extracting** the project ID from `VITE_SUPABASE_URL`:

```ts
const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
// For "https://sugvmurszfcneaeyoagv.supabase.covite":
//   match[1] = "sugvmurszfcneaeyoagv"  ← regex stops at first dot, ignores "vite"

export const FUNCTIONS_BASE =
  `https://${projectId}.supabase.co/functions/v1`;
//   ↑ rebuilt from scratch — comes out clean as "supabase.co"
```

Edge function URLs were reconstructed from just the project ID, so the typo was discarded. **Edge function calls worked.**

But [`src/utils/supabase/client.tsx`](../src/utils/supabase/client.tsx):

```ts
supabaseInstance = createClient(url, key);
//                              ↑ raw env var passed in as-is
```

`@supabase/supabase-js` uses this raw URL to build:
- REST: `${url}/rest/v1/...` → `supabase.covite/rest/v1/...` → DNS fail
- Auth: `${url}/auth/v1/...` → `supabase.covite/auth/v1/...` → DNS fail
- Realtime: `${url.replace('https', 'wss')}/realtime/v1/...` → `wss://supabase.covite/...` → DNS fail

So:

| Code path | Affected? |
|---|---|
| Edge function call rebuilt via `getEdgeFunctionUrl()` | ❌ No — works |
| `supabase.from('table').select()` (REST) | ✅ Yes — fails |
| `supabase.auth.getSession()` / `refreshSession()` | ✅ Yes — fails |
| Realtime subscriptions | ✅ Yes — fails |
| Edge function call via `fetchWithAuth` while JWT is fresh | ❌ No — works (no auth network call needed) |
| Edge function call via `fetchWithAuth` after JWT expiry | ✅ Yes — refresh hits `/auth/v1/token` on broken host |

That's why **Stock Movements worked** (read-only edge functions, called early in the session while JWT was fresh) and **everything else broke** (either REST-based, or edge functions called later when token refresh kicked in).

### Fix

Add/correct the four secrets in GitHub:

```
VITE_SUPABASE_URL          = https://sugvmurszfcneaeyoagv.supabase.co
VITE_SUPABASE_ANON_KEY     = <anon key from Supabase dashboard>
VITE_PDF_SERVICE_URL       = https://autocrat-pdf-service.yellowtree-adf7b03e.centralindia.azurecontainerapps.io
VITE_PDF_SERVICE_API_KEY   = <PDF service API key>
```

Empty commit `23f928d` was pushed to retrigger the workflow once secrets were corrected (Actions doesn't refire on secret changes alone).

---

## 7. Why Some Modules Worked And Others Didn't

This was the most confusing symptom. The split followed exactly two rules:

**Rule 1 — Did the call use the broken hostname?**
- Edge functions: URL rebuilt from regex, hostname always correct → ✅
- REST / Auth / Realtime: used raw env var, hostname broken → ❌

**Rule 2 — Did the auth client need to hit the network during the call?**
- JWT in localStorage still valid → `getSession()` reads from cache, no network → ✅
- JWT expired or near-expiry → `refreshSession()` calls `/auth/v1/token` on broken hostname → ❌

Most edge function calls in the app go through [`src/utils/supabase/auth.ts`](../src/utils/supabase/auth.ts) → `fetchWithAuth`, which calls `supabase.auth.getSession()` before fetching:

```ts
export async function fetchWithAuth(url, options = {}) {
  const supabase = getSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();  // ← may hit broken host
  ...
  let response = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (response.status === 401) {
    const { data: refreshData } = await supabase.auth.refreshSession();  // ← definitely hits broken host
    ...
  }
}
```

So the working/broken split depended on **timing**:
- Stock Movements visited right after login → JWT fresh → `getSession()` read from localStorage → call to `supabase.co/functions/v1/sm_get-movements` succeeded
- Sticker generation visited 30+ min after login → JWT near expiry → `getSession()` triggered auto-refresh → DNS failure on `supabase.covite/auth/v1/token` → "No authentication token available" error

This explains why "stock movements works but stickers don't" wasn't a contradiction — both use edge functions, but the second one was bottlenecked on auth refresh.

---

## 8. End-to-End Request Flow (After All Fixes)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ User browser                                                             │
│ http://20.164.2.189/                                                     │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │ HTTP :80
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Azure VM — Host nginx (systemctl)                                        │
│   /etc/nginx/sites-enabled/wms                                           │
│   server { listen 80; proxy_pass http://127.0.0.1:8080; }                │
│   (Ubuntu default site removed by deploy script)                         │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │ HTTP :8080 (loopback only)
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Docker container "wms"                                                   │
│   warehouseae.azurecr.io/wms-service:latest                              │
│   --env PDF_API_KEY=<runtime secret>                                     │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Container nginx (port 80 inside container)                               │
│   /etc/nginx/conf.d/default.conf (rendered from template, PDF_API_KEY    │
│   substituted, all other $vars left as nginx vars)                       │
│                                                                          │
│   location /            → static files at /usr/share/nginx/html          │
│   location /v1/generate-pdf → reverse-proxy to Azure PDF service         │
│                              with X-API-Key: ${PDF_API_KEY}              │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Vite-built JS bundle (in browser)                                        │
│   import.meta.env.VITE_SUPABASE_URL = "https://sugvmurszfcneaeyoagv.     │
│                                       supabase.co"   (no typo)           │
│   import.meta.env.VITE_SUPABASE_ANON_KEY = "<anon key>"                  │
│   import.meta.env.VITE_PDF_SERVICE_URL   = "<azure container app url>"   │
│   import.meta.env.VITE_PDF_SERVICE_API_KEY = "<api key>"                 │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                ┌─────────────┼─────────────┬─────────────┐
                ▼             ▼             ▼             ▼
          Supabase REST   Supabase Auth   Edge Fns    Realtime WS
          /rest/v1/...    /auth/v1/...    /functions  /realtime/v1
              ALL HIT supabase.co (correct hostname)  ✅
```

---

## 9. Verification After Deploy

Open DevTools → Network on `http://20.164.2.189/` and confirm:

1. **Bundle hash changed** — `index-<hash>.js` should be a new hash, not `index-Xv-coJXy.js` or `index-B8zrYLIr.js` (the broken ones).
2. **No `supabase.covite` URLs anywhere** — every Supabase call should go to `sugvmurszfcneaeyoagv.supabase.co`.
3. **REST returns 200** — `https://sugvmurszfcneaeyoagv.supabase.co/rest/v1/inv_warehouses?...` should succeed.
4. **Auth returns 200** — `https://sugvmurszfcneaeyoagv.supabase.co/auth/v1/user` should succeed.
5. **No `[FATAL]` in console** — if you see `[FATAL] VITE_SUPABASE_URL is not set`, the build args didn't reach the Docker build.
6. **Container running** — SSH to the VM, run `docker ps`, confirm `wms` is `Up X minutes (healthy)`.

If step 6 shows the container restarting, check `docker logs wms` for the nginx parse error from §4.

---

## 10. Branch Strategy Going Forward

A separate problem surfaced during this work: **`develop-test` was getting old changes back from `deploy/pre-prod`** because of bidirectional merging. Specifically commit `318a16b` ("Merge branch 'deploy/pre-prod' into develop-test") propagated old conflict resolutions backward.

**Rule:** merges flow in **one direction only**:

```
feature branches (e.g., Migration/Dispatch, mig/packing)
       │
       ▼
   develop-test
       │
       ▼
   deploy/pre-prod
       │
       ▼
   deploy/production
```

Never merge `deploy/pre-prod → develop-test` or `deploy/pre-prod → feature/*`. If `develop-test` falls behind on infra (Dockerfile, deploy.yml), **cherry-pick** the specific infra commits over instead — that brings the file change without dragging the merge graph.

---

## 11. Untracked Files Note

The local working tree on `deploy/pre-prod` has 15 untracked folders under `supabase/functions/`:

```
_shared/seq.ts
dis_packing_list_cancel/
dis_packing_list_confirm/
dis_packing_list_create/
dis_packing_list_mark_printed/
dis_proforma_inv_approve/
dis_proforma_inv_cancel/
dis_proforma_inv_create/
dis_selection_create_packing_list/
new_dis_packing_list_queries/
new_dis_proforma_inv_queries/
new_dis_selection_queries/
new_im_queries/
new_pac_queries/
new_sm_queries/
```

These are **deployed to Supabase directly** (via `supabase functions deploy`) and live in `develop-test` for team reference. They are intentionally not committed to `deploy/pre-prod` — only the frontend code that *calls* them needs to ship via this pipeline. Leave them untracked here.

---

## 12. Outstanding / Out of Scope

These are known issues observed during this incident but **not** addressed by the four fixes above. Track separately.

### A. `crypto.randomUUID is not a function` on write screens

`window.crypto.randomUUID()` is only exposed in **secure contexts** (HTTPS or `localhost`). The site is served over plain HTTP at `http://20.164.2.189/`, so the browser strips that method off `window.crypto`. Five files call it raw without a fallback:

- [`src/App.tsx:126`](../src/App.tsx#L126)
- [`src/components/bpa/BPAAmend.tsx:98`](../src/components/bpa/BPAAmend.tsx#L98)
- [`src/components/rack-view/MovePalletDialog.tsx:51`](../src/components/rack-view/MovePalletDialog.tsx#L51)
- [`src/components/rack-view/ReceiveShipmentScreen.tsx:197`](../src/components/rack-view/ReceiveShipmentScreen.tsx#L197)
- [`src/components/release/CreateRelease.tsx:152`](../src/components/release/CreateRelease.tsx#L152)

A helper [`generateIdempotencyKey()`](../src/utils/idempotency.ts#L23) already exists with a `Math.random` fallback. Quick fix: route those five call sites through the helper.

### B. HTTPS

The proper structural fix for (A) and a wider class of secure-context issues (clipboard API, service workers, `crypto.subtle`, etc.) is to put HTTPS in front of the host. Options:

- Let's Encrypt + certbot on the host nginx (cheapest, requires a DNS name)
- Azure Front Door or Application Gateway (managed, expensive, supports raw IPs via custom domain)
- Cloudflare in front of a domain that points to the VM IP

Until HTTPS is live, expect new browser-API issues to surface periodically.

---

## 13. Commit Reference

```
23f928d  chore: trigger rebuild with corrected VITE_* secrets
b4af133  fix(deploy): disable Ubuntu default nginx site and reload host nginx
6f18dab  fix(deploy): restore PDF_API_KEY env substitution in nginx config
c843f1f  merge: bring Migration/Dispatch into deploy/pre-prod + fix deploy build args
   ├─ 005a83d  v0.5.5: release allocation holds + historical data import (M1-M4) + docs
   ├─ c154d54  feat: release allocation/reservation holds + inventory 4-bucket view
   ├─ c15c4a6  feat: part-first BPA + Inbound Receiving wizard + Pending Placement
   ├─ 65ad35e  feat: multi-invoice release wizard + BPA/Release UI refinements
   └─ e505410  feat: BPA / Release / Rack View modules — Phases 1-3 + follow-up fixes
```

All on `origin/deploy/pre-prod` as of 2026-04-30.

---

*Document owner: deployment / DevOps*
*Last updated: 2026-04-30*
