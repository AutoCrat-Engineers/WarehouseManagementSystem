/**
 * pdfServiceClient.ts — Resilient HTTP client for the PDF Microservice.
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ARCHITECTURE: Frontend → PDF Microservice (external)       ║
 * ║  Replaces direct function calls with resilient HTTP calls.  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Features:
 *   - Retry with exponential backoff (transient failures)
 *   - Circuit breaker (prevents cascading failure)
 *   - Timeout handling (prevents hung requests)
 *   - Fallback response (main app never crashes)
 *   - Request correlation (X-Request-ID)
 *   - Structured error logging
 */

// ─── Configuration ───────────────────────────────────────────

const PDF_SERVICE_URL = import.meta.env.VITE_PDF_SERVICE_URL || 'http://localhost:3001';
const PDF_SERVICE_API_KEY = import.meta.env.VITE_PDF_SERVICE_API_KEY || '';

const CONFIG = {
  /** Maximum time to wait for a response */
  timeoutMs: 30_000,
  /** Number of retry attempts for transient failures */
  maxRetries: 2,
  /** Initial delay between retries (doubles each attempt) */
  retryDelayMs: 1_000,
  /** Circuit breaker: failures before opening circuit */
  circuitBreakerThreshold: 3,
  /** Circuit breaker: time to wait before trying again */
  circuitBreakerResetMs: 60_000,
};

// ─── Circuit Breaker State ───────────────────────────────────

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function isCircuitOpen(): boolean {
  if (consecutiveFailures < CONFIG.circuitBreakerThreshold) return false;
  if (Date.now() > circuitOpenUntil) {
    // Half-open: allow one request through
    return false;
  }
  return true;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= CONFIG.circuitBreakerThreshold) {
    circuitOpenUntil = Date.now() + CONFIG.circuitBreakerResetMs;
    console.warn(
      `⚡ PDF Service circuit breaker OPEN — ${consecutiveFailures} consecutive failures. ` +
      `Will retry after ${new Date(circuitOpenUntil).toISOString()}`
    );
  }
}

// ─── Fetch with Timeout ──────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Sleep Helper ────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Public API ──────────────────────────────────────────────

export interface PdfGenerationResult {
  success: boolean;
  pdfBuffer: ArrayBuffer | null;
  sizeKb: number;
  durationMs: number;
  requestId: string;
  error?: string;
}

/**
 * Generate a PDF from HTML via the external PDF microservice.
 *
 * Includes retry, timeout, and circuit breaker for reliability.
 * If the service is down, returns a structured error — the main app
 * should handle this gracefully (show toast, log, etc.).
 *
 * @param html - Complete HTML document string
 * @param options - Optional PDF options (format, margin)
 * @returns PdfGenerationResult with success flag and buffer
 */
export async function generatePdf(
  html: string,
  options?: { format?: string; margin?: Record<string, string> },
): Promise<PdfGenerationResult> {
  const requestId = crypto.randomUUID?.() || `req-${Date.now()}`;
  const startTime = Date.now();

  // ── Circuit breaker check ──
  if (isCircuitOpen()) {
    console.error(`❌ PDF Service circuit breaker is OPEN — skipping request`);
    return {
      success: false,
      pdfBuffer: null,
      sizeKb: 0,
      durationMs: Date.now() - startTime,
      requestId,
      error: 'PDF service is temporarily unavailable. Please try again in a minute.',
    };
  }

  // ── Retry loop ──
  let lastError = '';
  for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = CONFIG.retryDelayMs * Math.pow(2, attempt - 1);
        console.warn(`🔄 PDF retry ${attempt}/${CONFIG.maxRetries} after ${delay}ms...`);
        await sleep(delay);
      }

      const res = await fetchWithTimeout(
        `${PDF_SERVICE_URL}/v1/generate-pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
            ...(PDF_SERVICE_API_KEY ? { 'X-API-Key': PDF_SERVICE_API_KEY } : {}),
          },
          body: JSON.stringify({ html, options }),
        },
        CONFIG.timeoutMs,
      );

      if (!res.ok) {
        const errBody = await res.text();
        // Categorize errors for better diagnostics
        if (res.status === 404) {
          lastError = `PDF service route not found (404). Verify the service is running and the endpoint /v1/generate-pdf is registered.`;
        } else if (res.status === 401 || res.status === 403) {
          lastError = `PDF service auth failed (${res.status}). Check API key configuration.`;
        } else {
          lastError = `PDF service error (${res.status}): ${errBody}`;
        }

        // Don't retry on client errors (4xx)
        if (res.status >= 400 && res.status < 500) {
          recordFailure();
          break;
        }
        continue;
      }

      // ── Success ──
      const pdfBuffer = await res.arrayBuffer();
      const sizeKb = Math.round(pdfBuffer.byteLength / 1024);
      const durationMs = Date.now() - startTime;

      recordSuccess();

      console.log(
        `✅ PDF generated: ${sizeKb} KB in ${durationMs}ms ` +
        `(request: ${requestId}, attempts: ${attempt + 1})`
      );

      return {
        success: true,
        pdfBuffer,
        sizeKb,
        durationMs,
        requestId,
      };
    } catch (err: any) {
      lastError = err.name === 'AbortError'
        ? `Request timed out after ${CONFIG.timeoutMs}ms`
        : err.message || 'Network error';

      console.error(`❌ PDF attempt ${attempt + 1} failed: ${lastError}`);
    }
  }

  // ── All retries exhausted ──
  recordFailure();
  const durationMs = Date.now() - startTime;

  console.error(
    `❌ PDF generation failed after ${CONFIG.maxRetries + 1} attempts ` +
    `(${durationMs}ms, request: ${requestId}): ${lastError}`
  );

  return {
    success: false,
    pdfBuffer: null,
    sizeKb: 0,
    durationMs,
    requestId,
    error: lastError,
  };
}

/**
 * Check if the PDF service is reachable.
 */
export async function checkPdfServiceHealth(): Promise<{
  available: boolean;
  status?: string;
  latencyMs?: number;
}> {
  try {
    const start = Date.now();
    const res = await fetchWithTimeout(`${PDF_SERVICE_URL}/health`, { method: 'GET' }, 5000);
    const latencyMs = Date.now() - start;
    const body = await res.json();
    return { available: res.ok, status: body.status, latencyMs };
  } catch {
    return { available: false };
  }
}

/**
 * Get the configured PDF service URL (for debugging/display).
 */
export function getPdfServiceUrl(): string {
  return PDF_SERVICE_URL;
}
