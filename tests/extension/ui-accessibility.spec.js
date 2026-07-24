const { test, expect } = require('@playwright/test');
const { extensionId, launchExtensionContext } = require('./helpers.js');

test('prompt editor traps focus, validates inline, and restores focus', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId(serviceWorker)}/ui/options/options.html`);

    const addButton = page.locator('#add-prompt-btn');
    await addButton.focus();
    await addButton.click();

    const modal = page.locator('#prompt-modal');
    const dialog = page.locator('#prompt-form');
    await expect(modal).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#prompt-name')).toBeFocused();

    await page.locator('#modal-save').click();
    await expect(page.locator('#modal-status')).toHaveText('Enter a prompt name.');
    await expect(page.locator('#prompt-name')).toBeFocused();

    await page.locator('#prompt-name').fill('Fixture prompt');
    await page.locator('#prompt-text').fill('Summarize the fixture with clear evidence.');
    await page.locator('#modal-save').click();
    await expect(modal).toBeHidden();
    const fixturePrompt = page.locator('.prompt-item', { hasText: 'Fixture prompt' });
    await expect(fixturePrompt).toHaveCount(1);
    const fixturePromptId = await fixturePrompt.getAttribute('data-id');
    await fixturePrompt.locator('button[data-action="activate"]').click();
    await expect.poll(() => serviceWorker.evaluate(() =>
      chrome.storage.sync.get(['activePromptId']).then(result => result.activePromptId)
    )).toBe(fixturePromptId);

    await addButton.click();
    await expect(page.locator('#prompt-name')).toBeFocused();
    await page.locator('#modal-close').focus();
    await page.locator('#modal-close').press('Shift+Tab');
    await expect(page.locator('#modal-save')).toBeFocused();
    await page.locator('#modal-save').press('Escape');
    await expect(modal).toBeHidden();
    await expect(addButton).toBeFocused();
  } finally {
    await context.close();
  }
});

test('automatic theme follows live system color-scheme changes', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`chrome-extension://${extensionId(serviceWorker)}/ui/options/options.html`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  } finally {
    await context.close();
  }
});

test('popup exposes semantic controls and sanitizes status state classes', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    await serviceWorker.evaluate(() => chrome.storage.local.set({
      cindraLastStatus: { state: 'evil-class', message: 'Fixture status' }
    }));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId(serviceWorker)}/ui/popup/popup.html`);

    await expect(page.locator('main[aria-labelledby="page-title"]')).toHaveCount(1);
    await expect(page.locator('#summarize-btn')).toHaveJSProperty('tagName', 'BUTTON');
    await expect(page.locator('#handoff-status')).toHaveClass(/is-idle/);
    await expect(page.locator('#handoff-status')).not.toHaveClass(/evil-class/);
    await expect(page.locator('kbd')).toHaveCount(3);
  } finally {
    await context.close();
  }
});
