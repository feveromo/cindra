[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/feveromo/cindra)

# Cindra Summary

Cindra Summary is a Chrome extension that sends the current page, selected text, PDF text, YouTube transcript, or Reddit thread to your preferred AI chat for summarization.

## What it does

- Summarizes the current page from the popup
- Supports a keyboard shortcut: `Ctrl + X + X`
- Can show a floating summarize button on regular webpages
- Stores reusable prompt presets
- Can send the full page or only selected text
- Can extract text from PDFs when available
- Opens an optional on-page composer when you highlight text so you can ask a question about that exact selection
- Shows handoff status with copy/resend recovery for the last generated prompt
- Lets you clear or disable saved prompt handoff history
- Routes content into multiple AI destinations without using an API key directly
- Confirms provider handoffs and keeps a failed prompt available for copy or retry

## Screenshots

### Toolbar popup

<p align="center">
  <img src="images/screenshots/popup-main.png" alt="Cindra toolbar popup" width="320">
  <img src="images/screenshots/popup-prompts.png" alt="Cindra toolbar popup prompt controls" width="320">
</p>

### Settings page

<p align="center">
  <img src="images/screenshots/settings-light.png" alt="Cindra settings page in light mode" width="48%">
  <img src="images/screenshots/settings-dark.png" alt="Cindra settings page in dark mode" width="48%">
</p>

## Supported destinations

- Google AI Studio
- Gemini
- Perplexity
- Grok
- Claude
- ChatGPT
- Google Learning
- DeepSeek
- GLM (Z.AI)
- Kimi
- HuggingChat
- Qwen
- Cerebras

## Content sources

- Regular webpages
- Selected text from the current page
- PDFs with extractable text
- YouTube videos with transcript extraction
- Reddit threads and posts

## Known limitations

- Very long pages may be trimmed in the middle to stay within browser and provider limits; some providers (e.g. Perplexity) have a stricter per-query character limit, in which case the content is trimmed further before the handoff
- Scanned PDFs need OCR elsewhere before Cindra can summarize their text
- Provider integrations depend on each site's live DOM, so breakage can happen when those UIs change

## Permissions and local data

Cindra runs its shortcut, floating button, and selection composer on regular webpages, so Chrome asks for access to HTTP and HTTPS sites. That access is also used only after an explicit Cindra action to read the selected page and, for PDFs, download the current document in an isolated extension page.

Prompts and extracted page content are sent only to the AI destination you select. The optional handoff history is stored in `chrome.storage.local`, keeps at most five prompts, and can be disabled or cleared from Settings.

## Installation

1. Clone the repository:

```bash
git clone https://github.com/feveromo/cindra.git
cd cindra
```

2. Open `chrome://extensions/`
3. Enable Developer Mode
4. Click `Load unpacked`
5. Select this repository folder

## Usage

1. Open the extension popup
2. Pick a destination AI service
3. Pick or edit a prompt preset
4. Pick the content source if you want selected text, page text, or PDF text specifically
5. Click `Summarize Current Page`

You can also use `Ctrl + X + X` on a page, the floating button if it is enabled in settings, or highlight text and use the on-page composer to ask a focused question.

## Project structure

```text
cindra/
├── background/          # MV3 service worker and routing logic
├── content_scripts/     # Site-specific integrations and generic page shortcut UI
│   └── lib/             # Shared injection, provider-runtime, and parser helpers
├── lib/                 # Shared provider/source registry
├── images/              # Extension icons
├── ui/
│   ├── options/         # Settings page
│   ├── popup/           # Popup UI
│   └── theme.js         # Shared CindraTheme helper (FOUC guard + theme apply)
├── offscreen/           # Isolated PDF text extraction page
├── tests/               # Node unit tests and deterministic extension fixtures
├── vendor/              # Pinned PDF.js runtime, assets, version, and license
└── manifest.json
```

The vendored PDF parser is PDF.js 6.1.200. It is loaded entirely from the extension package, runs with JavaScript evaluation disabled, and is covered by the Apache 2.0 license in `vendor/pdfjs/LICENSE`.

## Development checks

Install the test dependencies with `pnpm install`, then run:

```bash
pnpm check
pnpm test
```

`pnpm check` validates JavaScript syntax, manifest references, synchronized versions, and removal of development-only probe code. The unit suite covers routing, prompt limits, PDF validation, provider registration, and YouTube response parsing. The Playwright suite loads the unpacked extension against deterministic provider/PDF fixtures; it does not contact or monitor live AI sites.

## Adding a provider

1. Add a content script in `content_scripts/`
2. Register it in `manifest.json`, listing `content_scripts/lib/inject.js` and then `content_scripts/lib/provider_runtime.js` before the provider adapter
3. Add the provider metadata to `lib/providers.js` (set `maxContentChars` if the destination enforces a per-query limit)
4. Register the adapter with `globalThis.CindraProviderRuntime` and use the shared `globalThis.CindraInject` helpers (`waitForElement`, `insertTextIntoTextarea`, `robustClick`, `normalizeWhitespace`); keep only site-specific DOM insertion logic in the adapter

## License

MIT. See [LICENSE](LICENSE).
