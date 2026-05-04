/**
 * useViewport — small media-query hook for responsive layout decisions.
 *
 * Subscribes to a single matchMedia listener so multiple consumers don't pile
 * up event handlers. SSR-safe: returns `false` flags before mount.
 *
 * Breakpoint reasoning:
 *   - mobile  (<768px)   phones in portrait; one column, bottom nav, no hover
 *   - tablet  (768-1023) tablets, sideways phones; two columns possible
 *   - desktop (≥1024)    laptop / dock workstations; full modal layout
 */
import { useEffect, useState } from 'react';

const MOBILE_QUERY  = '(max-width: 767px)';
const TABLET_QUERY  = '(min-width: 768px) and (max-width: 1023px)';

export interface Viewport {
    isMobile:  boolean;
    isTablet:  boolean;
    isDesktop: boolean;
}

function readSync(): Viewport {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return { isMobile: false, isTablet: false, isDesktop: true };
    }
    const isMobile = window.matchMedia(MOBILE_QUERY).matches;
    const isTablet = window.matchMedia(TABLET_QUERY).matches;
    return { isMobile, isTablet, isDesktop: !isMobile && !isTablet };
}

export function useViewport(): Viewport {
    const [vp, setVp] = useState<Viewport>(readSync);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq1 = window.matchMedia(MOBILE_QUERY);
        const mq2 = window.matchMedia(TABLET_QUERY);
        const update = () => setVp(readSync());
        // Both Safari and modern browsers
        mq1.addEventListener?.('change', update);
        mq2.addEventListener?.('change', update);
        // Initial sync (in case the SSR fallback ran)
        update();
        return () => {
            mq1.removeEventListener?.('change', update);
            mq2.removeEventListener?.('change', update);
        };
    }, []);

    return vp;
}

/**
 * useOnline — subscribes to `online` / `offline` browser events and reflects
 * the current connectivity state. SSR-safe (returns `true` before mount, on
 * the principle that UIs should default to "ok" rather than flash an offline
 * banner during hydration).
 *
 * `navigator.onLine` is best-effort: it can lie (e.g. captive portals report
 * online when no real internet exists). For our purposes — knowing whether
 * to queue a scan vs send it now — that's good enough; failed sends will
 * fall through to the queue path anyway.
 */
export function useOnline(): boolean {
    const [online, setOnline] = useState<boolean>(() => {
        if (typeof navigator === 'undefined') return true;
        return navigator.onLine;
    });
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onOnline  = () => setOnline(true);
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, []);
    return online;
}
