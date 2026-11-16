# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What This Is

Chrome extension (Manifest V3, no build step) that captures the visible tab, adds an audit watermark band and downloads a PNG + JSON evidence sidecar.

## Workflow

- `main` is protected by convention: work on feature branches and open PRs with `gh pr create`.
- Load unpacked from `chrome://extensions/` to test. `./pack.sh` builds the store zip (update the file list when adding top-level files).
- Code, comments and docs in English.

## Architecture

```
popup.js ──sendMessage({type:'capture', tabId})──▶ background.js (service worker, ES module)
commands.onCommand('capture-visible') ───────────▶        │
                                                          ▼
                                               lib/capture.js  captureEvidence()
       captureVisibleTab → sha256(original) ─┬─ lib/metadata.js (ipify, UA-CH, time, redactUrl)
       renderWatermark (OffscreenCanvas) ────┴─ lib/watermark.js
       sha256(final) → chrome.downloads (data: URLs, no object URLs in SW)
```

- No offscreen document: `OffscreenCanvas`, `createImageBitmap` and `crypto.subtle` work in the service worker.
- `lib/storage.js`: `settings` (auditor, rootFolder), `session` (name, caseId, startedAt), `history` (capped at 2000) in `chrome.storage.local`.
- Shortcut with no active session → `chrome.action.openPopup()`; fallback is an `ERR` badge.

## Invariants

- The watermark shows the URL **without query string/fragment** (`redactUrl`); the full URL only goes into the JSON.
- `sha256_final` must be computed over the exact bytes that are downloaded.
- Path segments go through `sanitizeSegment` (Windows-safe).
- Extension name is read from the manifest at runtime; renaming = edit `manifest.json` (+ README).
