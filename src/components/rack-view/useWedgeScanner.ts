/**
 * useWedgeScanner — RF-gun / keyboard-wedge input capture.
 *
 * Industrial barcode scanners (Zebra, Honeywell, Datalogic) emulate a USB
 * keyboard: they "type" the decoded payload into whatever input has focus,
 * usually followed by Enter. This hook captures that stream globally, even
 * when no input is focused, and emits a single string per scan.
 *
 * Detection heuristic:
 *   - chars typed within `interCharMaxMs` of each other → same scan
 *   - terminator (Enter / Tab) flushes immediately
 *   - gap > `interCharMaxMs` flushes any pending buffer
 *   - if median inter-char gap > `humanThresholdMs` → discard (human typing)
 *
 * Multi-line QR payloads (our v2 format encodes Newlines): hardware-decoded
 * scanners emit them as actual Enter keystrokes in the middle of the payload.
 * To avoid splitting on intra-payload Enters, we treat Enter as a soft
 * separator: if more chars arrive within `interCharMaxMs` we keep buffering.
 * The final flush happens on idle gap.
 *
 * The hook attaches a single document-level keydown listener while enabled.
 * Multiple consumers should be avoided — keep one mount per route.
 */
import { useCallback, useEffect, useRef } from 'react';

export interface WedgeScanOptions {
    /** Max gap between two keystrokes that still belong to the same scan. */
    interCharMaxMs?: number;
    /** Median inter-char gap above this discards as human typing. */
    humanThresholdMs?: number;
    /** Minimum chars before a scan is considered valid. */
    minLength?: number;
    /** Ignore scans while these elements have focus (e.g. a free-text note input). */
    ignoreSelector?: string;
    /** Disable the listener entirely. */
    disabled?: boolean;
}

export type WedgeScanCallback = (text: string) => void;

const DEFAULTS: Required<Omit<WedgeScanOptions, 'ignoreSelector' | 'disabled'>> = {
    interCharMaxMs:    50,    // typical wedges fire at <20ms/char
    humanThresholdMs:  35,    // human typists rarely exceed ~25-30ms sustained
    minLength:         4,
};

export function useWedgeScanner(
    onScan: WedgeScanCallback,
    options: WedgeScanOptions = {},
): void {
    const cfg = { ...DEFAULTS, ...options };
    const onScanRef = useRef(onScan);
    onScanRef.current = onScan;

    const bufferRef = useRef<string>('');
    const gapsRef = useRef<number[]>([]);
    const lastTsRef = useRef<number>(0);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flush = useCallback(() => {
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        const text = bufferRef.current;
        const gaps = gapsRef.current;
        bufferRef.current = '';
        gapsRef.current = [];
        lastTsRef.current = 0;

        if (text.length < cfg.minLength) return;

        // Compute median gap; reject if it looks like a human typing.
        if (gaps.length >= 2) {
            const sorted = [...gaps].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            if (median > cfg.humanThresholdMs) return;
        }

        try { onScanRef.current(text); } catch { /* swallow */ }
    }, [cfg.minLength, cfg.humanThresholdMs]);

    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(flush, cfg.interCharMaxMs);
    }, [cfg.interCharMaxMs, flush]);

    useEffect(() => {
        if (options.disabled) return;

        const ignoreMatches = (el: Element | null): boolean => {
            if (!el) return false;
            // Respect explicit ignore-selector
            if (options.ignoreSelector && el.matches?.(options.ignoreSelector)) return true;
            // Always ignore textareas — multi-line free-text fields
            const tag = (el as HTMLElement).tagName;
            if (tag === 'TEXTAREA') return true;
            // contenteditable surfaces
            if ((el as HTMLElement).isContentEditable) return true;
            return false;
        };

        const handler = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;          // shortcuts pass through
            if (ignoreMatches(document.activeElement)) return;

            const now = performance.now();
            const gap = lastTsRef.current ? now - lastTsRef.current : 0;
            // If the last keystroke was long ago, start a new buffer.
            if (lastTsRef.current && gap > cfg.interCharMaxMs) {
                flush();
            }
            lastTsRef.current = now;

            // Terminators: Enter / Tab. Flush on idle, not immediately, so
            // multi-line QR payloads (v2) survive intra-payload newlines.
            if (e.key === 'Enter' || e.key === 'Tab') {
                bufferRef.current += '\n';
                if (gap > 0) gapsRef.current.push(gap);
                scheduleFlush();
                // Don't preventDefault — if focus is in a real input the user
                // may want native behaviour; we only listen, never consume.
                return;
            }

            // Single printable character
            if (e.key.length === 1) {
                bufferRef.current += e.key;
                if (gap > 0) gapsRef.current.push(gap);
                scheduleFlush();
            }
        };

        document.addEventListener('keydown', handler, true);
        return () => {
            document.removeEventListener('keydown', handler, true);
            if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
            bufferRef.current = '';
            gapsRef.current = [];
            lastTsRef.current = 0;
        };
    }, [cfg.interCharMaxMs, options.disabled, options.ignoreSelector, flush, scheduleFlush]);
}
