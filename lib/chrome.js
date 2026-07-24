(function (root, factory) {
  'use strict';

  const errors = typeof module === 'object' && module.exports
    ? require('./errors.js')
    : root.CindraErrors;
  const api = factory(root, errors);
  root.CindraChrome = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, errors) {
  'use strict';

  function callbackPromise(invoke, context, runtime = root.chrome?.runtime) {
    return new Promise((resolve, reject) => {
      try {
        invoke((result) => {
          const lastError = runtime?.lastError;
          if (lastError) {
            reject(errors.fromChromeLastError(lastError, context));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(errors.wrap(context, error, 'Cindra could not communicate with the browser.'));
      }
    });
  }

  function storageGet(area, keys) {
    return callbackPromise(
      callback => area.get(keys, callback),
      'chrome.storage.get'
    ).then(result => result || {});
  }

  function storageSet(area, items) {
    return callbackPromise(
      callback => area.set(items, callback),
      'chrome.storage.set'
    );
  }

  function storageRemove(area, keys) {
    return callbackPromise(
      callback => area.remove(keys, callback),
      'chrome.storage.remove'
    );
  }

  function tabsGet(tabId) {
    return callbackPromise(
      callback => root.chrome.tabs.get(tabId, callback),
      `chrome.tabs.get(${tabId})`
    );
  }

  function tabsQuery(queryInfo) {
    return callbackPromise(
      callback => root.chrome.tabs.query(queryInfo, callback),
      'chrome.tabs.query'
    ).then(tabs => tabs || []);
  }

  function tabsCreate(createProperties) {
    return callbackPromise(
      callback => root.chrome.tabs.create(createProperties, callback),
      'chrome.tabs.create'
    );
  }

  function tabsUpdate(tabId, updateProperties) {
    return callbackPromise(
      callback => root.chrome.tabs.update(tabId, updateProperties, callback),
      `chrome.tabs.update(${tabId})`
    );
  }

  function executeScript(injection) {
    return callbackPromise(
      callback => root.chrome.scripting.executeScript(injection, callback),
      'chrome.scripting.executeScript'
    ).then(results => results || []);
  }

  return {
    callbackPromise,
    executeScript,
    storageGet,
    storageRemove,
    storageSet,
    tabsCreate,
    tabsGet,
    tabsQuery,
    tabsUpdate
  };
});
