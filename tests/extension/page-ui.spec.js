const { test, expect } = require('@playwright/test');
const { launchExtensionContext } = require('./helpers.js');

test('generic page controls are accessible and survive reinjection without duplicates', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const page = await context.newPage();
    await page.route('https://fixture.local/page-ui', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html>
        <html><body>
          <button id="before">Before selection</button>
          <main><p id="selected">Selected fixture sentence for Cindra.</p></main>
        </body></html>`
    }));
    await page.goto('https://fixture.local/page-ui');
    await page.bringToFront();

    const launcherHost = page.locator('[data-cindra-ui="floating-button"]');
    await expect(launcherHost).toHaveCount(1);
    await expect(launcherHost.locator('#summarize')).toHaveJSProperty('tagName', 'BUTTON');
    await expect(launcherHost.locator('#close')).toHaveAttribute('aria-label', 'Hide Cindra summarize button');

    await page.evaluate(() => {
      document.getElementById('before').focus();
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('selected'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.getElementById('selected').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const composerHost = page.locator('[data-cindra-ui="selection-composer"]');
    await expect(composerHost).toBeVisible();
    await expect(composerHost.locator('#dialog')).toHaveAttribute('role', 'dialog');
    await expect(composerHost.locator('#dialog')).toHaveAttribute('aria-modal', 'true');
    await expect(composerHost.locator('#status')).toHaveAttribute('aria-live', 'polite');
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('[data-cindra-ui="selection-composer"]')?.shadowRoot?.activeElement?.id
    )).toBe('question');

    await composerHost.locator('#question').press('Tab');
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('[data-cindra-ui="selection-composer"]')?.shadowRoot?.activeElement?.id
    )).toBe('summarize');

    await composerHost.locator('#summarize').press('Escape');
    await expect(composerHost).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('before');

    await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content_scripts/lib/page_ui.js', 'content_scripts/content.js']
      });
    });

    await expect(page.locator('[data-cindra-ui="floating-button"]')).toHaveCount(1);
    await expect(page.locator('[data-cindra-ui="selection-composer"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('generic page controls stay off provider destinations', async () => {
  const { context } = await launchExtensionContext();
  try {
    const page = await context.newPage();
    await page.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><main>Provider fixture</main></body></html>'
    }));
    await page.goto('https://chatgpt.com/');
    await page.waitForTimeout(250);
    await expect(page.locator('[data-cindra-ui]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
