/**
 * releasePrints — Two industrial-grade print layouts for a blanket release:
 *
 *   1. Internal Picking List (warehouse → Milan / 3PL operator)
 *      - Lists every pallet to pull, sorted by rack location for an
 *        efficient pick walk.
 *      - Shipment / parent-invoice references for traceability.
 *      - Picker / verifier signature blocks.
 *
 *   2. Customer Amendment Release Draft
 *      - Sent to the customer when whole-pallet stock can't satisfy the
 *        original ask exactly.
 *      - Calls out original vs amended qty, delta, and the reason
 *        (whole-pallet dispatch policy).
 *      - Acknowledgement block for the customer to sign and return.
 *
 * Both layouts mirror the visual language of the existing PROFORMA INVOICE
 * and PACKING LIST prints (PerformaInvoice.tsx / PackingListPrint.tsx):
 *   - A4 portrait, 6mm margin
 *   - Outer 1.5px black border
 *   - Diagonal AUTOCRAT ENGINEERS watermark
 *   - Title bar (logo + bold italic title)
 *   - Info grid → items table → totals → signatory → footer timestamp
 *
 * Pure client-side. window.open + auto-print on load.
 */

import type { CustomerAgreement, CustomerAgreementPart } from '../bpa/types';
import type { AvailablePallet } from './types';

// ── Exporter / company defaults (mirrors PerformaInvoice/PackingListPrint) ──
const EXPORTER = {
    name:    'AUTOCRAT ENGINEERS',
    addr:    'Plot No. 17, Industrial Estate,\nPune, Maharashtra 411019, India',
    phone:   '+91 20 2712 8500',
    email:   'export@autocrat-engineers.com',
    gstin:   '27AAACA1234B1Z5',
    iec:     '0312345678',
};

export interface ReleasePrintData {
    bpa: CustomerAgreement;
    part: CustomerAgreementPart;
    releasePo: string;
    orderDate: string;
    needByDate: string;
    buyerName: string;
    customerRequestedQuantity: number;
    requestedQuantity: number;
    adjustmentType: 'NONE' | 'UP' | 'DOWN' | 'MANUAL';
    pallets: AvailablePallet[];
}

