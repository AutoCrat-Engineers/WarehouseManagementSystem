/**
 * ExceptionSheet — audit-grade discrepancy capture for DAMAGED pallets.
 *
 * Mobile-first bottom sheet. Required: reason code + note. Photos are
 * strongly encouraged (camera-capture button on mobile) but not blocking;
 * an ops team can require ≥1 photo by tightening the submit guard.
 *
 * Photos upload to `gr-exception-photos` storage as soon as the user picks
 * them — eager upload means the user can leave the sheet without re-uploading
 * on the next visit. Discarded photos are best-effort cleaned up.
 *
 * Save is local: the sheet returns a draft snapshot; the GR commit happens
 * later when the receiver submits the whole MPL.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    X, Camera, Upload, Loader2, Trash2, AlertCircle, ImageIcon, ChevronDown,
} from 'lucide-react';
import {
    REASON_CODES, getReasonCode, uploadExceptionPhoto, deleteExceptionPhoto,
    getPhotoSignedUrl,
    type ReasonCode,
} from './receiveService';

export interface ExceptionDraft {
    reason_code: string;
    note:        string;
    photo_paths: string[];
}

interface Props {
    /** Pallet identity for display + storage path partitioning. */
    proformaInvoiceId: string;
    mplId:             string;
    palletId:          string;
    palletNumber:      string | null;
    partNumber:        string | null;

    /** Pre-existing draft (when reopening a previously-marked DAMAGED pallet). */
    initial?: Partial<ExceptionDraft>;

    onCancel:  () => void;
    onSubmit:  (draft: ExceptionDraft) => void;
}

