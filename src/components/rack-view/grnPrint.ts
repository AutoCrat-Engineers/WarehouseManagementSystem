/**
 * grnPrint — Goods Receipt outputs.
 *
 * Two pure helpers, both `window.open` + write HTML + trigger print:
 *   - printGrn()           — formal A4 GR document (header, line table, sign-off)
 *   - printPutawayLabels() — one 100×70mm thermal label per RECEIVED/DAMAGED pallet,
 *                            each with a v2-format pallet QR
 *
 * No React rendering — matches the pattern in MasterPackingListHome / StickerPrint
 * (popup window + window.print()), so the browser handles paper sizing & dialog.
 */
import QRCode from 'qrcode';

// ───────────────────────────────────────────────────────────────────────────
// Types — narrow snapshots of what the receive screen already has in memory
// at the moment of GR commit. No round-trip to the server needed.
// ───────────────────────────────────────────────────────────────────────────

export interface GrnPrintLine {
    pallet_id:        string;
    pallet_number:    string | null;
    part_number:      string | null;
    msn_code:         string | null;
    item_name?:       string | null;
    expected_qty:     number;
    received_qty:     number;
    line_status:      'RECEIVED' | 'MISSING' | 'DAMAGED' | 'SHORT' | 'QUALITY_HOLD';
    discrepancy_note: string | null;
    reason_code:      string | null;
}

export interface GrnPrintHeader {
    gr_number:       string;
    gr_date_iso:     string;          // when committed
    proforma_number: string | null;
    shipment_number: string | null;
    customer_name:   string | null;
    mpl_number:      string | null;
    invoice_number:  string | null;
    bpa_number:      string | null;
    received_by:     string | null;   // operator full name
    notes:           string | null;
}

export interface PutawayLabelPallet {
    pallet_id:     string;
    pallet_number: string | null;
    part_number:   string | null;
    item_name:     string | null;
    msn_code:      string | null;
    quantity:      number;
    line_status:   'RECEIVED' | 'DAMAGED';
}

export interface PutawayLabelHeader {
    gr_number:       string;
    shipment_number: string | null;
    proforma_number: string | null;
    mpl_number:      string | null;
    received_by:     string | null;
}

// ───────────────────────────────────────────────────────────────────────────
// printGrn — formal Goods Receipt Note (A4 portrait)
// ───────────────────────────────────────────────────────────────────────────

