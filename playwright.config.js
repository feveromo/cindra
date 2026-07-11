// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/extension',
  timeout: 60000,
  workers: 1,
  use: {
    browserName: 'chromium',
    trace: 'retain-on-failure'
  }
});
