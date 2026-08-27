const META_PLAYGROUND_MODEL_ID = 'muse-spark-1.2-contributor';

function findMetaModelCombobox() {
  return Array.from(document.querySelectorAll('[role="combobox"]')).find(element => {
    const listboxId = element.getAttribute('aria-controls');
    const listbox = listboxId ? document.getElementById(listboxId) : null;
    const options = Array.from(listbox?.querySelectorAll('[role="option"]') || []);
    return listbox?.getAttribute('aria-label') === 'Select a model' || options.some(option =>
      option.textContent?.trim() === META_PLAYGROUND_MODEL_ID
    );
  }) || null;
}

function selectedMetaModelId() {
  return findMetaModelCombobox()?.textContent?.trim() || '';
}

async function ensureMetaContributorModel({ signal }) {
  const modelCombobox = await CindraInject.waitForCondition(findMetaModelCombobox, {
    timeoutMs: 10000,
    signal,
    description: 'Meta AI Playground model selector'
  });
  if (selectedMetaModelId() === META_PLAYGROUND_MODEL_ID) return;

  CindraInject.nativeClick(modelCombobox);
  const modelListboxId = modelCombobox.getAttribute('aria-controls');
  const modelOption = await CindraInject.waitForCondition(() => {
    const listbox = modelListboxId ? document.getElementById(modelListboxId) : null;
    return Array.from(listbox?.querySelectorAll('[role="option"]') || []).find(element =>
      element.textContent?.trim() === META_PLAYGROUND_MODEL_ID
    ) || null;
  }, {
    timeoutMs: 5000,
    signal,
    description: 'Muse Spark 1.2 Contributor option'
  });
  CindraInject.nativeClick(modelOption);

  await CindraInject.waitForCondition(
    () => selectedMetaModelId() === META_PLAYGROUND_MODEL_ID,
    {
      timeoutMs: 10000,
      signal,
      description: 'Muse Spark 1.2 Contributor selection'
    }
  );
}

CindraProviderRuntime.registerAdapter({
  providerId: 'meta-playground',
  inputSelectors: [
    'textarea[aria-label="Message"]',
    'textarea[placeholder="Ask Meta…"]',
    'textarea[placeholder^="Ask Meta"]'
  ],
  inputTimeoutMs: 15000,
  beforeInput: ensureMetaContributorModel,
  settleMs: 250,
  submitSelectors: 'button[aria-label="Send"]:not([disabled]):not([aria-disabled="true"])',
  submitTimeoutMs: 5000,
  clickMode: 'native'
});
