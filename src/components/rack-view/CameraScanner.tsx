/**
 * CameraScanner — viewport + camera-driven QR decoder.
 *
 * Strategy:
 *   1. Prefer the native `BarcodeDetector` API (Chrome on Android/desktop,
 *      Edge — fast, low-CPU, no library load).
 *   2. Fall back to `@zxing/browser` for iOS Safari / Firefox.
 *
 * The component owns the <video> stream. On unmount it stops every track
 * so the camera light goes off — important on mobile.
 *
 * UX rules (mobile-first):
 *   - Big aim reticle so the receiver can frame the QR without thinking.
 *   - Torch toggle for dim docks (only shown if the device exposes it).
 *   - Cooldown after a successful decode so one QR doesn't fire ten scans.
 *   - Audio + haptic cue is the parent's responsibility (scanFeedback) — this
 *     component is decode-only.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Flashlight, FlashlightOff, X, Loader2, AlertCircle } from 'lucide-react';

interface Props {
    onScan:   (text: string) => void;
    onClose:  () => void;
    /** Cooldown after a decoded scan before the next one can fire. Default 1500ms. */
    cooldownMs?: number;
}

interface BarcodeDetectorCtor {
    new (init?: { formats?: string[] }): BarcodeDetectorInstance;
    getSupportedFormats?: () => Promise<string[]>;
}
interface BarcodeDetectorInstance {
    detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

declare global {
    interface Window { BarcodeDetector?: BarcodeDetectorCtor; }
}

export function CameraScanner({ onScan, onClose, cooldownMs = 1500 }: Props) {
    const videoRef  = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const stopFnRef = useRef<(() => void) | null>(null);
    const lastEmitRef = useRef<{ text: string; at: number } | null>(null);

    const [status, setStatus] = useState<'starting' | 'running' | 'error'>('starting');
    const [error, setError]   = useState<string | null>(null);
    const [torchAvailable, setTorchAvailable] = useState(false);
    const [torchOn, setTorchOn] = useState(false);

    // Emit guard — prevents a single QR firing repeatedly while held in view.
    // Auto-closes the overlay after a decode so the receiver doesn't have to
    // tap X for every pallet. The result (success / banner / row flash) lands
    // in the ScanBar like any wedge or manual scan would.
    const emit = useCallback((text: string) => {
        const t = (text ?? '').trim();
        if (!t) return;
        const last = lastEmitRef.current;
        const now = Date.now();
        if (last && last.text === t && now - last.at < cooldownMs) return;
        lastEmitRef.current = { text: t, at: now };
        onScan(t);
        // Brief delay so the user perceives the decode happened (camera frame
        // freezes momentarily on most devices) before the overlay tears down.
        setTimeout(() => { try { onClose(); } catch { /* */ } }, 250);
    }, [onScan, cooldownMs, onClose]);

    // ── Camera bring-up ─────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;

        async function start() {
            // Browsers block getUserMedia on insecure origins (HTTP, except
            // localhost). When the page is served over plain HTTP, the
            // navigator.mediaDevices object is undefined — and the resulting
            // "Camera not supported" message misleads operators into thinking
            // the device is at fault. Detect insecure context up-front and
            // surface the actual cause: HTTPS is required.
            if (typeof window !== 'undefined' && window.isSecureContext === false) {
                setError('Camera needs a secure (HTTPS) connection. Ask IT to enable HTTPS on this server, then reload.');
                setStatus('error');
                return;
            }
            if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
                setError('Camera not available in this browser. If the URL starts with "http://", HTTPS is required.');
                setStatus('error');
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false,
                });
                if (cancelled) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }
                streamRef.current = stream;

                const v = videoRef.current;
                if (v) {
                    v.srcObject = stream;
                    v.setAttribute('playsinline', 'true');    // iOS Safari
                    v.muted = true;
                    await v.play().catch(() => { /* autoplay race; user can tap to retry */ });
                }

                // Probe torch capability
                const track = stream.getVideoTracks()[0];
                const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
                if (caps.torch) setTorchAvailable(true);

                // Pick a decode loop
                stopFnRef.current = await runDecodeLoop(v!, emit);
                if (!cancelled) setStatus('running');
            } catch (e: any) {
                if (cancelled) return;
                const msg = e?.name === 'NotAllowedError'
                    ? 'Camera permission denied. Allow camera access and reload.'
                    : (e?.message ?? 'Could not start camera.');
                setError(msg);
                setStatus('error');
            }
        }

        void start();
        return () => {
            cancelled = true;
            if (stopFnRef.current) { try { stopFnRef.current(); } catch { /* */ } stopFnRef.current = null; }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => { try { t.stop(); } catch { /* */ } });
                streamRef.current = null;
            }
        };
    }, [emit]);

    // ── Torch toggle ────────────────────────────────────────────────────
    const toggleTorch = useCallback(async () => {
        const track = streamRef.current?.getVideoTracks()[0];
        if (!track) return;
        try {
            const next = !torchOn;
            await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet & { torch: boolean }] });
            setTorchOn(next);
        } catch {
            setTorchAvailable(false);
        }
    }, [torchOn]);

    return (
        <div style={overlayStyle} onClick={onClose}>
            <div style={frameStyle} onClick={(e) => e.stopPropagation()}>
                <video ref={videoRef} style={videoStyle} playsInline muted />

                {/* Aim reticle */}
                <div style={reticleStyle} aria-hidden>
                    <div style={cornerTL} />
                    <div style={cornerTR} />
                    <div style={cornerBL} />
                    <div style={cornerBR} />
                </div>

                {/* Top-left status pill */}
                <div style={statusPillStyle}>
                    {status === 'starting' && <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Starting camera…</>}
                    {status === 'running'  && <><Camera size={12} /> Aim at a pallet QR</>}
                    {status === 'error'    && <><AlertCircle size={12} /> Camera error</>}
                </div>

                {/* Torch */}
                {torchAvailable && status === 'running' && (
                    <button onClick={toggleTorch} style={torchBtnStyle} title={torchOn ? 'Turn torch off' : 'Turn torch on'}>
                        {torchOn ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
                    </button>
                )}

                {/* Close */}
                <button onClick={onClose} style={closeBtnStyle} aria-label="Close camera">
                    <X size={18} />
                </button>

                {error && (
                    <div style={errorStyle}>
                        <AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{error}
                    </div>
                )}
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Decode loop — native first, zxing fallback
// ───────────────────────────────────────────────────────────────────────────
//
// Returns a `stop()` function that the caller invokes on unmount.
async function runDecodeLoop(video: HTMLVideoElement, emit: (text: string) => void): Promise<() => void> {
    // Native BarcodeDetector path
    if (typeof window !== 'undefined' && window.BarcodeDetector) {
        try {
            const formats = (await window.BarcodeDetector.getSupportedFormats?.()) ?? [];
            if (formats.length === 0 || formats.includes('qr_code')) {
                const detector = new window.BarcodeDetector!({ formats: ['qr_code'] });
                let raf = 0;
                let stopped = false;
                const tick = async () => {
                    if (stopped) return;
                    if (video.readyState >= 2) {
                        try {
                            const found = await detector.detect(video);
                            if (found.length > 0) emit(found[0].rawValue);
                        } catch { /* frame decode error — keep looping */ }
                    }
                    raf = requestAnimationFrame(tick);
                };
                raf = requestAnimationFrame(tick);
                return () => { stopped = true; cancelAnimationFrame(raf); };
            }
        } catch { /* fall through to zxing */ }
    }

    // zxing fallback — iOS Safari / Firefox
    const zxing = await import('@zxing/browser');
    const reader = new zxing.BrowserQRCodeReader();
    const controls = await reader.decodeFromVideoElement(video, (result) => {
        if (result) emit(result.getText());
    });
    return () => { try { controls.stop(); } catch { /* */ } };
}

// ───────────────────────────────────────────────────────────────────────────
// Styles — full-screen overlay, mobile-first reticle
// ───────────────────────────────────────────────────────────────────────────
const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const frameStyle: React.CSSProperties = {
    position: 'relative', width: '100%', height: '100%', maxWidth: 720, maxHeight: '100%',
    overflow: 'hidden',
};
const videoStyle: React.CSSProperties = {
    width: '100%', height: '100%', objectFit: 'cover', background: '#000',
};
const reticleStyle: React.CSSProperties = {
    position: 'absolute',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(70vw, 320px)', height: 'min(70vw, 320px)',
    pointerEvents: 'none',
};
const cornerBase: React.CSSProperties = {
    position: 'absolute', width: 36, height: 36, borderColor: '#22c55e', borderStyle: 'solid', borderWidth: 0,
};
const cornerTL: React.CSSProperties = { ...cornerBase, top: 0, left: 0,    borderTopWidth: 4, borderLeftWidth: 4,  borderTopLeftRadius: 6 };
const cornerTR: React.CSSProperties = { ...cornerBase, top: 0, right: 0,   borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 6 };
const cornerBL: React.CSSProperties = { ...cornerBase, bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4,  borderBottomLeftRadius: 6 };
const cornerBR: React.CSSProperties = { ...cornerBase, bottom: 0, right: 0,borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 6 };

const statusPillStyle: React.CSSProperties = {
    position: 'absolute', top: 16, left: 16,
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', borderRadius: 999,
    background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 12, fontWeight: 600,
    backdropFilter: 'blur(6px)',
};
const torchBtnStyle: React.CSSProperties = {
    position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)', left: '50%', transform: 'translateX(-50%)',
    width: 56, height: 56, borderRadius: '50%',
    background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', backdropFilter: 'blur(6px)',
};
const closeBtnStyle: React.CSSProperties = {
    position: 'absolute', top: 16, right: 16,
    width: 40, height: 40, borderRadius: '50%',
    background: 'rgba(0,0,0,0.55)', color: 'white', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', backdropFilter: 'blur(6px)',
};
const errorStyle: React.CSSProperties = {
    position: 'absolute', bottom: 32, left: 16, right: 16,
    padding: 12, borderRadius: 8,
    background: 'rgba(220,38,38,0.92)', color: 'white', fontSize: 13, fontWeight: 600,
    textAlign: 'center',
};
