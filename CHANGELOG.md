# Changelog

All notable changes to Cindra are documented here.

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

### Fixed

- Prevented duplicate page UI, listeners, timers, animation frames, and YouTube controls after content-script reinjection or SPA navigation.
- Prevented two provider tabs from submitting the same queued handoff.
- Preserved failed provider handoffs for recovery and retained contextual failure stages.
- Prevented manual YouTube transcript instructions and extraction errors from being cached or sent to an AI destination.
- Preserved valid legacy transcript cache entries during startup maintenance.
- Corrected Chrome scripting calls to use the supported `func` property.
- Sanitized popup status state classes and improved malformed message rejection.

## 1.3.0

- Added the current multi-provider popup, prompt management, page/selection/PDF/YouTube/Reddit routing, and recovery-oriented handoff UI.
