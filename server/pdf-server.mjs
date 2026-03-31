/**
 * PDF Generation Microservice — Puppeteer-based
 *
 * Receives HTML via POST, renders it with headless Chrome,
 * returns the exact PDF buffer (matching browser Print Preview).
 *
 * Usage:
 *   node server/pdf-server.mjs
 *
 * Endpoint:
 *   POST http://localhost:3001/api/generate-pdf
 *   Body: { html: "<full HTML string>" }
 *   Response: application/pdf (binary buffer)
 */

import http from 'node:http';
import puppeteer from 'puppeteer';

const PORT = 3001;
let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });
    console.log('🚀 Puppeteer browser launched');
  }
  return browser;
}

async function generatePdf(html) {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    // Set viewport to A4 dimensions (794x1123 px at 96 DPI)
    await page.setViewport({ width: 794, height: 1123 });

    // Load the complete HTML content
    await page.setContent(html, {
      waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
      timeout: 15000,
    });

    // Ensure all fonts are loaded
    await page.evaluateHandle('document.fonts.ready');

    // Emulate print media for proper CSS @media print
    await page.emulateMediaType('print');

    // Wait a bit for any CSS transitions/animations
    await new Promise(r => setTimeout(r, 300));

    // Generate PDF — matches print preview exactly
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '6mm',
        bottom: '6mm',
        left: '6mm',
        right: '6mm',
      },
    });

    console.log(`✅ PDF generated: ${Math.round(pdfBuffer.length / 1024)} KB`);
    return pdfBuffer;
  } finally {
    await page.close();
  }
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/generate-pdf') {
    try {
      // Read request body
      const chunks = [];
      for await (const chunk of req) { chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());

      if (!body.html) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "html" field' }));
        return;
      }

      // Generate PDF
      const pdfBuffer = await generatePdf(body.html);

      // Return raw binary
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': pdfBuffer.length,
        'Content-Disposition': 'attachment; filename="document.pdf"',
      });
      res.end(pdfBuffer);
    } catch (err) {
      console.error('❌ PDF generation error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`\n📄 PDF Service running at http://localhost:${PORT}`);
  console.log(`   POST /api/generate-pdf   — Generate PDF from HTML`);
  console.log(`   GET  /health             — Health check\n`);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
