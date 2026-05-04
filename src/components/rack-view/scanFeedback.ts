/**
 * scanFeedback — small audio + haptic cues for scan outcomes.
 *
 * No external assets; tones synthesized via Web Audio API. Single shared
 * AudioContext lazily created on first use (browsers require a user
 * gesture before audio can play; the first scan satisfies that).
 *
 * On non-supporting devices (no AudioContext, no vibration), all calls
 * silently no-op.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (ctx) return ctx;
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch { ctx = null; }
    return ctx;
}

function beep(freq: number, durationMs: number, when = 0): void {
    const ac = getCtx();
    if (!ac) return;
    try {
        const t0 = ac.currentTime + when;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        // ADSR — keep it short and percussive
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.18, t0 + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
        osc.connect(gain).connect(ac.destination);
        osc.start(t0);
        osc.stop(t0 + durationMs / 1000 + 0.02);
    } catch { /* swallow */ }
}

function vibrate(pattern: number | number[]): void {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
    try { (navigator as any).vibrate(pattern); } catch { /* swallow */ }
}

export const scanFeedback = {
    /** Crisp single beep — pallet successfully matched. */
    success(): void {
        beep(1320, 90);
        vibrate(20);
    },
    /** Lower thunk — duplicate scan, soft warning. */
    duplicate(): void {
        beep(660, 120);
        vibrate(40);
    },
    /** Two-tone descending — error (not found, wrong shipment, ambiguous, invalid). */
    error(): void {
        beep(440, 120, 0);
        beep(220, 160, 0.13);
        vibrate([60, 50, 60]);
    },
};
