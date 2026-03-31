# Dispatch Email System — Complete Implementation Report

**Version**: v9 (Resilient Dispatch with Error Recovery)
**Date**: 31 March 2026
**Module**: Proforma Invoice Dispatch Notifications
**Status**: ✅ Production Ready

---

## 1. Executive Summary

The Dispatch Email System sends automated, branded email notifications with the Proforma Invoice PDF attached when a PI is approved and stock is dispatched. The system ensures the attached PDF is **byte-for-byte identical** to the browser's Print Preview by using a dedicated Puppeteer (headless Chrome) microservice for PDF generation.

### Key Capabilities
- Branded HTML email with company identity (Autocrat Engineers)
- Pixel-perfect Proforma Invoice PDF attachment (~50-150 KB, vector quality)
- Binary-safe pipeline: Puppeteer → Storage → Email (zero transformation)
- Audit logging of every dispatch attempt
- Retry with exponential backoff on transient failures
- Configurable recipients per dispatch

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        APPROVAL FLOW                                │
│                                                                     │
│  [User clicks "Approve"]                                           │
│       │                                                             │
│       ▼                                                             │
│  [1. approvePerformaInvoice RPC]  ← Atomic: status + stock move    │
│       │                                                             │
│       ▼                                                             │
│  [2. Build PI HTML]  ← Same template as Print Preview               │
│       │                ← Logo embedded as base64 data-URI           │
│       │                                                             │
│       ▼                                                             │
│  [3. POST HTML → Puppeteer Service]  (localhost:3001)               │
│       │                                                             │
│       ▼                                                             │
│  [4. Chrome renders → page.pdf()]  ← print media, fonts loaded     │
│       │                                                             │
│       ▼                                                             │
│  [5. Receive PDF as ArrayBuffer → Uint8Array]                       │
│       │                                                             │
│       ▼                                                             │
│  [6. Upload raw binary → Supabase Storage]  (pi-documents bucket)   │
│       │                                                             │
│       ▼                                                             │
│  [7. Call Edge Function → send-dispatch-email]                      │
│       │                                                             │
│       ▼                                                             │
│  [8. Edge Fn downloads binary → attaches to email → sends Resend]   │
│       │                                                             │
│       ▼                                                             │
│  [9. Log to email_dispatch_log table]                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Files & Components

### 3.1 Frontend — `PerformaInvoice.tsx`

**Path**: `src/components/packing-engine/PerformaInvoice.tsx`

| Function | Description |
|----------|-------------|
| `generatePIPdfAndUpload(pi)` | Builds PI HTML → POSTs to Puppeteer → receives buffer → uploads to Storage |
| `handleApproveSubmit()` | Orchestrates: approve RPC → generate PDF → send email. Shows proper error states, keeps modal open on partial failures |
| `handleRetryPdf()` | Retries PDF generation + upload without re-approving the PI |
| `handleResendEmail()` | Resends dispatch email without re-generating the PDF |
| `handlePrintPI(pi)` | Opens PI in new window for browser printing (unchanged) |

**Key details:**
- Logo is pre-fetched from `/logo.png` and converted to a **base64 data-URI** at runtime, embedded directly in the HTML so Puppeteer can render it without needing access to the local filesystem.
- The HTML template is the **exact same structure** used in `handlePrintPI`, ensuring the stored PDF matches the Print Preview.
- PDF service URL is configurable via `VITE_PDF_SERVICE_URL` environment variable (defaults to `http://localhost:3001`).

### 3.2 Puppeteer PDF Service (Microservice)

**Path**: `micro-services/pdf-service/` (decoupled from main repo as of v0.5.0)

