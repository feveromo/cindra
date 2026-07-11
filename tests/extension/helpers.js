const path = require('node:path');
const { chromium } = require('@playwright/test');

const extensionPath = path.join(__dirname, '..', '..');

async function launchExtensionContext() {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
  return { context, serviceWorker };
}

function extensionId(serviceWorker) {
  return new URL(serviceWorker.url()).hostname;
}

module.exports = { extensionPath, launchExtensionContext, extensionId };
