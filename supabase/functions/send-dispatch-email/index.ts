/**
 * send-dispatch-email — Supabase Edge Function (v6 — Production Grade)
 *
 * Downloads the EXACT PI PDF from Supabase Storage (uploaded by frontend)
 * and attaches it to a branded HTML dispatch email via Resend.
 *
 * ARCHITECTURE:
 *   Frontend: generates PDF (html2canvas + jsPDF) → uploads to Storage
 *   Edge Fn:  downloads binary from Storage → attaches to email (zero transformation)
 *
 * PAYLOAD: { pi_id: string, to: string[] }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ═══════════════════════════════════════════════════════════════
// FETCH PI METADATA
// ═══════════════════════════════════════════════════════════════

async function fetchPIMetadata(supabase: ReturnType<typeof createClient>, piId: string) {
  const { data: pi, error } = await supabase
    .from('pack_proforma_invoices')
    .select('id, proforma_number, shipment_number, status, created_at')
    .eq('id', piId)
    .single();
  if (error || !pi) throw new Error(`Proforma Invoice not found: ${error?.message || 'No record'}`);

  // Get customer name from packing list data
  const { data: piMpls } = await supabase.from('proforma_invoice_mpls').select('mpl_id').eq('proforma_id', piId).limit(1);
  const mplId = piMpls?.[0]?.mpl_id;
  let customerName = 'Customer';
  if (mplId) {
    const { data: mpl } = await supabase.from('master_packing_lists').select('packing_list_id').eq('id', mplId).single();
    if (mpl?.packing_list_id) {
      const { data: plData } = await supabase.from('pack_packing_list_data').select('consignee_name').eq('packing_list_id', mpl.packing_list_id).single();
      if (plData?.consignee_name) customerName = plData.consignee_name;
    }
  }

  return { pi, customerName };
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD PDF FROM STORAGE (binary-exact, zero transformation)
// ═══════════════════════════════════════════════════════════════

async function downloadPdfFromStorage(
  supabase: ReturnType<typeof createClient>,
  proformaNumber: string,
): Promise<{ base64: string; sizeKB: number } | null> {
  const storagePath = `${proformaNumber}/${proformaNumber}.pdf`;

  const { data, error } = await supabase.storage
    .from('pi-documents')
    .download(storagePath);

  if (error || !data) {
    console.error(`❌ PDF not found in storage: ${storagePath}`, error?.message);
    return null;
  }

  // Convert Blob → ArrayBuffer → Uint8Array → base64 (binary-safe)
  const arrayBuffer = await data.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const sizeKB = Math.round(bytes.length / 1024);

  // Binary-safe base64 encoding
  const binaryStr = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  const base64 = btoa(binaryStr);

  console.log(`📂 PDF downloaded: ${storagePath} (${sizeKB} KB, ${bytes.length} bytes)`);
  return { base64, sizeKB };
}

// ═══════════════════════════════════════════════════════════════
// BRANDED HTML EMAIL TEMPLATE
// ═══════════════════════════════════════════════════════════════

function buildHtmlEmail(
  proformaNumber: string,
  shipmentNumber: string | null,
  customerName: string,
): string {
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dispatch Notification</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:'Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:32px 16px;">
<tr><td align="center">

<!-- CONTAINER -->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<!-- HEADER -->
<tr>
<td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:28px 36px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td>
      <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:1px;">AUTOCRAT ENGINEERS</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px;letter-spacing:0.5px;">Precision Machined Components</div>
    </td>
    <td align="right" style="vertical-align:middle;">
      <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:6px;padding:6px 14px;">
        <span style="font-size:11px;color:rgba(255,255,255,0.9);font-weight:600;">DISPATCH</span>
      </div>
    </td>
  </tr>
  </table>
</td>
</tr>

<!-- TITLE BAR -->
<tr>
<td style="background:#e63946;padding:14px 36px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td><span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.5px;">Dispatch Notification</span></td>
    <td align="right"><span style="color:rgba(255,255,255,0.85);font-size:12px;">${date}</span></td>
  </tr>
  </table>
</td>
</tr>

<!-- BODY -->
<tr>
<td style="padding:32px 36px 24px;">

  <p style="margin:0 0 20px;font-size:15px;color:#2d3748;line-height:1.6;">
    Dear <strong>${customerName}</strong>,
  </p>
  <p style="margin:0 0 24px;font-size:14px;color:#4a5568;line-height:1.7;">
    We would like to inform you that your shipment has been successfully dispatched and is currently in transit.
  </p>

  <!-- SHIPMENT DETAILS TABLE -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
    <tr style="background:#f7fafc;">
      <td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:700;color:#2d3748;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">
        Shipment Details
      </td>
    </tr>
    <tr>
      <td style="padding:12px 16px;font-size:13px;color:#718096;border-bottom:1px solid #f0f0f0;width:40%;">Proforma Invoice</td>
      <td style="padding:12px 16px;font-size:14px;color:#1a202c;font-weight:600;border-bottom:1px solid #f0f0f0;">${proformaNumber}</td>
    </tr>
    <tr>
      <td style="padding:12px 16px;font-size:13px;color:#718096;border-bottom:1px solid #f0f0f0;">Shipment Number</td>
      <td style="padding:12px 16px;font-size:14px;color:#1a202c;font-weight:600;border-bottom:1px solid #f0f0f0;">${shipmentNumber || '\u2014'}</td>
    </tr>
    <tr>
      <td style="padding:12px 16px;font-size:13px;color:#718096;">Dispatch Date</td>
      <td style="padding:12px 16px;font-size:14px;color:#1a202c;font-weight:600;">${date}</td>
    </tr>
  </table>

  <!-- STATUS BOX -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
  <tr>
    <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding-right:12px;vertical-align:top;">
          <div style="width:28px;height:28px;background:#22c55e;border-radius:50%;text-align:center;line-height:28px;">
            <span style="color:#fff;font-size:14px;">&#10003;</span>
          </div>
        </td>
        <td style="vertical-align:middle;">
          <div style="font-size:14px;font-weight:700;color:#166534;">Stock Dispatched</div>
          <div style="font-size:13px;color:#15803d;margin-top:3px;">Stock has been dispatched from the Finished Goods Warehouse and is now in transit.</div>
        </td>
      </tr>
      </table>
    </td>
  </tr>
  </table>

  <!-- ATTACHMENT NOTE -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
  <tr>
    <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding-right:10px;vertical-align:middle;">
          <span style="font-size:18px;">&#128206;</span>
        </td>
        <td style="vertical-align:middle;">
          <div style="font-size:13px;color:#1e40af;font-weight:600;">Proforma Invoice Attached</div>
          <div style="font-size:12px;color:#3b82f6;margin-top:2px;">PI-${proformaNumber}.pdf</div>
        </td>
      </tr>
      </table>
    </td>
  </tr>
  </table>

  <p style="margin:0 0 4px;font-size:14px;color:#4a5568;line-height:1.7;">
    If you require any further information or assistance, please feel free to contact us.
  </p>

</td>
</tr>

<!-- SIGNATURE -->
<tr>
<td style="padding:0 36px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="border-top:1px solid #e2e8f0;padding-top:20px;">
    <div style="font-size:14px;color:#4a5568;">Best regards,</div>
    <div style="font-size:14px;font-weight:700;color:#1a202c;margin-top:4px;">Dispatch Team</div>
    <div style="font-size:13px;color:#e63946;font-weight:600;">Autocrat Engineers</div>
  </td></tr>
  </table>
</td>
</tr>

<!-- FOOTER -->
<tr>
<td style="background:#f8fafc;padding:20px 36px;border-top:1px solid #edf2f7;">
  <p style="margin:0 0 8px;font-size:11px;color:#a0aec0;text-align:center;">
    This is an automated notification. Please do not reply to this email.
  </p>
  <p style="margin:0;font-size:10px;color:#cbd5e0;text-align:center;">
    &#127807; Please consider the environment before printing this email.
  </p>
</td>
</tr>

</table>

<!-- COMPANY FOOTER -->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-top:16px;">
<tr><td align="center" style="font-size:10px;color:#a0aec0;line-height:1.6;">
  Autocrat Engineers &bull; 264 KIADB, Devanahalli-562135, India<br>
  &copy; ${new Date().getFullYear()} Autocrat Engineers. All rights reserved.
</td></tr>
</table>

</td></tr>
</table>
</body>
</html>`;
}

function buildPlainText(proformaNumber: string, shipmentNumber: string | null, customerName: string): string {
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return `Dear ${customerName},

Your shipment has been successfully dispatched and is currently in transit.

Shipment Details:
- Proforma Invoice: ${proformaNumber}
- Shipment Number: ${shipmentNumber || '\u2014'}
- Dispatch Date: ${date}

Status: Stock dispatched from FG Warehouse → In Transit

The Proforma Invoice PDF is attached for your reference.

Best regards,
Dispatch Team
Autocrat Engineers

(This is an automated notification. Please do not reply.)`;
}

// ═══════════════════════════════════════════════════════════════
// LOG EMAIL DISPATCH
// ═══════════════════════════════════════════════════════════════

async function logEmailDispatch(
  supabase: ReturnType<typeof createClient>,
  piId: string, piNumber: string, recipients: string[],
  status: 'sent' | 'failed', resendId: string | null, errorMessage: string | null,
): Promise<void> {
  try {
    await supabase.from('email_dispatch_log').insert({
      proforma_invoice_id: piId, proforma_number: piNumber,
      recipients, status, resend_message_id: resendId,
      error_message: errorMessage, sent_at: new Date().toISOString(),
    });
  } catch (logErr) { console.error('Log failed:', logErr); }
}

// ═══════════════════════════════════════════════════════════════
// SEND VIA RESEND
// ═══════════════════════════════════════════════════════════════

async function sendViaResend(
  to: string[], subject: string, html: string, text: string,
  pdfBase64: string, filename: string, maxRetries = 2,
): Promise<{ success: boolean; resendId: string | null; error: string | null }> {
  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Autocrat Engineers WMS <onboarding@resend.dev>',
          to, subject, html, text,
          attachments: [{ filename, content: pdfBase64 }],
        }),
      });
      const data = await res.json();
      if (res.ok) return { success: true, resendId: data.id, error: null };
      lastError = data.message || JSON.stringify(data);
      console.error(`Resend error (${attempt + 1}):`, lastError);
      if (res.status >= 400 && res.status < 500) break;
    } catch (e: any) {
      lastError = e.message || 'Network error';
    }
    if (attempt < maxRetries) await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
  }
  return { success: false, resendId: null, error: lastError };
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase env vars');

    const { pi_id, to } = await req.json();
    if (!to || to.length === 0) throw new Error('No recipient email addresses provided');
    if (!pi_id) throw new Error('pi_id is required');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch PI metadata
    const { pi, customerName } = await fetchPIMetadata(supabase, pi_id);
    console.log(`📋 PI: ${pi.proforma_number} | Customer: ${customerName}`);

    // 2. Download EXACT PDF from storage (binary-safe, zero transformation)
    const pdfResult = await downloadPdfFromStorage(supabase, pi.proforma_number);
    if (!pdfResult) {
      const errMsg = `Proforma Invoice PDF not found for ${pi.proforma_number}. Please ensure the PI has been generated.`;
      console.error(`❌ ${errMsg}`);
      await logEmailDispatch(supabase, pi.id, pi.proforma_number, to, 'failed', null, errMsg);
      return new Response(
        JSON.stringify({ success: false, error: errMsg }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    console.log(`📄 PDF ready: ${pdfResult.sizeKB} KB`);

    // 3. Build email
    const subject = `Dispatch Notification \u2013 Shipment ${pi.shipment_number || pi.proforma_number}`;
    const html = buildHtmlEmail(pi.proforma_number, pi.shipment_number, customerName);
    const text = buildPlainText(pi.proforma_number, pi.shipment_number, customerName);
    const filename = `PI-${pi.proforma_number}.pdf`;

    // 4. Send with attached PDF
    console.log(`📧 Sending to ${to.join(', ')}...`);
    const { success, resendId, error: sendErr } = await sendViaResend(
      to, subject, html, text, pdfResult.base64, filename,
    );

    // 5. Log
    await logEmailDispatch(supabase, pi.id, pi.proforma_number, to, success ? 'sent' : 'failed', resendId, sendErr);

    if (success) {
      console.log(`✅ Sent | PI: ${pi.proforma_number} | PDF: ${pdfResult.sizeKB}KB | Resend: ${resendId}`);
      return new Response(
        JSON.stringify({ success: true, message: `Email sent with PI-${pi.proforma_number}.pdf (${pdfResult.sizeKB}KB)`, resend_id: resendId }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    } else {
      console.error(`❌ Failed | ${sendErr}`);
      return new Response(
        JSON.stringify({ success: false, error: sendErr }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    );
  }
});