export function ExceptionSheet({
    proformaInvoiceId, mplId, palletId, palletNumber, partNumber,
    initial, onCancel, onSubmit,
}: Props) {
    const [reasonCode, setReasonCode] = useState<string>(initial?.reason_code ?? '');
    const [note, setNote] = useState<string>(initial?.note ?? '');
    const [photoPaths, setPhotoPaths] = useState<string[]>(initial?.photo_paths ?? []);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const cameraInputRef = useRef<HTMLInputElement | null>(null);

    const reason = useMemo(() => getReasonCode(reasonCode), [reasonCode]);

    const valid = reasonCode.trim().length > 0 && note.trim().length > 0;

    const handleFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setError(null);
        setUploading(true);
        const newlyUploaded: string[] = [];
        try {
            for (const file of Array.from(files)) {
                const result = await uploadExceptionPhoto({
                    proformaInvoiceId, mplId, palletId,
                    file, filename: file.name,
                });
                if (result.kind === 'ok') {
                    newlyUploaded.push(result.path);
                } else {
                    setError(result.message);
                    break;
                }
            }
        } finally {
            setUploading(false);
        }
        if (newlyUploaded.length > 0) {
            setPhotoPaths(prev => [...prev, ...newlyUploaded]);
        }
    }, [proformaInvoiceId, mplId, palletId]);

    const removePhoto = useCallback(async (path: string) => {
        // Optimistic remove from local state first.
        setPhotoPaths(prev => prev.filter(p => p !== path));
        // Best-effort storage cleanup. If it fails the orphan stays — harmless.
        void deleteExceptionPhoto(path);
    }, []);

    return (
        <div style={backdropStyle} onClick={onCancel}>
            <div style={sheetStyle} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                {/* Drag handle */}
                <div style={handleStyle} aria-hidden />

                {/* Header */}
                <div style={headerStyle}>
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', color: '#dc2626', textTransform: 'uppercase' }}>
                            Mark Damaged
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>
                            {palletNumber ?? '—'}
                            {partNumber && <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8, fontFamily: 'monospace' }}>{partNumber}</span>}
                        </div>
                    </div>
                    <button onClick={onCancel} aria-label="Close" style={closeBtnStyle}>
                        <X size={20} />
                    </button>
                </div>

                {/* Body — scrolls if photos overflow */}
                <div style={bodyStyle}>
                    {/* Reason */}
                    <Field label="Reason" required>
                        <ReasonPicker value={reasonCode} onChange={setReasonCode} />
                        {reason && (
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6, lineHeight: 1.4 }}>
                                {reason.description}
                            </div>
                        )}
                    </Field>

                    {/* Note */}
                    <Field label="Note" required>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder={reason?.code === 'OTHER'
                                ? 'Describe what was wrong (required for "Other").'
                                : 'Anything specific the auditor should know.'}
                            rows={3}
                            data-no-scan="true"
                            style={textareaStyle}
                        />
                    </Field>

                    {/* Photos */}
                    <Field label={`Photos${photoPaths.length > 0 ? ` (${photoPaths.length})` : ''}`}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, marginBottom: 10 }}>
                            {photoPaths.map((p) => (
                                <PhotoThumb key={p} path={p} onRemove={() => removePhoto(p)} />
                            ))}
                            {uploading && (
                                <div style={uploadingThumbStyle}>
                                    <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: '#64748b' }} />
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                type="button"
                                onClick={() => cameraInputRef.current?.click()}
                                disabled={uploading}
                                style={photoBtnPrimary}
                            >
                                <Camera size={16} /> Take photo
                            </button>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                style={photoBtnSecondary}
                            >
                                <Upload size={16} /> Upload
                            </button>
                        </div>
                        {/* Camera (mobile) — capture attribute hints native camera */}
                        <input
                            ref={cameraInputRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            multiple
                            style={{ display: 'none' }}
                            onChange={(e) => { void handleFiles(e.target.files); e.target.value = ''; }}
                        />
                        {/* Gallery / desktop file picker */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                            multiple
                            style={{ display: 'none' }}
                            onChange={(e) => { void handleFiles(e.target.files); e.target.value = ''; }}
                        />
                    </Field>

                    {error && (
                        <div style={errorBannerStyle}>
                            <AlertCircle size={14} /> {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={footerStyle}>
                    <button onClick={onCancel} style={ghostBtnStyle}>Cancel</button>
                    <button
                        onClick={() => onSubmit({ reason_code: reasonCode, note: note.trim(), photo_paths: photoPaths })}
                        disabled={!valid || uploading}
                        style={{ ...primaryBtnStyle, opacity: !valid || uploading ? 0.5 : 1, cursor: !valid || uploading ? 'not-allowed' : 'pointer' }}
                    >
                        {uploading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                        Mark damaged
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Subcomponents ───────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>
                {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
            </label>
            {children}
        </div>
    );
}

function ReasonPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div style={{ position: 'relative' }}>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                data-no-scan="true"
                style={selectStyle}
            >
                <option value="" disabled>Select a reason…</option>
                {groupReasonsByCategory(REASON_CODES).map(([cat, items]) => (
                    <optgroup key={cat} label={categoryLabel(cat)}>
                        {items.map(r => (
                            <option key={r.code} value={r.code}>{r.label}</option>
                        ))}
                    </optgroup>
                ))}
            </select>
            <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
        </div>
    );
}

function PhotoThumb({ path, onRemove }: { path: string; onRemove: () => void }) {
    const [src, setSrc] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        getPhotoSignedUrl(path, 300).then((u) => { if (!cancelled) setSrc(u); });
        return () => { cancelled = true; };
    }, [path]);

    return (
        <div style={photoThumbStyle}>
            {src ? (
                <img src={src} alt="exception evidence" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
                <ImageIcon size={20} style={{ color: '#94a3b8' }} />
            )}
            <button onClick={onRemove} aria-label="Remove photo" style={photoRemoveBtnStyle}>
                <Trash2 size={12} />
            </button>
        </div>
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function groupReasonsByCategory(items: readonly ReasonCode[]): [ReasonCode['category'], ReasonCode[]][] {
    const byCat = new Map<ReasonCode['category'], ReasonCode[]>();
    for (const r of items) {
        if (!byCat.has(r.category)) byCat.set(r.category, []);
        byCat.get(r.category)!.push(r);
    }
    return Array.from(byCat.entries());
}

function categoryLabel(cat: ReasonCode['category']): string {
    if (cat === 'PHYSICAL') return 'Physical damage';
    if (cat === 'QUALITY')  return 'Quality issue';
    return 'Other';
}

// ─── Styles ──────────────────────────────────────────────────────────────

const backdropStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1050,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
};
const sheetStyle: React.CSSProperties = {
    background: 'white',
    width: '100%', maxWidth: 560,
    maxHeight: '92vh',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    boxShadow: '0 -12px 40px rgba(0,0,0,0.25)',
    display: 'flex', flexDirection: 'column',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
};
const handleStyle: React.CSSProperties = {
    width: 40, height: 4, background: '#cbd5e1', borderRadius: 2,
    margin: '8px auto 4px',
};
const headerStyle: React.CSSProperties = {
    padding: '10px 18px 12px',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    borderBottom: '1px solid #e2e8f0',
};
const closeBtnStyle: React.CSSProperties = {
    width: 36, height: 36, borderRadius: 8,
    background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const bodyStyle: React.CSSProperties = {
    padding: 18, overflowY: 'auto', flex: 1, minHeight: 0,
};
const footerStyle: React.CSSProperties = {
    padding: '12px 18px',
    borderTop: '1px solid #e2e8f0',
    display: 'flex', gap: 8, justifyContent: 'flex-end',
};
const selectStyle: React.CSSProperties = {
    width: '100%', padding: '12px 36px 12px 12px',
    fontSize: 14, color: '#0f172a', appearance: 'none',
    border: '1.5px solid #cbd5e1', borderRadius: 10,
    background: 'white', outline: 'none', boxSizing: 'border-box',
};
const textareaStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    fontSize: 14, fontFamily: 'inherit',
    border: '1.5px solid #cbd5e1', borderRadius: 10, outline: 'none',
    boxSizing: 'border-box', resize: 'vertical',
};
const photoBtnPrimary: React.CSSProperties = {
    flex: 1, padding: '10px 14px',
    fontSize: 13, fontWeight: 600,
    background: '#0f172a', color: 'white', border: 'none', borderRadius: 10,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};
const photoBtnSecondary: React.CSSProperties = {
    flex: 1, padding: '10px 14px',
    fontSize: 13, fontWeight: 600,
    background: 'white', color: '#0f172a', border: '1.5px solid #cbd5e1', borderRadius: 10,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};
const photoThumbStyle: React.CSSProperties = {
    position: 'relative', aspectRatio: '1 / 1',
    background: '#f1f5f9', borderRadius: 8, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const photoRemoveBtnStyle: React.CSSProperties = {
    position: 'absolute', top: 4, right: 4,
    width: 24, height: 24, borderRadius: '50%',
    background: 'rgba(15,23,42,0.7)', color: 'white', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
};
const uploadingThumbStyle: React.CSSProperties = {
    aspectRatio: '1 / 1', background: '#f1f5f9', borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const errorBannerStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 8,
    background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5',
    fontSize: 12, fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 8,
};
const ghostBtnStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: 13, fontWeight: 600,
    color: '#64748b', background: 'transparent', border: 'none',
    cursor: 'pointer',
};
const primaryBtnStyle: React.CSSProperties = {
    padding: '10px 18px', fontSize: 13, fontWeight: 700,
    color: 'white', background: '#dc2626', border: 'none', borderRadius: 10,
    display: 'flex', alignItems: 'center', gap: 6,
};