> **Note**: The original `server/pdf-server.mjs` has been removed from the main repository.
> The PDF service now runs as an independent Docker-containerized microservice.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/generate-pdf` | POST | Accepts `{ html: string }`, returns `application/pdf` binary (primary) |
| `/api/generate-pdf` | POST | Deprecated alias → redirects to `/v1/generate-pdf` (sunset 2027-01-01) |
| `/health` | GET | Full health check (browser, memory, uptime) |
| `/healthz` | GET | Liveness probe (minimal) |
| `/readyz` | GET | Readiness probe (browser + capacity) |

**How it works:**
1. Launches headless Chrome **once** on startup (connection pooling)
2. For each request: creates a new page → `page.setContent(html)` → waits for `document.fonts.ready` → `page.emulateMediaType('print')` → `page.pdf({format:'A4', printBackground:true})`
3. Returns the raw PDF buffer
4. Closes the page (browser stays alive)

**Chrome flags:**
```
--no-sandbox
--disable-setuid-sandbox
--disable-dev-shm-usage
--disable-gpu
--font-render-hinting=none
```

### 3.3 Edge Function — `send-dispatch-email`

**Path**: `supabase/functions/send-dispatch-email/index.ts`

| Function | Description |
|----------|-------------|
| `fetchPIMetadata()` | Fetches PI record + customer name from database |
| `downloadPdfFromStorage()` | Downloads exact binary from `pi-documents` Storage bucket |
| `buildHtmlEmail()` | Generates branded HTML email template |
| `buildPlainText()` | Generates plain-text fallback |
| `sendViaResend()` | Sends email with PDF attachment via Resend API (2x retry) |
| `logEmailDispatch()` | Inserts audit record into `email_dispatch_log` table |

**Binary handling in Edge Function:**
```
Storage.download() → Blob → arrayBuffer() → Uint8Array → btoa() → base64
```
The base64 string is passed to Resend's `attachments[].content` field.

### 3.4 Database Migrations

**Migration 011**: `supabase/migrations/011_email_dispatch_logging.sql`
- Creates `email_dispatch_log` table
- Columns: `id`, `proforma_invoice_id`, `proforma_number`, `recipients`, `status`, `resend_message_id`, `error_message`, `sent_at`
- RLS: authenticated users can read, service_role can insert
- Indexes on `proforma_invoice_id` and `status` (failed)

**Migration 012**: `supabase/migrations/012_pi_documents_storage.sql`
- Creates `pi-documents` Storage bucket (20 MB file limit, PDF only)
- RLS policies:
  - `service_role` → full access (Edge Function downloads)
  - `authenticated` → INSERT, UPDATE, SELECT (frontend uploads)

---

## 4. Third-Party Services & Dependencies

### 4.1 Runtime Dependencies

| Package | Version | Purpose | License |
|---------|---------|---------|---------|
| `puppeteer` | ^24.40.0 | Headless Chrome for PDF generation | Apache-2.0 |
| `@supabase/supabase-js` | * | Supabase client (DB, Storage, Auth) | MIT |
| `react` | ^18.3.1 | UI framework | MIT |
| `lucide-react` | ^0.487.0 | Icons | ISC |

### 4.2 External Services

| Service | Purpose | Pricing | Dashboard |
|---------|---------|---------|-----------|
| **Supabase** | Database, Storage, Edge Functions, Auth | Free tier (500 MB DB, 1 GB Storage) | [Dashboard](https://supabase.com/dashboard/project/sugvmurszfcneaeyoagv) |
| **Resend** | Email delivery API | Free tier (100 emails/day, 3000/month) | [Dashboard](https://resend.com) |
| **Puppeteer/Chrome** | PDF rendering (self-hosted) | Free (runs on your server) | N/A |

### 4.3 Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `RESEND_API_KEY` | Supabase Edge Function secrets | Resend API authentication |
| `SUPABASE_URL` | Auto-set by Supabase | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-set by Supabase | Service-role auth key |
| `VITE_PDF_SERVICE_URL` | Frontend `.env` (optional) | Puppeteer service URL (default: `http://localhost:3001`) |

---

## 5. Email Design

### Subject Line
```
Dispatch Notification – Shipment {shipment_number}
```

### HTML Email Structure

```
┌──────────────────────────────────────────┐
│  HEADER (dark navy gradient)              │
│  "AUTOCRAT ENGINEERS"                     │
│  "Precision Machined Components"          │
│  [DISPATCH badge]                         │
├──────────────────────────────────────────┤
│  TITLE BAR (red #e63946)                  │
│  "Dispatch Notification"    |    Date     │
├──────────────────────────────────────────┤
│                                          │
│  Dear {Customer Name},                   │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  SHIPMENT DETAILS                  │  │
│  │  Proforma Invoice: PI-000060       │  │
│  │  Shipment Number: SHIP-2026-060    │  │
│  │  Dispatch Date: 26 Mar 2026        │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  ✓ Stock Dispatched               │  │
│  │  Dispatched from FG Warehouse      │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  📎 Proforma Invoice Attached      │  │
│  │  PI-PI-000060.pdf                  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Best regards,                           │
│  Dispatch Team                           │
│  Autocrat Engineers                      │
│                                          │
├──────────────────────────────────────────┤
│  FOOTER                                  │
│  "Automated notification"                │
│  🌿 Consider the environment             │
│  © 2026 Autocrat Engineers               │
└──────────────────────────────────────────┘
```

Features:
- Responsive, 600px max-width
- Card-based layout with subtle shadows
- Table-based rendering for email client compatibility
- Plain-text fallback included