export function printGrn(header: GrnPrintHeader, lines: GrnPrintLine[]): void {
    const totals = lines.reduce(
        (acc, l) => {
            acc.expected += l.expected_qty;
            acc.received += l.received_qty;
            if (l.line_status === 'RECEIVED')                acc.recv += 1;
            else if (l.line_status === 'MISSING')            acc.miss += 1;
            else if (l.line_status === 'DAMAGED')            acc.dam += 1;
            else if (l.line_status === 'SHORT')              acc.short += 1;
            else if (l.line_status === 'QUALITY_HOLD')       acc.hold += 1;
            return acc;
        },
        { expected: 0, received: 0, recv: 0, miss: 0, dam: 0, short: 0, hold: 0 },
    );
    const variance = totals.received - totals.expected;
    const date = new Date(header.gr_date_iso);
    const dateStr = date.toLocaleString();

    const rowsHtml = lines.map((l, i) => {
        const statusColor = l.line_status === 'RECEIVED'
            ? '#16a34a'
            : l.line_status === 'MISSING'
                ? '#dc2626'
                : '#d97706';
        return `
<tr>
  <td class="c r">${i + 1}</td>
  <td class="c">${esc(l.pallet_number ?? '—')}</td>
  <td class="c">${esc(l.part_number ?? '—')}<div class="sm">${esc(l.msn_code ?? '')}</div></td>
  <td class="c r mono">${l.expected_qty.toLocaleString()}</td>
  <td class="c r mono">${l.received_qty.toLocaleString()}</td>
  <td class="c"><span style="color:${statusColor};font-weight:700">${l.line_status}</span>${
      l.reason_code ? `<div class="sm">${esc(l.reason_code)}</div>` : ''
  }</td>
  <td class="c">${esc(l.discrepancy_note ?? '')}</td>
</tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(header.gr_number)}</title>
<style>
@page{size:A4 portrait;margin:10mm}
*{margin:0;padding:0;box-sizing:border-box}
html,body{font-family:Calibri,'Segoe UI',Arial,sans-serif;color:#000;font-size:11px;line-height:1.4;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table{border-collapse:collapse;width:100%}
th,td{vertical-align:top}
.c{padding:6px 8px;border:1px solid #000}
.r{text-align:right}
.ctr{text-align:center}
.mono{font-family:'Courier New',monospace}
.sm{font-size:9px;color:#555;margin-top:2px}
.head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #000}
.title{font-size:22px;font-weight:900;letter-spacing:4px}
.gr-number{font-family:'Courier New',monospace;font-size:18px;font-weight:800;text-align:right}
.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border:1px solid #000;margin-bottom:14px}
.meta-cell{padding:6px 8px;border-right:1px solid #000;border-bottom:1px solid #000}
.meta-cell:nth-child(2n){border-right:none}
.meta-cell:nth-last-child(-n+2){border-bottom:none}
.lbl{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:700}
.val{font-size:13px;font-weight:700;margin-top:2px}
.totals{display:grid;grid-template-columns:repeat(6,1fr);gap:0;border:1px solid #000;margin:14px 0}
.t-cell{padding:6px 8px;text-align:center;border-right:1px solid #000}
.t-cell:last-child{border-right:none}
.t-val{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums}
th{background:#f5f5f5;font-size:10px;text-transform:uppercase;letter-spacing:0.4px}
.sign{margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:24px}
.sign-box{padding:14px;border:1px solid #000;min-height:80px}
.sign-lbl{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:6px}
.foot{margin-top:14px;font-size:9px;color:#666;text-align:center}
@media print{.no-print{display:none!important}}
</style></head><body>

<div class="head">
  <div>
    <div class="title">GOODS RECEIPT</div>
    <div class="sm" style="font-size:11px;margin-top:4px">Inbound verification record · System-generated</div>
  </div>
  <div>
    <div class="lbl">GR Number</div>
    <div class="gr-number">${esc(header.gr_number)}</div>
    <div class="sm" style="font-size:11px;margin-top:2px">${esc(dateStr)}</div>
  </div>
</div>

<div class="meta">
  <div class="meta-cell">
    <div class="lbl">Shipment</div>
    <div class="val mono">${esc(header.shipment_number ?? header.proforma_number ?? '—')}</div>
  </div>
  <div class="meta-cell">
    <div class="lbl">Proforma Invoice</div>
    <div class="val mono">${esc(header.proforma_number ?? '—')}</div>
  </div>
  <div class="meta-cell">
    <div class="lbl">Customer</div>
    <div class="val">${esc(header.customer_name ?? '—')}</div>
  </div>
  <div class="meta-cell">
    <div class="lbl">MPL</div>
    <div class="val mono">${esc(header.mpl_number ?? '—')}</div>
  </div>
  <div class="meta-cell">
    <div class="lbl">Invoice</div>
    <div class="val mono">${esc(header.invoice_number ?? '—')}</div>
  </div>
  <div class="meta-cell">
    <div class="lbl">BPA</div>
    <div class="val mono">${esc(header.bpa_number ?? '—')}</div>
  </div>
  <div class="meta-cell">
    <div class="lbl">Received By</div>
    <div class="val">${esc(header.received_by ?? '—')}</div>
  </div>
  <div class="meta-cell">
    <div class="lbl">Notes</div>
    <div class="val" style="font-size:11px;font-weight:400">${esc(header.notes ?? '—')}</div>
  </div>
</div>

<div class="totals">
  <div class="t-cell"><div class="lbl">Pallets</div><div class="t-val">${lines.length}</div></div>
  <div class="t-cell"><div class="lbl">Received</div><div class="t-val" style="color:#16a34a">${totals.recv}</div></div>
  <div class="t-cell"><div class="lbl">Missing</div><div class="t-val" style="color:#dc2626">${totals.miss}</div></div>
  <div class="t-cell"><div class="lbl">Damaged</div><div class="t-val" style="color:#d97706">${totals.dam}</div></div>
  <div class="t-cell"><div class="lbl">Qty Expected</div><div class="t-val">${totals.expected.toLocaleString()}</div></div>
  <div class="t-cell"><div class="lbl">Qty Received</div><div class="t-val">${totals.received.toLocaleString()}</div>${
      variance !== 0
        ? `<div class="sm" style="color:${variance < 0 ? '#dc2626' : '#0f766e'};font-weight:700">${variance > 0 ? '+' : ''}${variance.toLocaleString()}</div>`
        : ''
  }</div>
</div>

<table>
  <thead>
    <tr>
      <th class="c">#</th>
      <th class="c">Pallet #</th>
      <th class="c">Part / MSN</th>
      <th class="c">Expected</th>
      <th class="c">Received</th>
      <th class="c">Status</th>
      <th class="c">Note</th>
    </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
</table>

<div class="sign">
  <div class="sign-box">
    <div class="sign-lbl">Received by (signature & date)</div>
    <div class="sm" style="font-size:11px;margin-top:30px;border-top:1px solid #000;padding-top:4px">${esc(header.received_by ?? '')}</div>
  </div>
  <div class="sign-box">
    <div class="sign-lbl">Supervisor (signature & date)</div>
    <div class="sm" style="font-size:11px;margin-top:30px;border-top:1px solid #000;padding-top:4px"></div>
  </div>
</div>

<div class="foot">${esc(header.gr_number)} · Printed ${esc(new Date().toLocaleString())} · System-generated audit record</div>

<script>window.onload=function(){window.print();}<\/script>
</body></html>`;

    openPrintWindow(html, `GR-${header.gr_number}`);
}

// ───────────────────────────────────────────────────────────────────────────
// printPutawayLabels — one 100×70mm thermal label per pallet, with QR
// ───────────────────────────────────────────────────────────────────────────

export async function printPutawayLabels(header: PutawayLabelHeader, pallets: PutawayLabelPallet[]): Promise<void> {
    if (pallets.length === 0) return;

    // Build v2 QR payload (matches the pallet-slip QR from MasterPackingListHome
    // so the receive flow can scan a freshly-printed label and resolve it).
    const qrUrls: string[] = await Promise.all(pallets.map(async (p) => {
        const payload = [
            `PALLET:${p.pallet_id}`,
            `MPL:${header.mpl_number ?? ''}`,
            `PN:${p.pallet_number ?? ''}`,
            `PART:${p.part_number ?? ''}`,
            `ITEM:${p.item_name ?? ''}`,
            `MSN:${p.msn_code ?? ''}`,
            `QTY:${p.quantity ?? 0}`,
            `V:2`,
        ].join('\n');
        try {
            return await QRCode.toDataURL(payload, {
                errorCorrectionLevel: 'M', width: 200, margin: 1,
                color: { dark: '#000000', light: '#ffffff' },
            });
        } catch { return ''; }
    }));

    const labelsHtml = pallets.map((p, i) => {
        const accent = p.line_status === 'DAMAGED' ? '#d97706' : '#16a34a';
        const accentLabel = p.line_status === 'DAMAGED' ? 'DAMAGED — INSPECT BEFORE PUTAWAY' : 'PUTAWAY';
        return `
<div class="label">
  <div class="strip" style="background:${accent}">${accentLabel}</div>
  <div class="body">
    <div class="left">
      <div class="row">
        <span class="lbl">PALLET</span>
        <span class="val mono">${esc(p.pallet_number ?? '—')}</span>
      </div>
      <div class="row">
        <span class="lbl">PART</span>
        <span class="val mono">${esc(p.part_number ?? '—')}</span>
      </div>
      ${p.msn_code ? `<div class="row"><span class="lbl">MSN</span><span class="val mono">${esc(p.msn_code)}</span></div>` : ''}
      ${p.item_name ? `<div class="row item"><span class="lbl">ITEM</span><span class="val">${esc(p.item_name)}</span></div>` : ''}
      <div class="qty">
        <span class="lbl">QTY</span>
        <span class="qty-val mono">${p.quantity.toLocaleString()}</span>
      </div>
      <div class="footer-line">
        <span>GR ${esc(header.gr_number)}</span>
        <span>${esc(header.shipment_number ?? header.proforma_number ?? '')}</span>
      </div>
    </div>
    <div class="right">
      ${qrUrls[i] ? `<img src="${qrUrls[i]}" alt="QR" />` : '<div class="qr-fallback">QR</div>'}
      <div class="qr-cap">SCAN TO PUTAWAY</div>
    </div>
  </div>
</div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Putaway labels · GR-${esc(header.gr_number)}</title>
<style>
@page{size:100mm 70mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html,body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.label{
  width:100mm;height:70mm;
  page-break-after:always;
  display:flex;flex-direction:column;
  border:1px solid #000;
  box-sizing:border-box;
}
.strip{
  height:6mm;color:#fff;font-size:9px;font-weight:800;
  letter-spacing:1.5px;text-align:center;line-height:6mm;
}
.body{flex:1;display:flex;padding:3mm;gap:3mm;min-height:0}
.left{flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0}
.right{width:34mm;display:flex;flex-direction:column;align-items:center;justify-content:center;border-left:1px dashed #999;padding-left:3mm}
.right img{width:30mm;height:30mm;image-rendering:pixelated}
.qr-fallback{width:30mm;height:30mm;border:1px solid #999;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999}
.qr-cap{font-size:7px;font-weight:700;letter-spacing:1px;color:#666;margin-top:2mm;text-align:center}
.row{display:flex;flex-direction:column;margin-bottom:1mm;min-width:0}
.row.item{flex:1;min-height:0}
.lbl{font-size:6.5px;font-weight:700;letter-spacing:0.6px;color:#666;text-transform:uppercase}
.val{font-size:11px;font-weight:700;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row.item .val{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:9px;font-weight:600}
.mono{font-family:'Courier New',Consolas,monospace}
.qty{margin-top:1mm}
.qty-val{font-size:22px;font-weight:900;line-height:1}
.footer-line{display:flex;justify-content:space-between;font-size:7px;color:#666;font-weight:700;border-top:1px dashed #999;padding-top:1mm;margin-top:1mm}
@media print{.label{page-break-inside:avoid}}
</style></head><body>
${labelsHtml}
<script>window.onload=function(){window.print();}<\/script>
</body></html>`;

    openPrintWindow(html, `Putaway-${header.gr_number}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function openPrintWindow(html: string, title: string): void {
    const w = window.open('', title, 'width=900,height=1000');
    if (!w) {
        // Pop-up blocked — fall back to opening in the current tab. The user
        // can still hit Ctrl+P. Better than silent failure.
        const blob = new Blob([html], { type: 'text/html' });
        const url  = URL.createObjectURL(blob);
        window.open(url, '_blank');
        return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
}
