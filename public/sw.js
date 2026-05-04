/* eslint-env serviceworker */
/**
 * sw.js — minimal service worker for the Autocrat Engineers WMS.
 *
 * Strategy:
 *   - Navigation requests       → network-first, fall back to cached shell.
 *                                 Lets us survive dock-WiFi blips without
 *                                 ever serving a stale UI when the network is up.
 *   - Same-origin static assets → cache-first (Vite-hashed JS / CSS / images
 *                                 are immutable; stale is impossible).
 *   - API / Supabase / cross-origin → never cached. Always pass through.
 *
 * Cache name carries a date stamp so a redeploy invalidates everything.
 * Bumped by hand whenever the SW logic itself changes.
 */
const CACHE_VERSION = 'v1-2026-05-04';
const SHELL_CACHE   = `wms-shell-${CACHE_VERSION}`;
const ASSET_CACHE   = `wms-assets-${CACHE_VERSION}`;

const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/a-logo.png'];

self.addEventListener('install', (event) => {
    // Take over as soon as install completes — minimizes the chance of users
    // seeing the "old" SW in control after a deploy.
    self.skipWaiting();
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined)),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys
                .filter((k) => k.startsWith('wms-') && !k.endsWith(CACHE_VERSION))
                .map((k) => caches.delete(k)),
        );
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;                   // never cache mutations

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;    // cross-origin (Supabase) — bypass

    // Skip Supabase / API-style paths even when proxied through same-origin.
    if (url.pathname.startsWith('/functions/') || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) {
        return;
    }

    if (req.mode === 'navigate') {
        event.respondWith(networkFirst(req, SHELL_CACHE));
        return;
    }

    // Hashed static assets — fine to cache aggressively.
    if (url.pathname.startsWith('/assets/') || /\.(js|mjs|css|png|jpg|jpeg|svg|webp|woff2?|ttf|ico)$/i.test(url.pathname)) {
        event.respondWith(cacheFirst(req, ASSET_CACHE));
        return;
    }
});

async function networkFirst(req, cacheName) {
    try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
            const cache = await caches.open(cacheName);
            cache.put(req, fresh.clone()).catch(() => undefined);
        }
        return fresh;
    } catch {
        const cached = await caches.match(req) || await caches.match('/index.html') || await caches.match('/');
        if (cached) return cached;
        return new Response('Offline — unable to load page.', {
            status: 503, headers: { 'Content-Type': 'text/plain' },
        });
    }
}

async function cacheFirst(req, cacheName) {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
            const cache = await caches.open(cacheName);
            cache.put(req, fresh.clone()).catch(() => undefined);
        }
        return fresh;
    } catch {
        // No cache, no network — let the browser show its native error.
        return new Response('', { status: 504 });
    }
}

// ─── Optional: surface flush requests to clients ───────────────────────
// The receive screen broadcasts a "scan queue flush" trigger when it goes
// online. We don't process the queue inside the SW itself (the queue lives
// in IndexedDB on the page) — but we relay the online event through.
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
