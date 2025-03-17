# YouTube Summary Chrome Extension

A Chrome extension that helps you summarize YouTube videos, webpages, and PDFs using Google AI Studio. This extension extracts content from the current page and sends it to Google AI Studio for summarization.

## Features

- 📝 Summarize YouTube video transcripts with timestamps
- 🌐 Summarize any webpage content
- 📄 Support for summarizing PDF content (coming soon)
- ⌨️ Keyboard shortcut (Ctrl+X+X) for quick summarization
- 🎛️ Customizable prompt for tailored summaries
- 🎨 Light/Dark mode support
- 🔌 ChatGPT, Grok, Perplexity, Claude, Google AI Studio integration

## Installation

### From Source
1. Download this repository by clicking the green "Code" button and selecting "Download ZIP"
2. Extract the ZIP file to a location on your computer
3. Open Chrome, Edge, or Brave browser and navigate to the extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`
4. Enable "Developer mode" using the toggle in the top-right corner
5. Click "Load unpacked" and select the extracted extension directory
6. The extension is now installed and ready to use

## Usage

### Basic Usage

1. Navigate to a YouTube video, webpage, or PDF
2. Click on the extension icon in the toolbar
3. Click "Summarize Current Page" or use the keyboard shortcut (Ctrl+X+X)
4. The extension will extract content and open chosen model with the content ready for summarization
5. The summary will be generated based on your custom prompt

### Customizing Prompts

1. Click on the extension icon
2. Edit the "Prompt for Summary" textbox
3. Your custom prompt will be saved and used for future summarizations

### Settings

Access the settings page by clicking the "Settings" button in the extension popup. Here you can customize:

- Theme (Auto/Light/Dark)
- Copy format (Plain Text/Markdown)
- Visibility of floating summary button

## Technical Details

This extension works by:
1. Extracting content from the current page (text from webpages, transcripts from YouTube videos)
2. Combining the content with your custom prompt
3. Opening chosen model page and automatically filling in the prompt
4. Submitting the prompt to generate the summary

## Limitations

- Only auto-generated and official YouTube transcripts are available 
- Content extraction may not work perfectly on all websites
- Very long content may be truncated due to AI model token limits

## Privacy

The extension itself does not collect any data. All content is processed locally, then sent directly to the chosen models in your browser.

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 