---

## 6. PDF Generation Details

### Input
The PI HTML template includes all static company data and dynamic fields:

| Section | Data Source |
|---------|------------|
| Company details (Exporter) | Hardcoded (Autocrat Engineers) |
| Logo | `/logo.png` → base64 data-URI |
| PI Number, Date | `pack_proforma_invoices` table |
| Consignee, Buyer | Hardcoded (Milano Millworks / Passler, David) |
| Shipping details | `pack_packing_list_data` table |
| Item rows | `master_packing_list_pallets` + `items` tables |
| Totals | Computed from item rows |
| Codes (ITC HS, HTS US, DBK) | Hardcoded |

### Output
- Format: A4 portrait
- Margins: 6mm all sides
- Backgrounds: printed (watermark, header bg)
- Quality: Vector (text is selectable, not rasterized)
- Size: ~50–150 KB

### Data Flow for Items

```sql
proforma_invoice_mpls   → mpl_ids
master_packing_lists    → po_number, packing_list_id
master_packing_list_pallets → item_code, quantity, item_name
items                   → part_number, standard_cost, master_serial_no
pack_packing_list_data  → ship_via, mode_of_transport, ports, country
```

---

## 7. Storage Architecture

### Bucket: `pi-documents`

| Property | Value |
|----------|-------|
| Visibility | Private |
| Max file size | 20 MB |
| Allowed MIME types | `application/pdf` |

### File Path Convention
```
pi-documents/
  PI-000054/
    PI-000054.pdf
  PI-000058/
    PI-000058.pdf
  PI-000060/
    PI-000060.pdf
```

### RLS Policies

| Policy | Role | Operations |
|--------|------|------------|
| `service_role_pi_docs` | service_role | ALL (Edge Function) |
| `authenticated_insert_pi_docs` | authenticated | INSERT (frontend upload) |
| `authenticated_update_pi_docs` | authenticated | UPDATE (upsert) |
| `authenticated_read_pi_docs` | authenticated | SELECT (download) |

---

## 8. Audit Logging

Every email dispatch attempt is logged to `email_dispatch_log`:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `proforma_invoice_id` | UUID | FK → pack_proforma_invoices |
| `proforma_number` | TEXT | e.g., "PI-000060" |
| `recipients` | TEXT[] | Array of email addresses |
| `status` | TEXT | "sent" or "failed" |
| `resend_message_id` | TEXT | Resend tracking ID |
| `error_message` | TEXT | Error details if failed |
| `sent_at` | TIMESTAMPTZ | Timestamp |

### Monitoring Queries

```sql
-- Recent dispatches
SELECT proforma_number, recipients, status, sent_at
FROM email_dispatch_log
ORDER BY sent_at DESC LIMIT 20;

-- Failed dispatches (for retry)
SELECT * FROM email_dispatch_log
WHERE status = 'failed'
ORDER BY sent_at DESC;

-- Dispatch count per PI
SELECT proforma_number, COUNT(*) as attempts,
       COUNT(*) FILTER (WHERE status = 'sent') as successful
FROM email_dispatch_log
GROUP BY proforma_number;
```

---

## 9. Error Handling

| Scenario | Behavior | UI State |
|----------|----------|----------|
| PDF service unreachable | Approval succeeds, email skipped | ⚠️ Warning toast, modal stays open with **Retry PDF** button |
| PDF service returns 404 | Categorized error: "route not found" | ❌ Error with diagnostic message |
| PDF service returns 401/403 | Categorized error: "auth failed" | ❌ Error, check API key config |
| Storage upload fails | Logged, email not sent | ⚠️ **Retry PDF** button shown |
| PDF not found in Storage | Edge Function returns error | ⚠️ **Resend Email** button shown |
| Resend API error (4xx) | No retry, logged as failed | ❌ Error toast |
| Resend API error (5xx) | 2x retry with exponential backoff | ⚠️ **Resend Email** button shown |
| Invalid email addresses | Resend validates and returns error | ❌ Error toast |
| PI not found in database | Edge Function returns 400 | ❌ Error toast |
| All steps succeed | Modal auto-closes | ✅ Success toast |

### Failure Isolation
- **PI approval is always atomic** — stock movement happens regardless of email success
- **Email failure is visible** — the user sees the exact error and can retry from the modal
- **Retry without re-approval** — `handleRetryPdf()` and `handleResendEmail()` only re-run the failed step
- **Every failure is logged** — check `email_dispatch_log` for diagnostics

---

## 10. Running Locally

