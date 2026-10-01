# Changelog

All notable changes to Cindra are documented here.

## Unreleased

### Added

- Added Meta AI Playground as a web-UI destination, defaulting each handoff to Muse Spark 1.2 Contributor.

### Changed

- YouTube transcripts now come from caption tracks, YouTube's transcript endpoint, or the transcript panel's data instead of scraping the visible panel. Results are tied to the requested video, partial transcripts are rejected, and transcripts cached by older versions are discarded.
- ChatGPT handoffs support the composer that has no element ID.
- Rewrote the README with new screenshots, a banner and a selection-composer example.
- Redesigned the popup, settings, error page, selection composer, and floating launcher in a graphite-and-ember theme. The popup now fits Chrome's 600px popup height without scrolling.

### Fixed

- Snapshot the popup destination, source, and draft at click time so delayed preference writes cannot route content to a previous provider.
- Ignore stale preset reads after a newer selection and preserve edited drafts across storage and theme refreshes.
- Keep asynchronous preset saves tied to their original preset and editor, preventing interrupted editing from overwriting another preset.
- Guard repeated prompt saves and Resend clicks while their requests are pending.
- Reject a resend for a missing history ID instead of substituting an unrelated recent prompt.
- Keep accepted provider deliveries in a working state until submission completes.
- Reserve same-tab handoffs before asynchronous claims to prevent duplicate submissions, and preserve newer recovery keys when older handoffs complete.
- Add 25 deterministic regression tests for delayed storage, interrupted editing, routing, retries, and provider concurrency.

### Removed

- Removed the DeepSeek destination and its adapter.

## 1.4.0 - 2026-07-24

### Added

- A staged background content-extraction orchestrator for page, selection, PDF, YouTube, and Reddit sources.
- Shared message contracts, Chrome API Promise wrappers, contextual error helpers, and bounded page extraction.
- A seven-day, 20-entry YouTube transcript cache with legacy cache adoption and LRU maintenance.
- Lifecycle-managed, accessible Shadow DOM controls for the generic page launcher, selection composer, and YouTube transcript copy action.
- Copy, resend, and clear recovery controls for recent generated prompts.
- Automated unit and unpacked-extension browser coverage for routing, PDFs, providers, page UI, popup/settings accessibility, and YouTube SPA navigation.
- `ARCHITECTURE.md` with runtime boundaries, data flow, storage, privacy, and validation details.

### Changed

- Centralized all 13 provider adapters behind a shared provider runtime and registry-driven metadata.
- Reworked popup and settings logic around shared async Chrome wrappers and deterministic lifecycle cleanup.
- Made the prompt editor a keyboard-contained modal with Escape dismissal, focus restoration, and inline validation.
- Consolidated page extraction and limited very long pages while preserving their beginning and end.
- Serialized offscreen PDF extraction and strengthened PDF download, size, signature, and cleanup checks.
- Replaced YouTube’s multiple unbounded observers and loose retry timers with one debounced lifecycle controller.
- Made Reddit extraction fall back to readable page text when structured content is unavailable.
- Updated automatic theme handling to react to system color-scheme changes.
- Unified the default summary prompt in `lib/prompt.js` so background, page, popup, and settings flows cannot drift.
- Made provider DOM waits and delayed actions abortable, with a bounded deadline for every provider handoff and a longer allowance for Kimi attachment handling.
- Consolidated provider-specific input behavior further into the shared adapter runtime while preserving destination-specific editor modes and fallbacks.

### Fixed

- Prevented duplicate page UI, listeners, timers, animation frames, and YouTube controls after content-script reinjection or SPA navigation.
- Prevented two provider tabs from submitting the same queued handoff.
- Preserved failed provider handoffs for recovery and retained contextual failure stages.
- Prevented manual YouTube transcript instructions and extraction errors from being cached or sent to an AI destination.
- Preserved valid legacy transcript cache entries during startup maintenance.
- Corrected Chrome scripting calls to use the supported `func` property.
- Sanitized popup status state classes and improved malformed message rejection.
- Redacted prompt bodies and captured content from serialized diagnostics while retaining names, codes, causes, and stack traces.
- Prevented provider waits from running indefinitely; timed-out or cancelled handoffs remain queued for recovery instead of being cleared.
- Replaced inline `data:` error documents with a packaged, themed extension page that renders messages through `textContent`.

## 1.3.0

- Added the current multi-provider popup, prompt management, page/selection/PDF/YouTube/Reddit routing, and recovery-oriented handoff UI.
