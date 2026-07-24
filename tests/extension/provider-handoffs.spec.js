const { test, expect } = require('@playwright/test');
const { launchExtensionContext, extensionId } = require('./helpers.js');

const providers = [
  {
    id: 'google-ai-studio',
    url: 'https://aistudio.google.com/app/prompts/new_chat',
    body: '<textarea formcontrolname="promptText"></textarea><ms-run-button><button type="submit" data-submit>Run</button></ms-run-button>'
  },
  {
    id: 'gemini',
    url: 'https://gemini.google.com/app/fixture',
    body: '<div class="ql-editor" contenteditable="true" aria-label="Enter a prompt here"></div><button class="send-button" aria-label="Send message" data-submit>Send</button>'
  },
  {
    id: 'perplexity',
    url: 'https://www.perplexity.ai/fixture',
    body: '<div id="ask-input" contenteditable="true" role="textbox"></div><button data-testid="submit-button" data-submit>Send</button>'
  },
  {
    id: 'grok',
    url: 'https://grok.com/fixture',
    body: '<div class="tiptap ProseMirror" contenteditable="true"></div><button aria-label="Submit" data-submit>Send</button>'
  },
  {
    id: 'claude',
    url: 'https://claude.ai/fixture',
    body: '<div class="ProseMirror" contenteditable="true"></div><button aria-label="Send message" data-submit>Send</button>'
  },
  {
    id: 'chatgpt',
    url: 'https://chatgpt.com/fixture',
    body: '<textarea id="prompt-textarea"></textarea><button data-testid="send-button" data-submit>Send</button>'
  },
  {
    id: 'google-learning',
    url: 'https://learning.google.com/experiments/learn-about/fixture',
    body: '<textarea placeholder="Ask Learn About"></textarea><span style="font-family: Google Symbols; cursor: pointer" data-submit>send</span>'
  },
  {
    id: 'deepseek',
    url: 'https://chat.deepseek.com/fixture',
    body: '<textarea placeholder="Message DeepSeek"></textarea><div class="bf38813a"><div role="button" class="ds-button--primary ds-button--circle" data-submit>Send</div></div>'
  },
  {
    id: 'glm',
    url: 'https://chat.z.ai/fixture',
    body: '<button aria-label="Select a model" data-model>Current Model</button><textarea id="chat-input"></textarea><button id="send-message-button" data-submit>Send</button>'
  },
  {
    id: 'kimi',
    url: 'https://kimi.com/fixture',
    body: '<div class="chat-input-editor" contenteditable="true"></div><div class="send-button-container"><button class="send-button" data-submit>Send</button></div>'
  },
  {
    id: 'huggingchat',
    url: 'https://huggingface.co/chat/fixture',
    body: '<textarea placeholder="Ask anything"></textarea><button type="submit" aria-label="Send message" data-submit>Send</button>'
  },
  {
    id: 'qwen',
    url: 'https://chat.qwen.ai/fixture',
    body: '<header id="qwen-chat-header-left"><button class="ant-dropdown-trigger" data-model>Current Model</button></header><textarea id="chat-input"></textarea><button type="submit" data-submit>Send</button>'
  },
  {
    id: 'cerebras',
    url: 'https://chat.cerebras.ai/fixture',
    body: '<textarea class="g-recaptcha-response"></textarea><main><section><div><textarea placeholder="What do you want to know?"></textarea><div><button aria-label="Add images"><svg width="24" height="24"></svg></button><button data-submit><svg width="24" height="24" class="lucide lucide-arrow-up"></svg></button></div></div></section></main>'
  }
];

function fixtureHtml(body) {
  return `<!doctype html>
    <html><body>${body}
      <script>
        window.__submitted = 0;
        window.__submittedPrompt = '';
        window.__modelClicks = 0;
        document.querySelectorAll('[data-submit]').forEach(element => {
          element.addEventListener('click', event => {
            event.preventDefault();
            window.__submitted += 1;
            const input = document.querySelector('textarea:not(.g-recaptcha-response), [contenteditable="true"]');
            window.__submittedPrompt = input?.value || input?.textContent || '';
          });
        });
        document.querySelectorAll('[data-model]').forEach(element => {
          element.addEventListener('click', () => { window.__modelClicks += 1; });
        });
      </script>
    </body></html>`;
}

async function deliverHandoff(serviceWorker, url, providerId, promptText, suffix = '') {
  return serviceWorker.evaluate(async ({ url, providerId, promptText, suffix }) => {
    const handoff = {
      id: `test-${providerId}-${suffix}-${Date.now()}`,
      summaryId: `summary-${providerId}`,
      providerId,
      promptText,
      title: 'Fixture title',
      createdAt: Date.now()
    };
    await chrome.storage.local.set({ [`cindraPendingHandoff:${providerId}`]: handoff });
    const tabs = await chrome.tabs.query({ url: `${new URL(url).origin}/*` });
    if (!tabs[0]) return { success: false, error: 'fixture tab missing' };
    return chrome.tabs.sendMessage(tabs[0].id, { action: 'insertPrompt', handoff });
  }, { url, providerId, promptText, suffix });
}