### Prerequisites
- Node.js v18+
- Chrome/Chromium (installed automatically by Puppeteer)
- Supabase CLI (`npx supabase`)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Run database migrations (in Supabase SQL Editor)
#    → 011_email_dispatch_logging.sql
#    → 012_pi_documents_storage.sql

# 3. Start PDF microservice (Terminal 1)
# Option A: Run from micro-services directory
cd ../micro-services/pdf-service && npm start
# Option B: Run via Docker
docker compose -f ../micro-services/pdf-service/docker-compose.yml up
# Output: 📄 PDF Service running at http://localhost:3001

# 4. Start Vite dev server (Terminal 2)
npm run dev
# Output: http://localhost:3000
```

### Testing
1. Navigate to **Packing Engine → Proforma Invoice**
2. Select a confirmed PI → click **Approve**
3. Enter recipient email(s)
4. Submit → observe:
   - Console: `📄 Sending HTML to Puppeteer service...`
   - Console: `✅ PDF received from Puppeteer: XX KB`
   - Console: `💾 PDF stored: PI-000060/PI-000060.pdf`
   - Toast: "Dispatched Successfully — Email sent to 1 recipient(s)"
5. Check email inbox for branded dispatch notification with PDF attachment

---

## 11. Production Deployment

### PDF Service Deployment

The Puppeteer service (now at `micro-services/pdf-service/`) must be deployed separately since Supabase Edge Functions can't run Chrome. Azure Bicep IaC templates are included for Azure Container Apps deployment.

**Recommended Platforms:**

| Platform | Free Tier | Setup |
|----------|-----------|-------|
| Railway | 500 hrs/month | `railway init` → `railway up` |
| Render | 750 hrs/month | Connect Git repo → Auto-deploy |
| Fly.io | 3 shared VMs | `fly launch` → `fly deploy` |

After deployment, set the environment variable:
```bash
VITE_PDF_SERVICE_URL=https://your-pdf-service.railway.app
```

### Edge Function Deployment
```bash
npx supabase functions deploy send-dispatch-email --no-verify-jwt
```

### Resend Domain Verification
1. Go to [Resend Dashboard](https://resend.com/domains)
2. Add domain: `autocratengineers.in`
3. Add DNS records (MX, SPF, DKIM)
4. Verify → Update `from` in Edge Function from `onboarding@resend.dev` to `dispatch@autocratengineers.in`

---

## 12. Evolution History

| Version | Date | Approach | Issue |
|---------|------|----------|-------|
| v1 | 2026-03-06 | Basic text email, no PDF | No document attached |
| v2 | 2026-03-25 | Client-side jsPDF → Edge Function | PDF formatting broken |
| v3 | 2026-03-25 | Server-side pdf-lib in Edge Function | Layout misaligned (manual coordinates) |
| v4 | 2026-03-26 | html2canvas + jsPDF in frontend iframe | Rasterized, 14MB, missing logo, 400 upload |
| v5 | 2026-03-26 | Fixed storage path, RLS, JPEG compression | Still layout differences vs print |
| v6 | 2026-03-26 | Uint8Array upload, improved logo | Multipart/form-data 400 errors |
| **v7** | **2026-03-26** | **Puppeteer microservice** | **✅ Production-grade, pixel-perfect** |
| v8 | 2026-03-31 | Decoupled microservice architecture | Extracted to independent repo |
| **v9** | **2026-03-31** | **Resilient dispatch with error recovery** | **✅ Fixed: CORS, port conflicts, false success UI, retry/resend** |

### Why Puppeteer Won
- **pdf-lib**: Manual coordinate positioning — impossible to match complex HTML table layout
- **html2canvas + jsPDF**: Rasterizes DOM to image → blurry text, 14MB files, layout timing issues
- **Puppeteer**: Uses real Chrome engine → `page.pdf()` produces the exact same output as `Ctrl+P` → "Save as PDF"

---

## 13. Security Considerations

| Area | Implementation |
|------|----------------|
| Storage Access | RLS enforced — only authenticated users can upload, service_role can download |
| Edge Function Auth | Bearer token from Supabase Auth session |
| Resend API Key | Stored as Supabase Edge Function secret (not in code) |
| PDF Service | Runs on localhost:3001 (CORS with X-API-Key header, API key auth in production, no auth for local dev) |
| Email Spoofing | Uses Resend's verified domain (pending DNS verification) |
| Data Exposure | PI HTML contains business data — PDF service should be on trusted network in production |

---

*Report updated: 31 March 2026, 15:15 IST*
*System: WMS-AE Warehouse Management System — Autocrat Engineers*
