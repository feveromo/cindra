const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const providers = require('../../lib/providers.js');
const prompt = require('../../lib/prompt.js');

function createUiHarness(script, initial = {}) {
  const elements = new Map();
  const listeners = new Set();
  const sync = structuredClone(initial);
  const local = {};
  const writes = [];
  let nextRead = null;
  let nextWriteError = null;
  const document = {
    readyState: 'loading', activeElement: null,
    addEventListener() {}, removeEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: () => element(), createDocumentFragment: () => element(),
    querySelector: () => null, querySelectorAll: () => [],
    body: { classList: { add() {}, remove() {} } }
  };
  function element() {
    return {
      value: '', textContent: '', hidden: false, disabled: false,
      dataset: {}, children: [], events: {}, isConnected: true,
      classList: { add() {}, remove() {} },
      addEventListener(name, handler) { (this.events[name] ||= []).push(handler); },
      removeEventListener(name, handler) { this.events[name] = (this.events[name] || []).filter(fn => fn !== handler); },
      dispatch(name, event = {}) { for (const fn of this.events[name] || []) fn({ preventDefault() {}, ...event }); },
      appendChild(child) { this.children.push(child); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {}, querySelectorAll: () => [],
      focus() { document.activeElement = this; }
    };
  }
  const chrome = {
    storage: { sync, local, onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } },
    runtime: { getManifest: () => ({ version: 'test' }) }
  };
  const chromeApi = {
    async storageGet(area, keys) {
      if (nextRead) { const read = nextRead; nextRead = null; await read; }
      const data = Array.isArray(keys)
        ? Object.fromEntries(keys.map(key => [key, area[key]]))
        : { ...keys, ...area };
      return structuredClone(data);
    },
    async storageSet(area, items) {
      if (nextWriteError) { const error = nextWriteError; nextWriteError = null; throw error; }
      writes.push(structuredClone(items));
      Object.assign(area, structuredClone(items));
    },
    async storageRemove(area, keys) { for (const key of keys) delete area[key]; },
    async tabsQuery() { return [{ id: 1, url: 'https://example.com', title: 'Fixture' }]; }
  };
  const messages = [];
  const context = vm.createContext({
    document, chrome, console, URL, Promise, Date, Math,
    CindraChrome: chromeApi, CindraProviders: providers, CindraPrompt: prompt,
    CindraMessages: { ACTIONS: { SUMMARIZE: 'summarize', RESEND_SUMMARY: 'resendSummary' }, async runtimeSendMessage(message) { messages.push(message); return { success: true }; } },
    CindraErrors: { logError() {} },
    CindraTheme: { normalizeTheme: theme => ['light', 'dark'].includes(theme) ? theme : 'auto', applyTheme() {}, cleanup() {} },
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../..', script), 'utf8'), context);
  return {
    context, elements, sync, local, writes, messages, chromeApi,
    emitStorage(changes, area = 'sync') { for (const listener of listeners) listener(changes, area); },
    failNextWrite(error) { nextWriteError = error; },
    deferNextRead() {
      let resolve; nextRead = new Promise(done => { resolve = done; }); return resolve;
    }
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
module.exports = { createUiHarness, flush };