test('all provider adapters acknowledge a completed fixture handoff', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    for (const provider of providers) {
      const page = await context.newPage();
      await page.route(`${new URL(provider.url).origin}/**`, route => route.fulfill({
        contentType: 'text/html',
        body: fixtureHtml(provider.body)
      }));
      await page.goto(provider.url);
      await page.waitForLoadState('domcontentloaded');

      const response = await deliverHandoff(
        serviceWorker,
        provider.url,
        provider.id,
        `Fixture prompt for ${provider.id}`,
        'direct'
      );
      expect(response, `${provider.id}: ${response?.error || 'unknown error'}`)
        .toMatchObject({ success: true });
      await expect.poll(() => page.evaluate(() => window.__submitted), { message: provider.id }).toBe(1);

      if (provider.id === 'qwen' || provider.id === 'glm') {
        expect(await page.evaluate(() => window.__modelClicks), `${provider.id} model`).toBe(0);
      }

      const pending = await serviceWorker.evaluate(providerId =>
        chrome.storage.local.get([`cindraPendingHandoff:${providerId}`]), provider.id);
      expect(pending[`cindraPendingHandoff:${provider.id}`], `${provider.id} pending storage`).toBeUndefined();
      await page.close();
    }
  } finally {
    await context.close();
  }
});

test('Cerebras submits the exact bounded prompt instead of the rejected original', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const provider = providers.find(item => item.id === 'cerebras');
    const page = await context.newPage();
    await page.route(`${new URL(provider.url).origin}/**`, route => route.fulfill({
      contentType: 'text/html',
      body: fixtureHtml(provider.body)
    }));
    await page.goto(provider.url);

    const prompt = `${'A'.repeat(16000)}MIDDLE${'Z'.repeat(12000)}`;
    const response = await deliverHandoff(
      serviceWorker,
      provider.url,
      provider.id,
      prompt,
      'bounded'
    );
    expect(response).toMatchObject({ success: true });
    await expect.poll(() => page.evaluate(() => window.__submitted)).toBe(1);

    const submittedPrompt = await page.evaluate(() => window.__submittedPrompt);
    expect(submittedPrompt).toHaveLength(18000);
    expect(submittedPrompt).toMatch(/^A+/);
    expect(submittedPrompt).toMatch(/characters were omitted from the middle/);
    expect(submittedPrompt).toMatch(/Z+$/);
  } finally {
    await context.close();
  }
});

test('a queued prompt is submitted once after the provider page loads', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const provider = providers.find(item => item.id === 'chatgpt');
    const handoff = {
      id: `startup-${Date.now()}`,
      summaryId: 'startup-summary',
      providerId: provider.id,
      promptText: 'Startup fixture prompt',
      title: 'Startup fixture',
      createdAt: Date.now()
    };
    await serviceWorker.evaluate(handoff =>
      chrome.storage.local.set({ [`cindraPendingHandoff:${handoff.providerId}`]: handoff }), handoff);

    const page = await context.newPage();
    await page.route(`${new URL(provider.url).origin}/**`, route => route.fulfill({
      contentType: 'text/html',
      body: fixtureHtml(provider.body)
    }));
    await page.goto(provider.url);
    await expect.poll(() => page.evaluate(() => window.__submitted)).toBe(1);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__submitted)).toBe(1);
  } finally {
    await context.close();
  }
});

test('two provider tabs cannot submit the same queued handoff', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const provider = providers.find(item => item.id === 'chatgpt');
    const handoff = {
      id: `two-tabs-${Date.now()}`,
      summaryId: 'two-tabs-summary',
      providerId: provider.id,
      promptText: 'Exactly once fixture',
      title: 'Exactly once',
      createdAt: Date.now()
    };
    await serviceWorker.evaluate(handoff =>
      chrome.storage.local.set({ [`cindraPendingHandoff:${handoff.providerId}`]: handoff }), handoff);

    const pages = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all(pages.map(page => page.route(`${new URL(provider.url).origin}/**`, route => route.fulfill({
      contentType: 'text/html',
      body: fixtureHtml(provider.body)
    }))));
    await Promise.all(pages.map(page => page.goto(provider.url)));

    await expect.poll(async () => {
      const counts = await Promise.all(pages.map(page => page.evaluate(() => window.__submitted)));
      return counts.reduce((sum, count) => sum + count, 0);
    }).toBe(1);
    await pages[0].waitForTimeout(1500);
    const counts = await Promise.all(pages.map(page => page.evaluate(() => window.__submitted)));
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
  } finally {
    await context.close();
  }
});

