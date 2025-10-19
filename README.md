# Cindra Summary - Browser Extension

A powerful browser extension that helps you summarize web content using various AI services. Simply select text on any webpage and get instant summaries from your preferred AI model.

## Features

- **Multi-AI Support**: Works with ChatGPT, Claude, Gemini, Grok, Perplexity, Google AI Studio, and more
- **Custom Prompts**: Use your own custom prompts for different types of summaries
- **Clean Interface**: Simple popup interface for quick access

## Supported AI Services

- **ChatGPT** (chat.openai.com)
- **Claude** (claude.ai)
- **Gemini** (gemini.google.com)
- **Grok** (grok.com)
- **Perplexity** (perplexity.ai)
- **Google AI Studio** (aistudio.google.com)
- **DeepSeek** (deepseek.com)
- **Google Learning** (learning.google.com)
- **GLM** (chat.z.ai)
- **Kimi** (kimi.com)
- **HuggingChat** (huggingface.co/chat)

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/feveromo/cindra.git
   cd cindra
   ```

2. Open your browser and navigate to the extensions page:
   - **Chrome**: `chrome://extensions/`

3. Enable "Developer mode" (Chrome)

4. Click "Load unpacked" (Chrome)

5. Select the `cindra` folder from this repository

## Usage

1. **Open Extension**: Click the Cindra Summary extension icon in your browser toolbar
2. **Choose AI Model**: Select your preferred AI service from the dropdown
3. **Customize Prompt** (Optional): Modify the default prompt to suit your needs
4. **Generate Summary**: Click "Summarize Current Page" or, more conveniently, use the keyboard shortcut (CTRL + X + X) to open the selected AI service with your content and prompt.

## Configuration

### Setting Default AI Model

1. Left-click the extension icon in the toolbar
2. Choose your preferred AI model from the available options
3. Configure your custom summarization prompt
4. Your selection will be saved and used as the default

### Custom Prompts

You can customize the prompt used for summarization:
- Use the popup interface to modify prompts before each use
- The extension will remember your last used prompt

## Development

### Project Structure

```
cindra/
├── background/          # Background scripts
├── content_scripts/     # Content scripts for each AI service
├── ui/                  # User interface files
│   ├── popup/          # Extension popup
│   └── options/        # Options page
├── images/             # Extension icons
└── manifest.json       # Extension manifest
```

### Adding New AI Services

To add support for a new AI service:

1. Create a new content script in `content_scripts/`
2. Update `manifest.json` with the new content script
3. Add the service to the UI dropdowns in `ui/popup/popup.html` and `ui/options/options.html`
4. Update the background script to handle the new service

See the existing content scripts for examples of how to implement new AI service integrations.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Thanks to all the AI services that make this extension possible
