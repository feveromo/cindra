const { test, expect } = require('@playwright/test');
const { launchExtensionContext } = require('./helpers.js');

async function extractFromActiveTab(serviceWorker, contentSource) {
  return serviceWorker.evaluate(async contentSource => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: CindraBackgroundContent.getPageContent,
      args: [contentSource]
    });
    return result.result;
  }, contentSource);
}

test('page and selection extraction exclude surrounding controls', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const page = await context.newPage();
    await page.route('https://fixture.local/article', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>Fixture article</title>
        <meta name="description" content="Fixture description">
        <nav>Navigation noise</nav>
        <article>
          <h1>Useful title</h1>
          <p id="selected">Selected fixture sentence.</p>
          <button>Control noise</button>
          <p>Remaining article body.</p>
        </article>`
    }));
    await page.goto('https://fixture.local/article');
    await page.bringToFront();

    const pageResult = await extractFromActiveTab(serviceWorker, 'page');
    expect(pageResult).toMatchObject({
      title: 'Fixture article',
      description: 'Fixture description',
      sourceType: 'page'
    });
    expect(pageResult.content).toContain('Useful title');
    expect(pageResult.content).toContain('Remaining article body.');
    expect(pageResult.content).not.toContain('Navigation noise');
    expect(pageResult.content).not.toContain('Control noise');

    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('selected'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const selectionResult = await extractFromActiveTab(serviceWorker, 'selection');
    expect(selectionResult.content).toBe('Selected fixture sentence.');
    expect(selectionResult.sourceType).toBe('selection');
  } finally {
    await context.close();
  }
});
