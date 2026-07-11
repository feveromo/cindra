const { test, expect } = require('@playwright/test');
const { launchExtensionContext } = require('./helpers.js');

function createTextPdf(text) {
  const escapedText = text.replace(/([()\\])/g, '\\$1');
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${escapedText}) Tj\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n`;
  output += '0000000000 65535 f \n';
  offsets.slice(1).forEach(offset => {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  output += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'ascii');
}

async function extractPdf(serviceWorker, url) {
  return serviceWorker.evaluate(async url => {
    const tabs = await chrome.tabs.query({ url: 'https://fixture.local/*' });
    return CindraBackgroundPdf.extractFullText({ id: tabs[0]?.id, url });
  }, url);
}

test('offscreen PDF extraction returns page-labelled text and cleans up its context', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const url = 'https://fixture.local/sample.pdf';
    const pdf = createTextPdf('Cindra PDF fixture');
    await context.route('https://fixture.local/**', route => {
      if (new URL(route.request().url()).pathname.endsWith('.pdf')) {
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: pdf });
      }
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>PDF holder</title>' });
    });

    const page = await context.newPage();
    await page.goto('https://fixture.local/holder');
    const text = await extractPdf(serviceWorker, url);
    expect(text).toContain('[Page 1]');
    expect(text).toContain('Cindra PDF fixture');

    const offscreenOpen = await serviceWorker.evaluate(async () =>
      chrome.offscreen.hasDocument ? chrome.offscreen.hasDocument() : false);
    expect(offscreenOpen).toBe(false);
  } finally {
    await context.close();
  }
});

test('concurrent PDF requests serialize without racing the offscreen document', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const url = 'https://fixture.local/concurrent.pdf';
    const pdf = createTextPdf('Concurrent fixture');
    await context.route('https://fixture.local/**', route => {
      if (new URL(route.request().url()).pathname.endsWith('.pdf')) {
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: pdf });
      }
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>PDF holder</title>' });
    });

    const page = await context.newPage();
    await page.goto('https://fixture.local/holder');
    const results = await serviceWorker.evaluate(async url => {
      const tabs = await chrome.tabs.query({ url: 'https://fixture.local/*' });
      const tab = { id: tabs[0]?.id, url };
      return Promise.all([
        CindraBackgroundPdf.extractFullText(tab),
        CindraBackgroundPdf.extractFullText(tab)
      ]);
    }, url);
    expect(results).toEqual([
      expect.stringContaining('Concurrent fixture'),
      expect.stringContaining('Concurrent fixture')
    ]);
  } finally {
    await context.close();
  }
});
