# Cindra Summary Chrome Extension

A Chrome extension that helps you summarize YouTube videos and webpages using your choice of AI model. This extension extracts content from the current page and sends it to the selected AI platform for summarization.

## Features

- 📝 Summarize YouTube video transcripts (when available) with timestamps
- 🌐 Summarize content from most webpages
- ✂️ Adds a "Copy Transcript" button directly to YouTube video pages
- 🔌 Supports multiple AI Models:
    - Google AI Studio
    - Gemini
    - Perplexity
    - Claude
    - ChatGPT
    - Grok
- ⌨️ Keyboard shortcut (Ctrl+X+X) for quick summarization
- 🎛️ Customizable prompt for tailored summaries
- 🎨 Light/Dark mode support via Settings page
- 🔘 Optional floating button for easy access on any page
- 📄 *PDF Summarization ( Planned / Not Yet Implemented )*

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

1. Navigate to a YouTube video or webpage
2. Click on the extension icon in the toolbar or use the floating button (if enabled)
3. Click "Summarize Current Page" or use the keyboard shortcut (Ctrl+X+X)
4. The extension will extract content and open your chosen AI model's page with the content ready for summarization
5. The summary will be generated based on your custom prompt

### Copying YouTube Transcripts

1. Navigate to a YouTube video page
2. Look for the new "Copy Transcript" button ( <svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> icon ) added near the video title or action buttons.
3. Click the button to copy the available transcript (if found) to your clipboard.

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
1. Extracting content from the current page (transcripts from YouTube videos if available, main text content from webpages)
2. Combining the content with your custom prompt and chosen AI model settings
3. Opening the selected AI model's website in a new tab
4. Automatically inserting the combined prompt into the AI model's input area

## Limitations

- YouTube transcript extraction relies on the availability of captions (auto-generated or official). If no captions are found, extraction will fail.
- Content extraction may not work perfectly on all website structures.

## Privacy

The extension itself does not collect any data. All content is processed locally, then sent directly to the chosen models in your browser.