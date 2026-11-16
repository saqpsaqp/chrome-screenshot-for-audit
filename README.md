# Evidence Capture

Chrome extension (Manifest V3) that takes **audit-grade screenshots**: each capture gets a visible watermark band and a JSON evidence sidecar with SHA-256 hashes, so evidence can be verified later.

## Features

- **Visible-area capture** from the popup or a keyboard shortcut (default `Alt+Shift+S`, configurable at `chrome://extensions/shortcuts`).
- **Watermark band** below the screenshot (it never covers page content) with:
  evidence ID, session, case/ticket ID, auditor, local time + timezone, UTC time, URL (**origin + path only**, query string and fragment are dropped to avoid leaking tokens), public IP, browser/OS and the SHA-256 of the original capture.
- **JSON sidecar** with full metadata (full URL, page title, user agent) and both hashes.
- **Sessions**: a session name is required before capturing. Files are organised as:
  ```
  Downloads/<root folder>/<session>/<YYYY-MM-DD>/<HHMMSS>_<case>_<id8>.png
                                                 <HHMMSS>_<case>_<id8>.json
  ```
- **Local history log** (last 2000 captures) with CSV export (formula-injection safe) from the Settings page.

## Verifying evidence

```bash
sha256sum 164012_SEC-1234_7c1e2a9b.png
jq -r .integrity.sha256_final 164012_SEC-1234_7c1e2a9b.json
```

Both values must match. `sha256_original` is the hash of the raw screenshot before the watermark was applied; it is printed on the watermark itself.

## Installation (development)

1. Open `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension, open the popup and start a session.

## Packaging

```bash
./pack.sh   # -> evidence-capture-v<version>.zip
```

## Privacy

- The only network request is to `https://api.ipify.org` to get the public IP at capture time.
- Everything else stays local: settings, session and history live in `chrome.storage.local`; evidence files go to your Downloads folder.
- Permissions: `activeTab` (capture only the tab you act on), `downloads`, `storage`.

## Roadmap

- [x] Phase 1: visible capture, watermark, JSON sidecar, sessions, shortcut, history
- [ ] Phase 2: region selection
- [ ] Phase 3: icons, store listing, privacy policy
