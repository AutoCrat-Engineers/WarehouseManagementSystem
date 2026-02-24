/**
 * StickerPrint — Industrial Packaging Sticker (v10 — QR Code, Full SCM Data).
 *
 * Design:
 *   - Clean black & white, minimal ink for thermal printers
 *   - QR Code (via `qrcode` library) — reliably scannable from medium distance
 *   - QR encodes FULL packing details: PKG ID, Part No, Description, MSL,
 *     Revision, Qty, Movement #, Box info, Date, Operator, Item Code
 *   - Optimized for 100mm × 70mm thermal label printers
 *   - Error Correction Level M (15%) — industrial grade
 */
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer } from 'lucide-react';
import type { StickerData } from '../../types/packing';

interface StickerPrintProps {
    sticker: StickerData;
    onClose: () => void;
    onPrinted: () => void;
}

// ============================================================================
// BUILD FULL QR DATA — Complete packing details, human readable when scanned
// ============================================================================

function buildQRData(sticker: StickerData): string {
    return [
        `AUTOCRAT ENGINEERS`,
        `PKG:${sticker.packingId}`,
        `MOV:${sticker.movementNumber}`,
        `PN:${sticker.partNumber}`,
        `IC:${sticker.itemCode}`,
        `DESC:${sticker.description}`,
        `MSL:${sticker.mslNo}`,
        `REV:${sticker.revision}`,
        `QTY:${sticker.boxQuantity}PCS`,
        `BOX:${sticker.boxNumber}/${sticker.totalBoxes}`,
        `TOTAL:${sticker.totalQuantity}PCS`,
        `DATE:${sticker.packingDate}`,
        `BY:${sticker.operatorName}`,
    ].join('\n');
}

// ============================================================================
// QR CODE COMPONENT — Uses `qrcode` library for reliable scanning
// ============================================================================

