# Proof-Shot

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/npifnacjpepfcndgfjhchmmbifdabmjn?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/proof-shot/npifnacjpepfcndgfjhchmmbifdabmjn)
[![Users](https://img.shields.io/chrome-web-store/users/npifnacjpepfcndgfjhchmmbifdabmjn)](https://chromewebstore.google.com/detail/proof-shot/npifnacjpepfcndgfjhchmmbifdabmjn)
[![CI](https://github.com/saqpsaqp/chrome-screenshot-for-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/saqpsaqp/chrome-screenshot-for-audit/actions/workflows/ci.yml)
[![Security](https://github.com/saqpsaqp/chrome-screenshot-for-audit/actions/workflows/security.yml/badge.svg)](https://github.com/saqpsaqp/chrome-screenshot-for-audit/actions/workflows/security.yml)
[![CodeQL](https://github.com/saqpsaqp/chrome-screenshot-for-audit/actions/workflows/codeql.yml/badge.svg)](https://github.com/saqpsaqp/chrome-screenshot-for-audit/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/saqpsaqp/chrome-screenshot-for-audit/badge)](https://scorecard.dev/viewer/?uri=github.com/saqpsaqp/chrome-screenshot-for-audit)

Chrome extension (Manifest V3) that takes **audit-grade screenshots**: each capture gets a visible watermark band and a JSON evidence sidecar with SHA-256 hashes, so evidence can be verified later.

![Proof-Shot](store/screenshot-1.png)

## Features

- **Visible-area capture** from the popup or a keyboard shortcut (default `Alt+Shift+S`, configurable at `chrome://extensions/shortcuts`).
- **Watermark band** below the screenshot (it never covers page content) with:
  evidence ID, session, case/ticket ID, auditor, local time + timezone, UTC time, URL (**origin + path only**, query string and fragment are dropped to avoid leaking tokens), public IP, browser/OS and the SHA-256 of the original capture.
- **JSON sidecar** with full metadata (full URL, page title, user agent), capture size and SHA-256 hashes of the original capture, the captured pixels and the final file.
- **Offline verifier** (`verifier/proof-shot-verify.py`, Python stdlib only) to check that a PNG matches its JSON and was not modified.
- **Sessions**: a session name is required before capturing. Files are organised as:
  ```
  Downloads/<root folder>/<session>/<YYYY-MM-DD>/<HHMMSS>_<case>_<id8>.png
                                                 <HHMMSS>_<case>_<id8>.json
  ```
- **Local history log** (last 2000 captures) with CSV export (formula-injection safe) from the Settings page.

## Verifying evidence

Download `proof-shot-verify.py` from the [latest release](https://github.com/saqpsaqp/chrome-screenshot-for-audit/releases/latest) (or use [`verifier/`](verifier/)). Python 3.10+, no dependencies, no network access.

```bash
curl -LO https://github.com/saqpsaqp/chrome-screenshot-for-audit/releases/latest/download/proof-shot-verify.py
gh attestation verify proof-shot-verify.py --repo saqpsaqp/chrome-screenshot-for-audit   # built by this repo's CI
```

```bash
python3 proof-shot-verify.py 164012_SEC-1234_7c1e2a9b.png          # JSON sidecar found next to it
python3 proof-shot-verify.py evidence.png evidence.json             # renamed files
python3 proof-shot-verify.py --dir Downloads/Proof-Shot/SOC2/       # a whole session
python3 proof-shot-verify.py --json --strict evidence.png           # CI / scripts
```

| Check | Detects |
|---|---|
| `sha256_final` | Any change to the PNG file |
| `sha256_pixels` | Edits to the screenshot area; tells apart a lossless re-encode (WARN, content intact) from a content change (FAIL) |
| `dimensions` | Cropping, resizing or a replaced watermark band |
| `png_structure` | Corrupted chunks, data appended after the image |
| `timestamps` | UTC/local/timezone values that do not describe the same instant |
| `naming` | Evidence id, time or date in the file name that disagree with the JSON |
| `schema` | Unknown schema version, missing fields, malformed hashes |

It also prints the watermark text rebuilt from the JSON, to compare by eye with the band on the image. Exit code: `0` pass (or warnings), `1` fail (or warnings with `--strict`), `2` usage error.

The verifier proves the two files are **unmodified and consistent**, not that they are authentic: someone holding both can forge a new consistent pair (see [SECURITY.md](SECURITY.md)). Without the script:

```bash
sha256sum 164012_SEC-1234_7c1e2a9b.png
jq -r .integrity.sha256_final 164012_SEC-1234_7c1e2a9b.json   # must match
```

`sha256_original` is the hash of the PNG returned by Chrome before the watermark was applied (printed on the watermark). It cannot be recomputed from the final file; `sha256_pixels` is the verifiable equivalent for the captured area.

## Installation

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/proof-shot/npifnacjpepfcndgfjhchmmbifdabmjn).

### Development (unpacked)

1. Open `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension, open the popup and start a session.

## Development

```bash
npm ci                # dev tooling only (ESLint); the extension has no runtime deps
npm run lint          # ESLint with security + no-unsanitized rules
npm test              # unit tests + manifest/source security policy
npm run test:verifier # Python verifier unit tests (python3 -m unittest)
npm run test:e2e      # real captures in headless Chrome, checked with the verifier (CHROME_BIN / PYTHON_BIN)
```

### CI/CD

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR, push to `main` | Lint, unit + policy tests, verifier tests (Python 3.10 and latest), E2E in headless Chrome, builds the store zip as an artifact |
| `security.yml` | PR, push to `main`, weekly | gitleaks, Semgrep (SARIF to code scanning), zizmor, dependency review, npm audit |
| `codeql.yml` | PR, push to `main`, weekly | CodeQL `security-extended` for JavaScript and GitHub Actions |
| `scorecard.yml` | push to `main`, weekly | OpenSSF Scorecard |
| `release.yml` | tag `vX.Y.Z` | Full test suite, zip + `proof-shot-verify.py` + SHA256SUMS, build provenance attestations, GitHub release |

Release: bump `version` in `manifest.json` and `package.json`, merge, then `git tag vX.Y.Z && git push origin vX.Y.Z`. Upload the release zip to the Chrome Web Store.

## Packaging and publishing

```bash
./pack.sh          # -> proof-shot-v<version>.zip (upload to the Chrome Web Store)
store/build.sh     # re-render store screenshots and promo tile from store/src/*.html
```

Listing texts, permission justifications and data disclosures: [store/STORE_LISTING.md](store/STORE_LISTING.md).

## Privacy

Full policy: [PRIVACY.md](PRIVACY.md). Security model and vulnerability reporting: [SECURITY.md](SECURITY.md).

- The only network request is to `https://api.ipify.org` to get the public IP at capture time.
- Everything else stays local: settings, session and history live in `chrome.storage.local`; evidence files go to your Downloads folder.
- Permissions: `activeTab` (capture only the tab you act on), `downloads`, `storage`.

## Roadmap

- [x] v1.0: visible capture, watermark, JSON sidecar, sessions, shortcut, history, store assets
- [x] v1.1: offline evidence verifier (CLI), schema 1.1 with pixel hash and capture size
- [ ] v1.2: verifier web page (drag and drop, offline)
- [ ] v1.3: region selection

## License

[MIT](LICENSE) © 2026 Saul Quintero

---

Made by [Saul Quintero](https://saulquintero.com.co/utilities/)
