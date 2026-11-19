# Proof-Shot Privacy Policy

_Last updated: 2026-11-18_

Proof-Shot is a Chrome extension that takes screenshots for audit evidence. It is designed to keep your data on your device.

## What the extension handles

When **you** trigger a capture (toolbar button or keyboard shortcut), Proof-Shot processes, **only on your device**:

| Data | Purpose | Where it goes |
|---|---|---|
| Screenshot of the visible area of the active tab | The evidence image | Saved to your Downloads folder |
| URL and title of the captured page | Evidence metadata | Watermark (URL without query string or fragment) and the JSON file in your Downloads folder |
| Your public IP address | Evidence metadata | Watermark and JSON file |
| Browser and operating system version | Evidence metadata | Watermark and JSON file |
| Session name, case/ticket ID and auditor name you type | Organising evidence | `chrome.storage.local` on your device, watermark and JSON file |
| Capture history (ID, time, URL, IP, hashes, file path) | Local log and CSV export | `chrome.storage.local` on your device (last 2000 entries) |

No screenshots run in the background. The extension only captures the tab you act on, at the moment you act.

## Third-party service

To obtain your public IP address, the extension sends one HTTPS request per capture to **[ipify](https://www.ipify.org/)** (`https://api.ipify.org`). As with any web request, ipify receives your IP address. No other data (no URL, screenshot or identifier) is sent. See ipify's own privacy terms on their website.

## What the extension does NOT do

- It does not send screenshots, URLs, history or any personal data to the developer or any server other than the IP lookup above.
- It does not use analytics, tracking, advertising or remote code.
- It does not sell or transfer user data to third parties.
- It does not use or transfer data for purposes unrelated to its single purpose, or to determine creditworthiness or for lending purposes.

## Evidence verifier

The optional verifier script (`proofshot_verify.py`) runs on your computer, reads only the files you pass to it and makes no network requests.

## Your control

- Evidence files are ordinary files in your Downloads folder; you can move or delete them at any time.
- The local history can be cleared from **Settings → Clear history**.
- Uninstalling the extension removes all data stored in `chrome.storage.local`.

## Contact

Questions or requests: open an issue at <https://github.com/saqpsaqp/chrome-screenshot-for-audit/issues>.