test('adapter failures retain the pending handoff for recovery', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const provider = providers.find(item => item.id === 'deepseek');
    const page = await context.newPage();
    await page.route(`${new URL(provider.url).origin}/**`, route => route.fulfill({
      contentType: 'text/html',
      body: fixtureHtml('<textarea placeholder="Message DeepSeek"></textarea>')
    }));
    await page.goto(provider.url);

    const response = await deliverHandoff(serviceWorker, provider.url, provider.id, 'Retain me', 'failure');
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/Timeout waiting for DeepSeek submit control/);

    const pending = await serviceWorker.evaluate(providerId =>
      chrome.storage.local.get([`cindraPendingHandoff:${providerId}`]), provider.id);
    expect(pending[`cindraPendingHandoff:${provider.id}`]?.promptText).toBe('Retain me');
  } finally {
    await context.close();
  }
});

test('fresh legacy prompts migrate while expired envelopes are discarded', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const legacyProvider = providers.find(item => item.id === 'gemini');
    await serviceWorker.evaluate(() => chrome.storage.local.set({
      pendingGeminiPrompt: 'Legacy fixture prompt',
      geminiPromptTimestamp: Date.now()
    }));
    const legacyPage = await context.newPage();
    await legacyPage.route(`${new URL(legacyProvider.url).origin}/**`, route => route.fulfill({
      contentType: 'text/html',
      body: fixtureHtml(legacyProvider.body)
    }));
    await legacyPage.goto(legacyProvider.url);
    await expect.poll(() => legacyPage.evaluate(() => window.__submitted)).toBe(1);
    const legacyState = await serviceWorker.evaluate(() =>
      chrome.storage.local.get(['pendingGeminiPrompt', 'geminiPromptTimestamp']));
    expect(legacyState).toEqual({});

    const expiredProvider = providers.find(item => item.id === 'qwen');
    const expired = {
      id: 'expired-fixture',
      providerId: expiredProvider.id,
      promptText: 'Do not submit',
      title: 'Expired',
      createdAt: Date.now() - 5 * 60 * 1000
    };
    await serviceWorker.evaluate(expired => chrome.storage.local.set({
      [`cindraPendingHandoff:${expired.providerId}`]: expired
    }), expired);
    const expiredPage = await context.newPage();
    await expiredPage.route(`${new URL(expiredProvider.url).origin}/**`, route => route.fulfill({
      contentType: 'text/html',
      body: fixtureHtml(expiredProvider.body)
    }));
    await expiredPage.goto(expiredProvider.url);
    await expiredPage.waitForTimeout(1200);
    expect(await expiredPage.evaluate(() => window.__submitted)).toBe(0);
    const expiredState = await serviceWorker.evaluate(() =>
      chrome.storage.local.get(['cindraPendingHandoff:qwen']));
    expect(expiredState).toEqual({});
  } finally {
    await context.close();
  }
});

test('popup renders every provider and persists its source selection', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId(serviceWorker)}/ui/popup/popup.html`);
    await expect(page.locator('#ai-model option')).toHaveCount(13);
    await expect(page.locator('#content-source option')).toHaveCount(4);
    await page.selectOption('#content-source', 'selection');
    await expect.poll(() => serviceWorker.evaluate(() =>
      chrome.storage.sync.get(['contentSource']).then(result => result.contentSource))).toBe('selection');
    await expect(page.locator('#probe-site-btn')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('options page persists workflow settings', async () => {
  const { context, serviceWorker } = await launchExtensionContext();
  try {
    await serviceWorker.evaluate(() => chrome.storage.local.set({
      cindraRecentSummaries: [{ id: 'history-fixture', promptText: 'Sensitive fixture' }]
    }));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId(serviceWorker)}/ui/options/options.html`);
    await expect(page.locator('#ai-model option')).toHaveCount(13);

    await page.selectOption('#ai-model', 'qwen');
    await page.check('input[name="content-source"][value="pdf"]');
    await page.check('input[name="theme"][value="dark"]');
    await page.check('input[name="floating-button"][value="hidden"]');
    await page.check('input[name="prompt-history"][value="disabled"]');
    await page.click('#save-btn');

    await expect.poll(() => serviceWorker.evaluate(async () => {
      const state = await chrome.storage.sync.get(['aiModel', 'contentSource', 'theme', 'floatingButton']);
      return [state.aiModel, state.contentSource, state.theme, state.floatingButton].join('|');
    })).toBe('qwen|pdf|dark|hidden');
    await expect.poll(() => serviceWorker.evaluate(async () => {
      const state = await chrome.storage.local.get(['cindraRecentSummaries']);
      return state.cindraRecentSummaries;
    })).toBeUndefined();
  } finally {
    await context.close();
  }
});
