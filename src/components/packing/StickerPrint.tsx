/**
 * StickerPrint — Professional FG Packing Sticker (v5).
 *
 * Features:
 *   - Company logo header (AUTOCRAT ENGINEERS)
 *   - Code 128 barcode (scannable)
 *   - All product info: Part No, Description, MSL, Revision
 *   - Per-box Packing ID: PKG-XXXXXXXX (unique per box)
 *   - Movement reference for traceability
 *   - Box info: Box #, Quantity, Date, Operator
 *   - Barcode encodes: PKG#|PartNo|Rev|BoxN|Qty|Date
 *   - No exposed UUIDs or internal IDs
 */
import React from 'react';
import type { StickerData } from '../../types/packing';

interface StickerPrintProps {
    sticker: StickerData;
    onClose: () => void;
    onPrinted: () => void;
}

// ============================================================================
// CODE 128 BARCODE GENERATOR
// ============================================================================

const CODE128_PATTERNS: string[] = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
    '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
    '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
    '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
    '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
    '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
    '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
    '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
    '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
    '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
    '114311', '411113', '411311', '113141', '114131', '311141', '411131',
    '211412', '211214', '211232', '2331112',
];

function generateBarcodeSVG(text: string, width: number = 300, height: number = 50): string {
    // Encode using Code 128B
    const values: number[] = [104]; // Start Code B
    for (const ch of text) {
        const val = ch.charCodeAt(0) - 32;
        if (val >= 0 && val <= 94) values.push(val);
    }

    // Calculate checksum
    let checksum = values[0];
    for (let i = 1; i < values.length; i++) {
        checksum += i * values[i];
    }
    checksum %= 103;
    values.push(checksum);
    values.push(106); // Stop

    // Convert patterns to binary modules
    const modules: boolean[] = [];
    for (const val of values) {
        const pattern = CODE128_PATTERNS[val];
        if (!pattern) continue;
        for (let i = 0; i < pattern.length; i++) {
            const w = parseInt(pattern[i]);
            const isBar = i % 2 === 0;
            for (let j = 0; j < w; j++) {
                modules.push(isBar);
            }
        }
    }
    // Termination bar
    modules.push(true, true);

    // Generate SVG
    const totalModules = modules.length;
    const moduleWidth = width / totalModules;
    let rects = '';
    let barStart = -1;
    for (let i = 0; i <= totalModules; i++) {
        if (i < totalModules && modules[i]) {
            if (barStart < 0) barStart = i;
        } else {
            if (barStart >= 0) {
                const bw = (i - barStart) * moduleWidth;
                rects += `<rect x="${(barStart * moduleWidth).toFixed(2)}" y="0" width="${bw.toFixed(2)}" height="${height}" fill="#000"/>`;
                barStart = -1;
            }
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${rects}</svg>`;
}

// React barcode component for preview
function BarcodePreview({ data, width = 280, height = 45 }: { data: string; width?: number; height?: number }) {
    const svg = generateBarcodeSVG(data, width, height);
    return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ============================================================================
// BUILD BARCODE DATA STRING
// Encodes key info for scanning: PKG#|PartNo|Rev|Box/Total|Qty|Date
// ============================================================================

function buildBarcodeData(sticker: StickerData): string {
    const rev = sticker.revision && sticker.revision !== '—' ? sticker.revision : '';
    return [
        sticker.packingId,
        sticker.partNumber,
        rev ? `R:${rev}` : '',
        `B${sticker.boxNumber}/${sticker.totalBoxes}`,
        `${sticker.boxQuantity}PCS`,
        sticker.packingDate.replace(/\//g, ''),
    ].filter(Boolean).join('|');
}

// ============================================================================
// STICKER PRINT COMPONENT
// ============================================================================

export function StickerPrint({ sticker, onClose, onPrinted }: StickerPrintProps) {

    const barcodeData = buildBarcodeData(sticker);
    const barcodeSVG = generateBarcodeSVG(barcodeData, 320, 55);

    const handlePrint = () => {
        const printWindow = window.open('', '_blank', 'width=550,height=700');
        if (!printWindow) return;

        printWindow.document.write(`<!DOCTYPE html><html><head><title>Packing Sticker — ${sticker.packingId}</title>
<style>
  @media print { @page { size: 100mm 80mm; margin: 3mm; } body { margin: 0; } }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; padding: 6px; margin: 0; }

  .sticker {
    border: 2px solid #000; border-radius: 4px; overflow: hidden;
    width: 100%; max-width: 380px; margin: 0 auto;
  }

  /* Company Header */
  .company-header {
    background: #1e3a8a; color: #fff; padding: 8px 12px;
    text-align: center; border-bottom: 2px solid #000;
  }
  .company-name {
    font-size: 15px; font-weight: 900; letter-spacing: 1.5px;
    text-transform: uppercase; margin: 0;
  }
  .company-sub {
    font-size: 8px; letter-spacing: 2px; opacity: 0.8;
    text-transform: uppercase; margin-top: 1px;
  }

  /* Info Table */
  .info-table { width: 100%; border-collapse: collapse; }
  .info-table td {
    padding: 3px 8px; border-bottom: 1px solid #ccc;
    font-size: 10px; vertical-align: top;
  }
  .info-table .lbl {
    font-weight: 700; background: #f5f5f5; width: 32%;
    text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px;
    color: #333;
  }
  .info-table .val { font-weight: 500; color: #111; }

  /* Box Highlight */
  .box-row td {
    background: #fef9c3; border-bottom: 2px solid #000;
    padding: 5px 8px;
  }
  .box-row .val {
    font-size: 16px; font-weight: 900; color: #000;
  }
  .box-row .lbl {
    background: #fef9c3; font-weight: 800;
  }

  /* Barcode Section */
  .barcode-section {
    text-align: center; padding: 6px 12px 5px;
    border-top: 1px solid #ccc;
    background: #fff;
  }
  .barcode-section svg { max-width: 100%; height: auto; }
  .barcode-text {
    font-size: 8px; font-family: 'Courier New', monospace;
    color: #333; margin-top: 2px; letter-spacing: 0.5px;
    word-break: break-all;
  }
  .scan-label {
    font-size: 7px; text-transform: uppercase; letter-spacing: 1px;
    color: #999; margin-bottom: 3px;
  }

  /* Footer */
  .footer {
    text-align: center; font-size: 7px; color: #999;
    padding: 3px; border-top: 1px solid #eee;
    background: #fafafa;
  }
</style></head><body>
<div class="sticker">
  <!-- Company Logo Header -->
  <div class="company-header">
    <div class="company-name">AUTOCRAT ENGINEERS</div>
    <div class="company-sub">Warehouse Management System</div>
  </div>

  <!-- Product & Reference Info -->
  <table class="info-table">
    <tr><td class="lbl">Packing ID</td><td class="val" style="font-weight:800;font-family:monospace;color:#7c3aed">${sticker.packingId}</td></tr>
    <tr><td class="lbl">Part Number</td><td class="val" style="font-weight:700">${sticker.partNumber}</td></tr>
    <tr><td class="lbl">Description</td><td class="val">${sticker.description}</td></tr>
    <tr><td class="lbl">MSL No</td><td class="val">${sticker.mslNo}</td></tr>
    <tr><td class="lbl">Revision</td><td class="val" style="font-weight:700;color:#7c3aed">${sticker.revision}</td></tr>
    <tr><td class="lbl">Movement Ref</td><td class="val">${sticker.movementNumber}</td></tr>
    <tr class="box-row"><td class="lbl">BOX</td><td class="val">BOX #${sticker.boxNumber} of ${sticker.totalBoxes}</td></tr>
    <tr class="box-row"><td class="lbl">QUANTITY</td><td class="val">${sticker.boxQuantity} PCS (Total: ${sticker.totalQuantity})</td></tr>
    <tr><td class="lbl">Packing Date</td><td class="val">${sticker.packingDate}</td></tr>
    <tr><td class="lbl">Packed By</td><td class="val">${sticker.operatorName}</td></tr>
  </table>

  <!-- Barcode -->
  <div class="barcode-section">
    <div class="scan-label">Scan for traceability</div>
    ${barcodeSVG}
    <div class="barcode-text">${barcodeData}</div>
  </div>

  <!-- Footer -->
  <div class="footer">Auto-generated by WMS Packing Module &bull; Do not handwrite</div>
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
                background: '#fff', borderRadius: 8, padding: 24, maxWidth: 460, width: '95%',
                boxShadow: '0 25px 50px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto',
            }}>
                {/* Preview Header */}
                <div style={{
                    margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: '#111827',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <span>Sticker Preview — Box #{sticker.boxNumber}</span>
                    <span style={{
                        fontSize: 11, fontFamily: 'monospace', color: '#7c3aed',
                        background: '#f5f3ff', padding: '3px 8px', borderRadius: 3,
                    }}>{sticker.packingId}</span>
                </div>

                {/* Sticker Preview Card */}
                <div style={{
                    border: '2px solid #1e3a8a', borderRadius: 6, overflow: 'hidden',
                    marginBottom: 16,
                }}>
                    {/* Logo Header */}
                    <div style={{
                        background: '#1e3a8a', color: '#fff', padding: '8px 14px', textAlign: 'center',
                    }}>
                        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: '1.5px' }}>AUTOCRAT ENGINEERS</div>
                        <div style={{ fontSize: 8, letterSpacing: '2px', opacity: 0.8 }}>WAREHOUSE MANAGEMENT SYSTEM</div>
                    </div>

                    {/* Info Rows */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <tbody>
                            {([
                                ['Packing ID', sticker.packingId, { fontWeight: 800, fontFamily: 'monospace', color: '#7c3aed' }],
                                ['Part Number', sticker.partNumber, { fontWeight: 700 }],
                                ['Description', sticker.description, {}],
                                ['MSL No', sticker.mslNo, {}],
                                ['Revision', sticker.revision, { fontWeight: 700, color: '#7c3aed' }],
                                ['Movement Ref', sticker.movementNumber, {}],
                            ] as [string, string, React.CSSProperties][]).map(([lbl, val, style]) => (
                                <tr key={lbl}>
                                    <td style={{
                                        padding: '4px 10px', fontWeight: 700, fontSize: 10,
                                        color: '#555', background: '#f9fafb', width: '35%',
                                        textTransform: 'uppercase', letterSpacing: '0.5px',
                                        borderBottom: '1px solid #e5e7eb',
                                    }}>{lbl}</td>
                                    <td style={{
                                        padding: '4px 10px', color: '#111',
                                        borderBottom: '1px solid #e5e7eb', ...style,
                                    }}>{val}</td>
                                </tr>
                            ))}
                            {/* Box highlight rows */}
                            <tr>
                                <td style={{
                                    padding: '5px 10px', fontWeight: 800, fontSize: 10,
                                    color: '#333', background: '#fef9c3', width: '35%',
                                    textTransform: 'uppercase', borderBottom: '2px solid #000',
                                }}>BOX</td>
                                <td style={{
                                    padding: '5px 10px', fontWeight: 900, fontSize: 16, color: '#000',
                                    background: '#fef9c3', borderBottom: '2px solid #000',
                                }}>BOX #{sticker.boxNumber} of {sticker.totalBoxes}</td>
                            </tr>
                            <tr>
                                <td style={{
                                    padding: '5px 10px', fontWeight: 800, fontSize: 10,
                                    color: '#333', background: '#fef9c3', width: '35%',
                                    textTransform: 'uppercase', borderBottom: '2px solid #000',
                                }}>QUANTITY</td>
                                <td style={{
                                    padding: '5px 10px', fontWeight: 900, fontSize: 16, color: '#000',
                                    background: '#fef9c3', borderBottom: '2px solid #000',
                                }}>{sticker.boxQuantity} PCS (Total: {sticker.totalQuantity})</td>
                            </tr>
                            <tr>
                                <td style={{
                                    padding: '4px 10px', fontWeight: 700, fontSize: 10,
                                    color: '#555', background: '#f9fafb', width: '35%',
                                    textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb',
                                }}>Date</td>
                                <td style={{ padding: '4px 10px', borderBottom: '1px solid #e5e7eb' }}>{sticker.packingDate}</td>
                            </tr>
                            <tr>
                                <td style={{
                                    padding: '4px 10px', fontWeight: 700, fontSize: 10,
                                    color: '#555', background: '#f9fafb', width: '35%',
                                    textTransform: 'uppercase',
                                }}>Packed By</td>
                                <td style={{ padding: '4px 10px' }}>{sticker.operatorName}</td>
                            </tr>
                        </tbody>
                    </table>

                    {/* Barcode Preview */}
                    <div style={{
                        textAlign: 'center', padding: '8px 16px 6px',
                        borderTop: '1px solid #e5e7eb', background: '#fff',
                    }}>
                        <div style={{ fontSize: 8, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>
                            Scan for Traceability
                        </div>
                        <BarcodePreview data={barcodeData} width={280} height={45} />
                        <div style={{
                            fontSize: 9, fontFamily: 'Courier New, monospace', color: '#555',
                            marginTop: 2, wordBreak: 'break-all',
                        }}>
                            {barcodeData}
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={onClose} style={{
                        flex: 1, padding: '10px 16px', borderRadius: 4,
                        border: '1px solid #d1d5db', background: '#fff',
                        fontWeight: 600, cursor: 'pointer', fontSize: 13,
                        color: '#374151',
                    }}>Cancel</button>
                    <button onClick={handlePrint} style={{
                        flex: 1, padding: '10px 16px', borderRadius: 4,
                        border: 'none', background: '#1e3a8a', color: '#fff',
                        fontWeight: 600, cursor: 'pointer', fontSize: 13,
                    }}>Print Sticker</button>
                </div>
            </div>
        </div>
    );
}
