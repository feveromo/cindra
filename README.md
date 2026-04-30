[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/feveromo/cindra)

# Cindra Summary

Cindra Summary is a Chrome extension that sends the current page, YouTube transcript, or Reddit thread to your preferred AI chat for summarization.

## What it does

- Summarizes the current page from the popup
- Supports a keyboard shortcut: `Ctrl + X + X`
- Can show a floating summarize button on regular webpages
- Stores reusable prompt presets
- Routes content into multiple AI destinations without using an API key directly

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

## Content sources

- Regular webpages
- YouTube videos with transcript extraction
- Reddit threads and posts

## Known limitations

- PDF extraction is not implemented yet
- Provider integrations depend on each site's live DOM, so breakage can happen when those UIs change

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
4. Click `Summarize Current Page`

You can also use `Ctrl + X + X` on a page, or the floating button if it is enabled in settings.

## Project structure

```text
cindra/
├── background/          # MV3 service worker and routing logic
├── content_scripts/     # Site-specific integrations and generic page shortcut UI
├── images/              # Extension icons
├── ui/
│   ├── options/         # Settings page
│   └── popup/           # Popup UI
└── manifest.json
```

## Adding a provider

1. Add a content script in `content_scripts/`
2. Register it in `manifest.json`
3. Add the provider to the popup and options UI
4. Add the routing case in `background/background.js`

## License

MIT. See [LICENSE](LICENSE).
