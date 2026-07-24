const { test, expect } = require('@playwright/test');
const { launchExtensionContext } = require('./helpers.js');

test('YouTube transcript control is lifecycle-managed across SPA navigation', async () => {
  const { context } = await launchExtensionContext();
  try {
    const page = await context.newPage();
    await page.route('https://www.youtube.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html>
        <html><body>
          <ytd-page-manager>
            <ytd-watch-metadata>
              <div id="above-the-fold"><div id="top-row"><div id="subscribe-button"></div></div></div>
            </ytd-watch-metadata>
          </ytd-page-manager>
        </body></html>`
    }));
    await page.goto('https://www.youtube.com/watch?v=abc123');

    const control = page.locator('[data-cindra-ui="youtube-transcript-copy"]');
    await expect(control).toHaveCount(1);
    await expect(control.locator('#copy')).toHaveJSProperty('tagName', 'BUTTON');
    await expect(control.locator('#copy')).toHaveAttribute('aria-label', 'Copy YouTube transcript');
    await expect(control.locator('#status')).toHaveAttribute('aria-live', 'polite');

    await page.evaluate(() => {
      const topRow = document.getElementById('top-row');
      for (let index = 0; index < 25; index += 1) {
        const node = document.createElement('span');
        node.textContent = String(index);
        topRow.appendChild(node);
      }
    });
    await page.waitForTimeout(250);
    await expect(control).toHaveCount(1);

    await page.evaluate(() => {
      history.pushState({}, '', '/feed/subscriptions');
      window.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await expect(control).toHaveCount(0);

    await page.evaluate(() => {
      history.pushState({}, '', '/watch?v=xyz789');
      window.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await expect(control).toHaveCount(1);
  } finally {
    await context.close();
  }
});