function QRCodeImage({ data, size = 180 }: { data: string; size?: number }) {
    const [src, setSrc] = useState<string>('');

    useEffect(() => {
        QRCode.toDataURL(data, {
            errorCorrectionLevel: 'M',   // 15% recovery — industrial grade
            width: size,
            margin: 1,
            color: { dark: '#000000', light: '#ffffff' },
        }).then(setSrc).catch(() => setSrc(''));
    }, [data, size]);

    if (!src) return <div style={{ width: size, height: size, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#999' }}>Generating...</div>;
    return <img src={src} alt="QR Code" style={{ width: size, height: size, imageRendering: 'pixelated' }} />;
}

// ============================================================================
// STICKER PRINT COMPONENT — QR Code for Supply Chain Management
// ============================================================================

export function StickerPrint({ sticker, onClose, onPrinted }: StickerPrintProps) {

    const qrData = buildQRData(sticker);
    const [qrDataUrl, setQrDataUrl] = useState<string>('');

    // Generate QR as data URL for the print window
    useEffect(() => {
        QRCode.toDataURL(qrData, {
            errorCorrectionLevel: 'M',
            width: 200,
            margin: 1,
            color: { dark: '#000000', light: '#ffffff' },
        }).then(setQrDataUrl).catch(() => setQrDataUrl(''));
    }, [qrData]);

    const handlePrint = () => {
        if (!qrDataUrl) return;
        const printWindow = window.open('', '_blank', 'width=500,height=600');
        if (!printWindow) return;

        printWindow.document.write(`<!DOCTYPE html><html><head><title>Sticker — ${sticker.packingId}</title>
<style>
  @media print {
    @page { size: 100mm 70mm; margin: 2mm; }
    body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 0; margin: 0; }

  .sticker {
    width: 100%; max-width: 376px; margin: 0 auto;
    border: 2px solid #000; overflow: hidden;
    page-break-inside: avoid;
  }

  .header {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 10px; border-bottom: 2px solid #000; background: #fff;
  }
  .header-logo { width: 24px; height: 24px; flex-shrink: 0; }
  .header-logo img { width: 100%; height: 100%; object-fit: contain; }
  .header-company {
    font-size: 12px; font-weight: 900; color: #000;
    letter-spacing: 1px; text-transform: uppercase; line-height: 1.2;
  }
  .header-sub {
    font-size: 7px; color: #666; letter-spacing: 1.5px;
    text-transform: uppercase; font-weight: 600;
  }

  .content { display: flex; border-bottom: 2px solid #000; }
  .data-side { flex: 1; min-width: 0; }
  .qr-side {
    width: 130px; flex-shrink: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 6px; border-left: 1px solid #999;
  }
  .qr-side img { width: 110px; height: 110px; image-rendering: pixelated; }
  .qr-label {
    font-size: 6px; color: #666; text-transform: uppercase;
    letter-spacing: 1px; margin-top: 2px; font-weight: 700;
  }

  .data-table { width: 100%; border-collapse: collapse; }
  .data-table td {
    padding: 3px 8px; font-size: 11px;
    border-bottom: 1px solid #ccc; vertical-align: middle; line-height: 1.3;
  }
  .data-table .lbl {
    width: 35%; font-weight: 800; font-size: 8px;
    text-transform: uppercase; letter-spacing: 0.5px;
    color: #333; border-right: 1px solid #ccc;
  }
  .data-table .val { font-weight: 600; color: #000; word-break: break-word; }
  .pkg-row td { border-bottom: 1px solid #999; }
  .pkg-row .lbl { font-weight: 900; color: #000; }
  .pkg-row .val {
    font-weight: 900; font-size: 13px;
    font-family: 'Courier New', monospace; color: #000; letter-spacing: 1px;
  }
  .qty-row td { border-top: 2px solid #000; border-bottom: none; }
  .qty-row .lbl { font-weight: 900; font-size: 9px; color: #000; }
  .qty-row .val { font-weight: 900; font-size: 20px; color: #000; letter-spacing: 0.5px; }

  .footer {
    text-align: center; font-size: 6px; color: #888;
    padding: 2px 6px; letter-spacing: 0.5px; text-transform: uppercase;
  }
</style></head><body>
<div class="sticker">
  <div class="header">
    <div class="header-logo"><img src="/a-logo.png" alt="AE" /></div>
    <div>
      <div class="header-company">Autocrat Engineers</div>
      <div class="header-sub">Packaging Sticker</div>
    </div>
  </div>

  <div class="content">
    <div class="data-side">
      <table class="data-table">
        <tr class="pkg-row"><td class="lbl">PKG ID</td><td class="val">${sticker.packingId}</td></tr>
        <tr><td class="lbl">Part No.</td><td class="val" style="font-weight:800;font-size:12px">${sticker.partNumber}</td></tr>
        <tr><td class="lbl">Description</td><td class="val">${sticker.description}</td></tr>
        <tr><td class="lbl">MSL No.</td><td class="val">${sticker.mslNo}</td></tr>
        <tr><td class="lbl">Revision</td><td class="val" style="font-weight:800">${sticker.revision}</td></tr>
        <tr class="qty-row"><td class="lbl">QTY IN BOX</td><td class="val">${sticker.boxQuantity} PCS</td></tr>
      </table>
    </div>
    <div class="qr-side">
      <img src="${qrDataUrl}" alt="QR" />
      <div class="qr-label">Scan for full details</div>
    </div>
  </div>

  <div class="footer">Auto-generated by WMS &bull; ${sticker.packingDate} &bull; ${sticker.operatorName}</div>
</div>
<script>setTimeout(()=>{window.print();window.close()},500)<\/script>
</body></html>`);
        printWindow.document.close();
        onPrinted();
    };

    // ========================================================================
    // PREVIEW MODAL
    // ========================================================================

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
        }}>
            <div style={{
                background: '#fff', borderRadius: 12, padding: 28, maxWidth: 480, width: '95%',
                boxShadow: '0 25px 50px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto',
            }}>
                {/* Preview Header */}
                <div style={{
                    margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: '#111',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <span>Sticker Preview</span>
                    <span style={{
                        fontSize: 11, fontFamily: 'Courier New, monospace', color: '#000',
                        background: '#f5f5f5', padding: '4px 10px', borderRadius: 4,
                        fontWeight: 800, border: '1px solid #ddd',
                    }}>{sticker.packingId}</span>
                </div>

                {/* Sticker Preview Card */}
                <div style={{
                    border: '2px solid #000', overflow: 'hidden',
                    marginBottom: 20, borderRadius: 4,
                }}>
                    {/* Header */}
                    <div style={{
                        background: '#fff', padding: '6px 12px',
                        display: 'flex', alignItems: 'center', gap: 8,
                        borderBottom: '2px solid #000',
                    }}>
                        <div style={{ width: 24, height: 24, flexShrink: 0 }}>
                            <img src="/a-logo.png" alt="AE" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        </div>
                        <div>
                            <div style={{
                                fontSize: 12, fontWeight: 900, color: '#000',
                                letterSpacing: '1px', textTransform: 'uppercase',
                            }}>Autocrat Engineers</div>
                            <div style={{
                                fontSize: 7, color: '#666', letterSpacing: '1.5px',
                                textTransform: 'uppercase', fontWeight: 600,
                            }}>Packaging Sticker</div>
                        </div>
                    </div>

                    {/* Content — Data + QR side by side */}
                    <div style={{ display: 'flex', borderBottom: '2px solid #000' }}>
                        {/* Data side */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <tbody>
                                    <tr>
                                        <td style={{
                                            padding: '4px 8px', fontWeight: 900, fontSize: 8,
                                            color: '#000', width: '35%',
                                            textTransform: 'uppercase', letterSpacing: '0.5px',
                                            borderBottom: '1px solid #999',
                                            borderRight: '1px solid #ccc',
                                        }}>PKG ID</td>
                                        <td style={{
                                            padding: '4px 8px', fontWeight: 900, fontSize: 13,
                                            color: '#000', fontFamily: 'Courier New, monospace',
                                            letterSpacing: '1px',
                                            borderBottom: '1px solid #999',
                                        }}>{sticker.packingId}</td>
                                    </tr>
                                    {([
                                        ['Part No.', sticker.partNumber, { fontWeight: 800, fontSize: 12 }],
                                        ['Description', sticker.description, {}],
                                        ['MSL No.', sticker.mslNo, {}],
                                        ['Revision', sticker.revision, { fontWeight: 800 }],
                                    ] as [string, string, React.CSSProperties][]).map(([lbl, val, style]) => (
                                        <tr key={lbl}>
                                            <td style={{
                                                padding: '3px 8px', fontWeight: 800, fontSize: 8,
                                                color: '#333', width: '35%',
                                                textTransform: 'uppercase', letterSpacing: '0.5px',
                                                borderBottom: '1px solid #ccc',
                                                borderRight: '1px solid #ccc',
                                            }}>{lbl}</td>
                                            <td style={{
                                                padding: '3px 8px', color: '#000', fontWeight: 600,
                                                borderBottom: '1px solid #ccc', ...style,
                                            }}>{val}</td>
                                        </tr>
                                    ))}
                                    <tr>
                                        <td style={{
                                            padding: '5px 8px', fontWeight: 900, fontSize: 9,
                                            color: '#000', width: '35%',
                                            textTransform: 'uppercase', letterSpacing: '0.5px',
                                            borderTop: '2px solid #000',
                                            borderRight: '1px solid #ccc',
                                        }}>QTY IN BOX</td>
                                        <td style={{
                                            padding: '5px 8px', fontWeight: 900, fontSize: 20, color: '#000',
                                            borderTop: '2px solid #000',
                                            letterSpacing: '0.5px',
                                        }}>{sticker.boxQuantity} PCS</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* QR Code side */}
                        <div style={{
                            width: 150, flexShrink: 0,
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            padding: 8, borderLeft: '1px solid #999',
                            background: '#fff',
                        }}>
                            <QRCodeImage data={qrData} size={130} />
                            <div style={{
                                fontSize: 6, color: '#666', textTransform: 'uppercase',
                                letterSpacing: '1px', marginTop: 3, fontWeight: 700,
                            }}>Scan for full details</div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div style={{
                        textAlign: 'center', fontSize: 6, color: '#888',
                        padding: '3px 6px',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                    }}>
                        Auto-generated by WMS &bull; {sticker.packingDate} &bull; {sticker.operatorName}
                    </div>
                </div>



                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={onClose} style={{
                        flex: 1, padding: '11px 16px', borderRadius: 6,
                        border: '1px solid #d1d5db', background: '#fff',
                        fontWeight: 600, cursor: 'pointer', fontSize: 13,
                        color: '#374151', transition: 'all 0.15s',
                    }}>Cancel</button>
                    <button onClick={handlePrint} style={{
                        flex: 1, padding: '11px 16px', borderRadius: 6,
                        border: 'none', background: '#1e3a8a', color: '#fff',
                        fontWeight: 700, cursor: 'pointer', fontSize: 13,
                        transition: 'all 0.15s',
                        boxShadow: '0 2px 4px rgba(30,58,138,0.3)',
                        opacity: qrDataUrl ? 1 : 0.5,
                    }} disabled={!qrDataUrl}><Printer size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Print Sticker</button>
                </div>
            </div>
        </div>
    );
}