// ── Tiny helpers ─────────────────────────────────────────────────────────
const fmtDate = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtDateTime = (d: Date) =>
    d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtMoney = (n: number, cur = 'USD') =>
    `${cur} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escape = (s: string | null | undefined) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Shared CSS used by both layouts
const SHARED_CSS = `
@page{size:A4 portrait;margin:6mm}
*{margin:0;padding:0;box-sizing:border-box}
html,body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:9.5px;line-height:1.3;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;height:100%}
b{font-weight:700}
table{border-collapse:collapse;width:100%}
td,th{vertical-align:top}
.outer{border:1.5px solid #000;display:flex;flex-direction:column}
.bb{border-bottom:1px solid #000}
.br{border-right:1px solid #000}
.bt{border-top:1px solid #000}
.bl{border-left:1px solid #000}
.c4{padding:4px 6px}
.c5{padding:5px 7px}
.ctr{text-align:center}
.rgt{text-align:right}
.lbl{font-size:8px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.4px}
.mono{font-family:'Courier New',Consolas,monospace}
.sm{font-size:8px;color:#555}
.wm{position:fixed;top:46%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:56px;font-weight:900;color:rgba(0,0,0,.035);letter-spacing:10px;text-transform:uppercase;pointer-events:none;z-index:0;white-space:nowrap}
.titlebar{padding:8px;text-align:center}
.title{font-size:20px;font-weight:800;letter-spacing:5px;text-transform:uppercase;font-style:italic}
.subtitle{font-size:11px;font-weight:600;color:#666;letter-spacing:2px;text-transform:uppercase;margin-top:3px}
.chip{display:inline-block;padding:2px 8px;border-radius:99px;font-size:9px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase}
.chip-up{background:#fef3c7;color:#92400e}
.chip-down{background:#dbeafe;color:#1e3a8a}
.chip-manual{background:#f1f5f9;color:#475569}
.signrow{height:50px;border-bottom:1px solid #000;margin-top:6px}
@media print{.no-print{display:none!important}@page{size:A4 portrait;margin:6mm}}
`;

const openAndPrint = (html: string) => {
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) {
        alert('Pop-up blocked. Allow pop-ups for this site to print.');
        return;
    }
    w.document.write(html);
    w.document.close();
};

// ─────────────────────────────────────────────────────────────────────────
// 1. PICKING LIST (internal — warehouse Milan)
// ─────────────────────────────────────────────────────────────────────────

export function printPickingList(d: ReleasePrintData): void {
    const now = new Date();
    const printedAt = fmtDateTime(now);

    // Sort pallets by rack location for an efficient pick walk.
    const palletsSorted = [...d.pallets].sort((a, b) => {
        const al = a.location_code ?? '';
        const bl = b.location_code ?? '';
        if (al !== bl) return al.localeCompare(bl);
        return (a.pallet_number ?? '').localeCompare(b.pallet_number ?? '');
    });

    const totalPallets = palletsSorted.length;
    const totalQty     = palletsSorted.reduce((s, p) => s + (p.quantity ?? 0), 0);
    const customerAsk  = d.customerRequestedQuantity;
    const adjusted     = customerAsk > 0 && customerAsk !== d.requestedQuantity;
    const cur          = d.bpa.currency_code || 'USD';
    const unitPrice    = Number(d.part.unit_price ?? 0);

    const itemRows = palletsSorted.map((p, idx) => {
        const rack = escape(p.location_code ?? '—');
        const pn   = escape(p.pallet_number ?? '—');
        const qty  = Number(p.quantity ?? 0).toLocaleString();
        const ship = escape(p.shipment_number ?? (p.shipment_sequence != null ? `Seq ${p.shipment_sequence}` : '—'));
        const inv  = escape(p.parent_invoice_number ?? '—');
        const placed = p.placed_at ? fmtDate(p.placed_at) : '—';
        return `<tr>
<td class="bb br c4 ctr fw7">${idx + 1}</td>
<td class="bb br c4 ctr fw8 mono" style="font-size:11px">${rack}</td>
<td class="bb br c4 mono" style="font-weight:700">${pn}</td>
<td class="bb br c4 rgt mono" style="font-weight:800;font-size:11px">${qty}</td>
<td class="bb br c4 mono">${ship}</td>
<td class="bb br c4 mono">${inv}</td>
<td class="bb c4 ctr sm">${placed}</td>
<td class="bb bl c4 ctr"><div style="width:14px;height:14px;border:1.5px solid #000;border-radius:2px;margin:0 auto"></div></td>
</tr>`;
    }).join('');

    const adjustedBanner = adjusted ? `
<table style="background:#fef3c7"><tr>
<td class="c5" style="padding:6px 10px;font-size:9.5px;color:#78350f;border-top:1px solid #f59e0b;border-bottom:1px solid #f59e0b">
  <b>⚠ AMENDED RELEASE</b> — Customer originally asked <b>${customerAsk.toLocaleString()}</b> pcs · this picking list reflects the agreed amended quantity of <b>${d.requestedQuantity.toLocaleString()}</b> pcs (${d.adjustmentType === 'UP' ? '+' : '−'}${Math.abs(d.requestedQuantity - customerAsk).toLocaleString()}). Confirm customer sign-off before dispatch.
</td>
</tr></table>` : '';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Picking List · ${escape(d.releasePo)}</title>
<style>${SHARED_CSS}
.fw7{font-weight:700}.fw8{font-weight:800}
</style></head><body>
<div class="wm">PICKING LIST</div>

<!-- top date bar -->
<table><tr>
<td class="c4" style="font-size:9px">${printedAt}</td>
<td class="c4 ctr" style="font-size:9px">PICKING LIST · ${escape(d.releasePo)}</td>
<td class="c4 rgt" style="font-size:9px">Page 1</td>
</tr></table>

<div class="outer">

  <!-- header / title bar -->
  <table>
    <tr>
      <td class="bb br c4" style="width:30%;padding:8px">
        <div style="font-size:13px;font-weight:800;letter-spacing:1px">${EXPORTER.name}</div>
        <div class="sm" style="white-space:pre-line;line-height:1.4;margin-top:2px">${EXPORTER.addr}</div>
      </td>
      <td class="bb c4 titlebar" style="width:70%;position:relative">
        <div class="title">PICKING LIST</div>
        <div class="subtitle">Warehouse pull · whole-pallet pick · FIFO traceable</div>
      </td>
    </tr>
  </table>

  <!-- reference grid -->
  <table>
    <colgroup><col style="width:18%"/><col style="width:32%"/><col style="width:18%"/><col style="width:32%"/></colgroup>
    <tr>
      <td class="bb br c4 lbl">Picking List No.</td>
      <td class="bb br c4 mono" style="font-weight:800;font-size:11px">PL-${escape(d.releasePo)}</td>
      <td class="bb br c4 lbl">Issued On</td>
      <td class="bb c4">${printedAt}</td>
    </tr>
    <tr>
      <td class="bb br c4 lbl">Customer</td>
      <td class="bb br c4" style="font-weight:700">${escape(d.bpa.customer_name)}</td>
      <td class="bb br c4 lbl">Buyer</td>
      <td class="bb c4">${escape(d.buyerName || d.bpa.buyer_name || '—')}</td>
    </tr>
    <tr>
      <td class="bb br c4 lbl">BPA Number</td>
      <td class="bb br c4 mono" style="font-weight:700">${escape(d.bpa.agreement_number)} · Rev ${d.bpa.agreement_revision ?? 0}</td>
      <td class="bb br c4 lbl">Release PO</td>
      <td class="bb c4 mono" style="font-weight:700">${escape(d.releasePo)}</td>
    </tr>
    <tr>
      <td class="bb br c4 lbl">Order Date</td>
      <td class="bb br c4">${fmtDate(d.orderDate)}</td>
      <td class="bb br c4 lbl">Need By Date</td>
      <td class="bb c4" style="font-weight:700;color:#7f1d1d">${fmtDate(d.needByDate)}</td>
    </tr>
    <tr>
      <td class="bb br c4 lbl">Part Number</td>
      <td class="bb br c4 mono" style="font-weight:700">${escape(d.part.part_number)}</td>
      <td class="bb br c4 lbl">MSN</td>
      <td class="bb c4" style="font-weight:700">${escape(d.part.msn_code)}</td>
    </tr>
    <tr>
      <td class="bb br c4 lbl">Customer Asked</td>
      <td class="bb br c4 mono" style="font-weight:700">${customerAsk.toLocaleString()} pcs</td>
      <td class="bb br c4 lbl">Pull Quantity</td>
      <td class="bb c4 mono" style="font-weight:800;font-size:12px;color:#15803d">${d.requestedQuantity.toLocaleString()} pcs</td>
    </tr>
  </table>

  ${adjustedBanner}

  <!-- pick instructions -->
  <table><tr><td class="bb c4 ctr" style="padding:5px;font-weight:800;font-size:10px;letter-spacing:1px;text-transform:uppercase">PICK INSTRUCTIONS — ${totalPallets} PALLET${totalPallets === 1 ? '' : 'S'} · SORTED BY RACK LOCATION</td></tr></table>

  <!-- items table -->
  <table style="table-layout:fixed">
    <colgroup>
      <col style="width:5%"/>
      <col style="width:11%"/>
      <col style="width:24%"/>
      <col style="width:10%"/>
      <col style="width:14%"/>
      <col style="width:14%"/>
      <col style="width:14%"/>
      <col style="width:8%"/>
    </colgroup>
    <tr style="background:#f5f5f5">
      <th class="bb br c4 lbl ctr">SL</th>
      <th class="bb br c4 lbl ctr">Rack</th>
      <th class="bb br c4 lbl">Pallet ID</th>
      <th class="bb br c4 lbl rgt">Qty (pcs)</th>
      <th class="bb br c4 lbl">Shipment</th>
      <th class="bb br c4 lbl">Parent Invoice</th>
      <th class="bb br c4 lbl ctr">Placed</th>
      <th class="bb c4 lbl ctr">✓ Picked</th>
    </tr>
    ${itemRows}
  </table>

  <!-- totals -->
  <table style="table-layout:fixed">
    <colgroup>
      <col style="width:5%"/>
      <col style="width:11%"/>
      <col style="width:24%"/>
      <col style="width:10%"/>
      <col style="width:14%"/>
      <col style="width:14%"/>
      <col style="width:14%"/>
      <col style="width:8%"/>
    </colgroup>
    <tr style="background:#f5f5f5">
      <td class="bt c4" colspan="3" style="font-weight:800">TOTAL TO PULL</td>
      <td class="bt br c4 rgt mono" style="font-weight:800;font-size:11px">${totalQty.toLocaleString()}</td>
      <td class="bt c4 sm" colspan="2">Estimated load value: ${fmtMoney(totalQty * unitPrice, cur)}</td>
      <td class="bt c4 ctr sm" style="font-weight:700">${totalPallets} pallet${totalPallets === 1 ? '' : 's'}</td>
      <td class="bt c4"></td>
    </tr>
  </table>

  <!-- pick checklist / signatures -->
  <table style="border-top:1px solid #000">
    <colgroup><col style="width:50%"/><col style="width:50%"/></colgroup>
    <tr>
      <td class="br c4" style="padding:8px">
        <div class="lbl">Picker</div>
        <div class="signrow"></div>
        <div class="sm" style="margin-top:3px">Name &amp; signature · Date / Time</div>
      </td>
      <td class="c4" style="padding:8px">
        <div class="lbl">Verifier (L2 / L3)</div>
        <div class="signrow"></div>
        <div class="sm" style="margin-top:3px">Name &amp; signature · Date / Time</div>
      </td>
    </tr>
    <tr>
      <td class="bt br c4" style="padding:8px">
        <div class="lbl">Discrepancy notes (qty short, damaged, lot mismatch, etc.)</div>
        <div style="height:46px;border-bottom:1px solid #888;margin-top:6px"></div>
      </td>
      <td class="bt c4" style="padding:8px">
        <div class="lbl">Forklift / equipment used</div>
        <div style="height:18px;border-bottom:1px solid #888;margin-top:6px"></div>
        <div class="lbl" style="margin-top:8px">Released to dispatch (carrier &amp; AWB)</div>
        <div style="height:18px;border-bottom:1px solid #888;margin-top:6px"></div>
      </td>
    </tr>
  </table>

  <!-- standing instructions -->
  <table style="border-top:1px solid #000">
    <tr>
      <td class="c4" style="padding:6px 8px">
        <div class="sm" style="line-height:1.5">
          <b>Standing instructions:</b> Pick whole pallets only — do not break pallets or transfer loose pieces. Verify each pallet's barcode against the Pallet ID column before pulling. If any pallet is unavailable (damaged, missing, picked elsewhere), stop the pick and notify the warehouse supervisor; do not substitute. Confirm rack locations are emptied and rack tags are cleared before signing off.
        </div>
      </td>
    </tr>
  </table>

</div><!-- end .outer -->

<!-- bottom bar -->
<table style="margin-top:3px"><tr>
<td class="c4 sm" style="width:33%">Release: ${escape(d.releasePo)}</td>
<td class="c4 sm ctr" style="width:34%">Printed: ${printedAt}</td>
<td class="c4 sm rgt" style="width:33%">System-generated picking list</td>
</tr></table>

<script>window.onload=function(){window.print();}<\/script></body></html>`;

    openAndPrint(html);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. CUSTOMER AMENDMENT RELEASE DRAFT
//    Mirrors the customer's own Blanket Release format (OPW-style) so the
//    customer sees a familiar mirror document with amended numbers, easy
//    to compare side-by-side against their original PO.
// ─────────────────────────────────────────────────────────────────────────

export function printAmendmentDraft(d: ReleasePrintData): void {
    const now = new Date();
    const printedAt = fmtDateTime(now);
    const cur = d.bpa.currency_code || 'USD';
    const unitPrice = Number(d.part.unit_price ?? 0);
    const customerAsk = d.customerRequestedQuantity;
    const newQty = d.requestedQuantity;
    const delta = newQty - customerAsk;
    const direction = d.adjustmentType === 'UP' ? 'UP' : d.adjustmentType === 'DOWN' ? 'DOWN' : 'MANUAL';
    const dirLabel = direction === 'UP' ? 'AMENDED UP' : direction === 'DOWN' ? 'AMENDED DOWN' : 'MANUAL ADJUSTMENT';
    const dirColor = direction === 'UP' ? '#92400e' : direction === 'DOWN' ? '#1e3a8a' : '#475569';
    const dirBg    = direction === 'UP' ? '#fef3c7' : direction === 'DOWN' ? '#dbeafe' : '#f1f5f9';

    const reasonText = direction === 'UP'
        ? `Whole-pallet stock cannot satisfy the originally requested ${customerAsk.toLocaleString()} pcs exactly. The closest available combination above the requested quantity is ${newQty.toLocaleString()} pcs (${d.pallets.length} pallets). Per dispatch policy, only whole pallets are shipped — partial-pallet picks are not supported.`
        : direction === 'DOWN'
        ? `Whole-pallet stock cannot satisfy the originally requested ${customerAsk.toLocaleString()} pcs exactly. The closest available combination below the requested quantity is ${newQty.toLocaleString()} pcs (${d.pallets.length} pallets). The remaining ${Math.abs(delta).toLocaleString()} pcs will be carried forward to a future release.`
        : `Manual pallet selection by warehouse: ${newQty.toLocaleString()} pcs across ${d.pallets.length} pallets. Original request was ${customerAsk.toLocaleString()} pcs.`;

    // Group pallets by shipment for the supplier-note breakdown
    const byShipment = new Map<string, { qty: number; pallets: number; invoice: string | null }>();
    for (const p of d.pallets) {
        const key = p.shipment_number ?? (p.shipment_sequence != null ? `Seq ${p.shipment_sequence}` : '—');
        const prev = byShipment.get(key) ?? { qty: 0, pallets: 0, invoice: p.parent_invoice_number };
        byShipment.set(key, { qty: prev.qty + (p.quantity ?? 0), pallets: prev.pallets + 1, invoice: prev.invoice ?? p.parent_invoice_number });
    }
    const shipmentSummary = Array.from(byShipment.entries())
        .map(([ship, info]) => `${escape(ship)} (Inv ${escape(info.invoice ?? '—')}): ${info.qty.toLocaleString()} pcs / ${info.pallets} pallet${info.pallets === 1 ? '' : 's'}`)
        .join(' · ');

    const lineExtended = newQty * unitPrice;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Release Amendment · ${escape(d.releasePo)}</title>
<style>${SHARED_CSS}
body{font-size:9.5px}
.opw-block{padding:10px 12px;line-height:1.45}
.cell-lbl{font-size:8px;font-weight:700;color:#000;text-transform:none;letter-spacing:0;border-bottom:none}
.cell-val{font-size:11px;font-weight:700;color:#000;padding-top:1px}
.box-title{padding:8px 12px;text-align:center;font-size:14px;font-weight:800;letter-spacing:0.5px}
.box-sub{padding:0 12px 6px;text-align:center;font-size:11px;font-weight:700;letter-spacing:1px}
.amend-banner{padding:6px 10px;text-align:center;font-weight:800;font-size:11px;letter-spacing:0.5px;border:1px solid #000;background:#fff}
.row-line td{padding:8px 10px;font-size:10px}
.under-line td{padding:5px 10px;font-size:9.5px;background:#fafafa}
.note-row td{padding:5px 10px;font-size:9px;color:#000}
.totals-row td{padding:6px 10px;font-size:11px;font-weight:800}
.diff-old{color:#7f1d1d;text-decoration:line-through}
.diff-new{color:#15803d;font-weight:800}
</style></head><body>
<div class="wm">RELEASE AMENDMENT</div>

<!-- top page-of bar -->
<table><tr><td class="c4 rgt sm">Page 1 of 1</td></tr></table>

<div class="outer">

  <!-- ═══ TOP BAND: customer logo+addr | Ship To | Title block ═══ -->
  <table>
    <colgroup><col style="width:36%"/><col style="width:30%"/><col style="width:34%"/></colgroup>
    <tr>
      <!-- Customer (buyer) header — left -->
      <td class="bb br opw-block" style="vertical-align:top">
        <div style="font-size:18px;font-weight:800;letter-spacing:0.5px">${escape(d.bpa.customer_name)}</div>
        <div class="sm" style="margin-top:2px"><i>(Customer · Buyer)</i></div>
        ${d.bpa.delivery_location ? `<div style="margin-top:6px;line-height:1.45">${escape(d.bpa.delivery_location).replace(/\n/g, '<br/>')}</div>` : ''}
        ${d.bpa.buyer_phone ? `<div style="margin-top:4px">Tel: ${escape(d.bpa.buyer_phone)}</div>` : ''}
        ${d.bpa.buyer_email ? `<div>Email: ${escape(d.bpa.buyer_email)}</div>` : ''}
      </td>

      <!-- Ship To — middle -->
      <td class="bb br opw-block" style="vertical-align:top">
        <div style="font-weight:700;text-decoration:underline">Ship To</div>
        <div style="margin-top:4px;line-height:1.55">
          ${escape(d.bpa.customer_name)}<br/>
          ${d.bpa.delivery_location ? escape(d.bpa.delivery_location).replace(/\n/g, '<br/>') : '<i class="sm">— delivery location not on file —</i>'}
        </div>
        ${d.bpa.buyer_phone ? `<div style="margin-top:6px">Tel. ${escape(d.bpa.buyer_phone)}</div>` : ''}
      </td>

      <!-- Title box — right -->
      <td class="bb opw-block" style="vertical-align:top;padding:0">
        <div class="box-title">Release Amendment</div>
        <div class="box-sub">PENDING CUSTOMER CONFIRMATION</div>
        <table style="border-top:1px solid #000">
          <colgroup><col style="width:50%"/><col style="width:50%"/></colgroup>
          <tr>
            <td class="bb br c4"><div class="cell-lbl">Order No</div><div class="cell-val mono">${escape(d.releasePo)}</div></td>
            <td class="bb c4"><div class="cell-lbl">Revision</div><div class="cell-val">${d.bpa.agreement_revision ?? 0}</div></td>
          </tr>
          <tr>
            <td class="bb br c4"><div class="cell-lbl">Order Date</div><div class="cell-val">${fmtDate(d.orderDate)}</div></td>
            <td class="bb c4"><div class="cell-lbl">Created By</div><div class="cell-val">${escape(d.buyerName || d.bpa.buyer_name || '—')}</div><div class="cell-lbl" style="margin-top:3px">Contact Number</div><div>${escape(d.bpa.buyer_phone ?? '')}</div></td>
          </tr>
          <tr>
            <td class="bb br c4"><div class="cell-lbl">Amendment Date</div><div class="cell-val">${fmtDate(now.toISOString())}</div></td>
            <td class="bb c4"><div class="cell-lbl">Current Buyer</div><div class="cell-val">${escape(d.buyerName || d.bpa.buyer_name || '—')}</div></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- ═══ Supplier (us) | Bill To ═══ -->
  <table>
    <colgroup><col style="width:36%"/><col style="width:30%"/><col style="width:34%"/></colgroup>
    <tr>
      <td class="bb br opw-block" style="vertical-align:top">
        <div style="font-weight:700;text-decoration:underline">Supplier</div>
        <div style="margin-top:4px;line-height:1.55;font-weight:700">${EXPORTER.name}</div>
        <div class="sm" style="white-space:pre-line;line-height:1.5">${EXPORTER.addr}</div>
        <div class="sm" style="margin-top:3px">Tel: ${EXPORTER.phone}</div>
        <div class="sm">Email: ${EXPORTER.email}</div>
        <div class="sm">GSTIN: ${EXPORTER.gstin} · IEC: ${EXPORTER.iec}</div>
      </td>
      <td class="bb br opw-block" style="vertical-align:top">
        <div style="font-weight:700;text-decoration:underline">Bill To</div>
        <div style="margin-top:4px;line-height:1.55">
          ${escape(d.bpa.customer_name)}<br/>
          ${d.bpa.delivery_location ? escape(d.bpa.delivery_location).replace(/\n/g, '<br/>') : ''}
        </div>
        ${d.bpa.buyer_email ? `<div class="sm" style="margin-top:6px">Email invoices to:<br/>${escape(d.bpa.buyer_email)}</div>` : ''}
      </td>
      <td class="bb opw-block" style="vertical-align:top;padding:0">
        <table>
          <tr>
            <td class="bb br c4"><div class="cell-lbl">BPA Number</div><div class="cell-val mono">${escape(d.bpa.agreement_number)}</div></td>
            <td class="bb c4"><div class="cell-lbl">BPA Revision</div><div class="cell-val">${d.bpa.agreement_revision ?? 0}</div></td>
          </tr>
          <tr>
            <td class="bb br c4"><div class="cell-lbl">Need-By Date</div><div class="cell-val" style="color:#7f1d1d">${fmtDate(d.needByDate)}</div></td>
            <td class="bb c4"><div class="cell-lbl">Adjustment</div><div class="cell-val" style="color:${dirColor};background:${dirBg};display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px">${dirLabel}</div></td>
          </tr>
          <tr>
            <td class="c4"><div class="cell-lbl">Issued On</div><div>${printedAt}</div></td>
            <td class="c4"><div class="cell-lbl">Total Pallets</div><div class="cell-val">${d.pallets.length}</div></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- ═══ Acknowledgement banner ═══ -->
  <table><tr><td class="c4 amend-banner" style="border-top:none;border-left:none;border-right:none">Amendment Acknowledgement Required within 24 hrs.</td></tr></table>

  <!-- ═══ Commercial strip (mirrors customer's PAYMENT/FREIGHT/FOB row) ═══ -->
  <table style="background:#f5f5f5">
    <colgroup><col style="width:14%"/><col style="width:18%"/><col style="width:18%"/><col style="width:14%"/><col style="width:18%"/><col style="width:18%"/></colgroup>
    <tr>
      <td class="bb br c4"><div class="cell-lbl">SUPPLIER NO.</div></td>
      <td class="bb br c4"><div class="cell-lbl">PAYMENT TERMS</div></td>
      <td class="bb br c4"><div class="cell-lbl">FREIGHT TERMS</div></td>
      <td class="bb br c4"><div class="cell-lbl">FOB / INCOTERMS</div></td>
      <td class="bb br c4"><div class="cell-lbl">TRANSPORTATION</div></td>
      <td class="bb c4"><div class="cell-lbl">SHIP VIA</div></td>
    </tr>
    <tr style="background:#fff">
      <td class="bb br c4 mono">${escape(d.bpa.customer_code ?? '—')}</td>
      <td class="bb br c4">${escape(d.bpa.payment_terms ?? '—')}</td>
      <td class="bb br c4">${escape(d.bpa.incoterms ?? '—')}</td>
      <td class="bb br c4">${escape(d.bpa.incoterms ?? '—')}</td>
      <td class="bb br c4">—</td>
      <td class="bb c4">${escape(d.bpa.ship_via ?? '—')}</td>
    </tr>
    <tr>
      <td class="bb br c4"><div class="cell-lbl">SUPPLIER CONTACT</div></td>
      <td class="bb br c4"><div class="cell-lbl">SUPPLIER PHONE</div></td>
      <td class="bb br c4" colspan="2"><div class="cell-lbl">SUPPLIER EMAIL</div></td>
      <td class="bb c4" colspan="2"><div class="cell-lbl">DELIVER TO</div></td>
    </tr>
    <tr style="background:#fff">
      <td class="bb br c4">${escape('Sales · Autocrat Engineers')}</td>
      <td class="bb br c4 mono">${escape(EXPORTER.phone)}</td>
      <td class="bb br c4" colspan="2">${escape(EXPORTER.email)}</td>
      <td class="bb c4" colspan="2">${escape(d.bpa.delivery_location ?? '—')}</td>
    </tr>
  </table>

  <!-- ═══ Note to Customer (amendment reason) ═══ -->
  <table>
    <tr>
      <td class="bb c4" style="padding:8px 12px">
        <div class="cell-lbl">Note to Customer / Reason for Amendment:</div>
        <div style="margin-top:4px;line-height:1.55;font-size:9.5px">${reasonText}</div>
      </td>
    </tr>
  </table>

  <!-- ═══ Items table (matches customer's column geometry) ═══ -->
  <table style="table-layout:fixed">
    <colgroup>
      <col style="width:5%"/>
      <col style="width:30%"/>
      <col style="width:11%"/>
      <col style="width:14%"/>
      <col style="width:7%"/>
      <col style="width:11%"/>
      <col style="width:5%"/>
      <col style="width:17%"/>
    </colgroup>
    <tr style="background:#f5f5f5">
      <th class="bb br c4 cell-lbl ctr">Line</th>
      <th class="bb br c4 cell-lbl">Part number / Description</th>
      <th class="bb br c4 cell-lbl ctr">Need-By Date</th>
      <th class="bb br c4 cell-lbl ctr">Quantity</th>
      <th class="bb br c4 cell-lbl ctr">UOM</th>
      <th class="bb br c4 cell-lbl rgt">Unit Price (${cur})</th>
      <th class="bb br c4 cell-lbl ctr">Tax</th>
      <th class="bb c4 cell-lbl rgt">Extended Price (${cur})</th>
    </tr>
    <tr class="row-line">
      <td class="bb br ctr" style="font-weight:700">1</td>
      <td class="bb br">
        <div><b>Part No:</b> <span class="mono" style="font-weight:700">${escape(d.part.part_number)}</span></div>
        <div style="margin-top:2px">${escape(d.part.customer_description ?? d.part.msn_code)}</div>
      </td>
      <td class="bb br ctr">${fmtDate(d.needByDate)}</td>
      <td class="bb br ctr">
        <div class="diff-old sm">${customerAsk.toLocaleString()}.00</div>
        <div class="diff-new" style="font-size:13px">${newQty.toLocaleString()}.00</div>
      </td>
      <td class="bb br ctr">Each</td>
      <td class="bb br rgt mono">${unitPrice.toFixed(4)}</td>
      <td class="bb br ctr">N</td>
      <td class="bb rgt mono" style="font-weight:800">
        <div class="diff-old sm">${(customerAsk * unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div class="diff-new">${lineExtended.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </td>
    </tr>
    <tr class="under-line">
      <td class="bb br"></td>
      <td class="bb br" colspan="7">
        <b>Drawing Number:</b> <span class="mono">${escape(d.part.drawing_number ?? d.part.part_number)}</span> &nbsp;·&nbsp;
        <b>Drawing Revision:</b> <span class="mono">${escape(d.part.drawing_revision ?? '—')}</span> &nbsp;·&nbsp;
        <b>MSN:</b> ${escape(d.part.msn_code)}
      </td>
    </tr>
    <tr class="note-row">
      <td class="bb br cell-lbl">Supplier Part No</td>
      <td class="bb br" colspan="7">
        <b>Note to Supplier:</b> Whole-pallet dispatch policy. ${shipmentSummary ? `Draw-down: ${shipmentSummary}.` : ''} Blanket Qty ${Number(d.part.blanket_quantity ?? 0).toLocaleString()} · Min/Max ${Number(d.part.min_warehouse_stock ?? 0).toLocaleString()} / ${Number(d.part.max_warehouse_stock ?? 0).toLocaleString()}.
      </td>
    </tr>
  </table>

  <!-- ═══ Total ═══ -->
  <table style="table-layout:fixed">
    <colgroup>
      <col style="width:5%"/>
      <col style="width:30%"/>
      <col style="width:11%"/>
      <col style="width:14%"/>
      <col style="width:7%"/>
      <col style="width:11%"/>
      <col style="width:5%"/>
      <col style="width:17%"/>
    </colgroup>
    <tr class="totals-row" style="background:#f5f5f5">
      <td class="bb br"></td>
      <td class="bb br" colspan="5" style="text-align:right">TOTAL (${cur})</td>
      <td class="bb br"></td>
      <td class="bb rgt mono" style="font-size:13px">${lineExtended.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>
  </table>

  <!-- ═══ Acknowledgement / signatures ═══ -->
  <table>
    <tr>
      <td class="bb c4" style="padding:10px 12px">
        <div style="font-weight:800;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;text-align:center">Customer Acknowledgement</div>
        <div class="sm" style="text-align:center;margin-top:5px;line-height:1.55">
          I, the undersigned, on behalf of <b>${escape(d.bpa.customer_name)}</b>, hereby confirm and accept the above amendment to release <span class="mono" style="font-weight:700">${escape(d.releasePo)}</span> against BPA <span class="mono" style="font-weight:700">${escape(d.bpa.agreement_number)}</span>. Agreed dispatch quantity is <b>${newQty.toLocaleString()} pcs</b> · unit price <b>${cur} ${unitPrice.toFixed(4)}</b> · total line value <b>${fmtMoney(lineExtended, cur)}</b>.
        </div>
        <table style="margin-top:14px">
          <colgroup><col style="width:50%"/><col style="width:50%"/></colgroup>
          <tr>
            <td class="br c4" style="padding:6px 12px">
              <div class="cell-lbl">Authorised Signatory · ${escape(d.bpa.customer_name)}</div>
              <div class="signrow"></div>
              <div class="sm" style="margin-top:3px">Name &amp; designation · Date</div>
            </td>
            <td class="c4" style="padding:6px 12px">
              <div class="cell-lbl">For ${EXPORTER.name}</div>
              <div class="signrow"></div>
              <div class="sm" style="margin-top:3px">Authorised signatory · Date</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- ═══ Declaration footer ═══ -->
  <table>
    <tr>
      <td class="c4" style="padding:7px 10px">
        <div class="sm" style="line-height:1.55"><b>Declaration:</b> This amended release supersedes the originally issued quantity (${customerAsk.toLocaleString()} pcs) and is valid for dispatch only after written confirmation from the customer. All other commercial terms (price, currency, payment terms, incoterms, delivery location) of the underlying BPA <span class="mono" style="font-weight:700">${escape(d.bpa.agreement_number)}</span> remain unchanged. Quantities are stated in pieces (Each).</div>
      </td>
    </tr>
  </table>

</div><!-- end .outer -->

<!-- bottom bar -->
<table style="margin-top:3px"><tr>
<td class="c4 sm" style="width:33%">Release: ${escape(d.releasePo)}</td>
<td class="c4 sm ctr" style="width:34%">Printed: ${printedAt}</td>
<td class="c4 sm rgt" style="width:33%">Draft — pending customer confirmation</td>
</tr></table>

<script>window.onload=function(){window.print();}<\/script></body></html>`;

    openAndPrint(html);
}
