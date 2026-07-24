# Cindra Architecture

Cindra is a Manifest V3 Chrome extension. It has no production build step: Chrome loads the checked-in JavaScript, HTML, CSS, and vendored PDF.js files directly.

## Runtime contexts

Cindra runs in four isolated contexts:

1. **Background service worker**
   - Entry point: `background/background.js`
   - Validates messages, resolves the source tab, runs extraction, records status, and opens the selected AI destination.
2. **Generic page content script**
   - Entry point: `content_scripts/content.js`
   - Implements `Ctrl + X + X` and coordinates the floating button and selection composer in `content_scripts/lib/page_ui.js`.
3. **Site-specific content scripts**
   - Provider adapters use `content_scripts/lib/provider_runtime.js` and `content_scripts/lib/inject.js`.
   - YouTube and Reddit expose extraction-only message handlers.
4. **Offscreen PDF document**
   - Entry point: `offscreen/pdf_extractor.js`
   - Downloads and parses PDFs in an isolated extension document with vendored PDF.js.

The popup and settings page are extension pages. They use the same error and Chrome API helpers as runtime contexts. User-facing extraction failures open the packaged `ui/error/error.html` page; query text is normalized and assigned with `textContent`, avoiding inline `data:` documents and HTML injection.

## Shared modules

- `lib/providers.js`: provider and content-source registry. Labels, URLs, match patterns, storage keys, startup delays, and content limits belong here.
- `lib/messages.js`: action constants, payload validation, one-shot responses, message timeouts, and Promise wrappers for runtime/tab messaging.
- `lib/chrome.js`: Promise wrappers for callback-based Chrome APIs with `chrome.runtime.lastError` preservation.
- `lib/errors.js`: contextual errors, safe user messages, and redacted diagnostic serialization that retains names, codes, causes, and stack traces without exposing prompt or captured-content bodies.
- `lib/extraction.js`: normalized selection/page/PDF extraction and bounded long-page truncation.
- `lib/prompt.js`: the shared default summary prompt, prompt formatting, and destination-specific content limits.

Shared modules expose globals because MV3 content scripts and service workers are loaded as classic scripts. The same files expose CommonJS exports for Node tests.

## Summary pipeline

`ContentExtractionOrchestrator` in `background/orchestrator.js` owns the workflow:

1. Load stored defaults and merge only defined request overrides.
2. Normalize the provider, content source, prompt, and captured text.
3. Resolve one deterministic route: captured selection, live selection, captured page, page, PDF, YouTube, or Reddit.
4. Extract through the relevant adapter.
5. Normalize and format source metadata.
6. Hand the prepared content to `background/handoffs.js`.
7. Persist status and recent-prompt recovery metadata when enabled.

The sender receives an accepted response after the source tab is resolved. Extraction and destination handoff continue in the service worker, with progress written to `chrome.storage.local` for the popup.

## Provider handoffs

Every AI destination is registered in `lib/providers.js` and has a small adapter in `content_scripts/<provider>_content.js`.

The background worker builds the final prompt, stores a namespaced pending envelope, opens or reuses the destination tab, and delivers the envelope when eager delivery is supported.

The provider runtime validates `insertPrompt`, claims the pending handoff so two tabs cannot submit it, finds the composer, inserts and submits the prompt, reports contextual success/failure, and clears only the matching successful handoff. Shared DOM waits and sleeps accept an `AbortSignal`; each handoff has a bounded deadline, with provider-specific overrides for slower attachment flows. A timeout aborts pending DOM work and leaves the envelope queued for recovery. Legacy pending-prompt keys remain readable so upgrades do not discard queued work.

## Page UI lifecycle

`content_scripts/lib/page_ui.js` owns generic page UI:

- `FloatingSummaryButton` renders native buttons inside Shadow DOM.
- `SelectionComposer` manages selection detection, positioning, focus trapping, Escape dismissal, focus restoration, status announcements, and selection highlighting.
- Reinjection destroys the previous runtime first, preventing duplicate listeners, timers, animation frames, and hosts.
- Generic UI is suppressed on provider destinations, YouTube, and Reddit.

`content_scripts/lib/youtube_ui.js` applies the same lifecycle rules to YouTube’s transcript-copy control. It uses one observer, debounced named timers, YouTube SPA navigation events, and deterministic cleanup.

## Extraction and caches

### Page text

The extractor chooses the largest readable root in a linear pass, removes navigation/forms/Cindra UI, normalizes whitespace, and caps captured page text at 500,000 characters. Truncation preserves the beginning and end and inserts an explicit omission notice.

### YouTube

Transcript extraction tries the visible transcript panel and caption data sources. Concurrent requests share one in-flight Promise. Genuine transcripts begin with `Transcript:`; manual instructions and error text are rejected before caching or handoff.

The transcript cache:

- uses `transcript_<videoId>` data keys for backward compatibility,
- records versioned metadata separately,
- expires entries after seven days,
- keeps at most 20 entries using last-accessed ordering,
- adopts legacy entries during maintenance instead of deleting them.

### PDFs

PDF extraction is serialized so concurrent requests cannot race one offscreen document. Downloads accept only HTTP(S), enforce a 50 MiB limit, validate the PDF signature, disable PDF.js JavaScript evaluation, and clean up the offscreen context after each request. The tab-based extractor remains as a fallback.

## Storage and privacy

- `chrome.storage.sync`: workflow defaults, prompt presets, theme, and page-tool preferences.
- `chrome.storage.local`: handoff status, optional recent generated prompts, pending provider envelopes, and transcript cache.

Cindra does not use an API key or send content to a Cindra server. Extracted content is delivered only to the AI destination the user selects. Prompt history can be disabled or cleared. Transcript cache entries stay local and expire automatically.

## Validation

Run:

```bash
pnpm check
pnpm test:unit
pnpm test:extension
```

`pnpm check` validates JavaScript syntax, manifest and HTML references, version synchronization, provider registry invariants, and removal of retired diagnostics. Node tests cover pure contracts and orchestration. Playwright loads the unpacked extension against deterministic fixtures for content extraction, PDFs, provider handoffs, page UI, popup/settings accessibility, and YouTube SPA behavior.
