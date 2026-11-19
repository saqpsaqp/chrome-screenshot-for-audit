# Chrome Web Store listing: Proof-Shot

- Item ID: `npifnacjpepfcndgfjhchmmbifdabmjn`
- Store URL: https://chromewebstore.google.com/detail/proof-shot/npifnacjpepfcndgfjhchmmbifdabmjn

Copy/paste reference for the Developer Dashboard (<https://chrome.google.com/webstore/devconsole>).

## Package

```bash
./pack.sh   # -> proof-shot-v<version>.zip (or download it from the GitHub release)
```

## Store listing tab

**Name:** Proof-Shot

**Summary** (max 132 chars, taken from `description` in `manifest.json`; keep both identical):
> Audit-grade screenshots with a watermark (timestamp, public IP, URL, SHA-256) and a JSON evidence file for verification.

**Category:** Tools
**Language:** English

**Description:**

```
Proof-Shot turns any screenshot into verifiable audit evidence.

Built for security auditors, compliance teams (SOC 2, ISO 27001, PCI DSS), QA and anyone who needs to prove what a web page showed, when, and from where.

EVERY CAPTURE INCLUDES
• A watermark band below the screenshot (it never covers page content) with:
  – Evidence ID, session, case/ticket ID and auditor
  – Local time with timezone and UTC time
  – Page URL (domain and path only: query strings and fragments are hidden so tokens never leak)
  – Public IP address, browser and operating system
  – SHA-256 hash of the original screenshot
• A JSON evidence file with full metadata and SHA-256 hashes (original capture, captured pixels and final watermarked image), so anyone can verify the file was not altered:
  sha256sum capture.png  → must match "sha256_final"
• A free, open-source offline verifier (Python, no dependencies) checks a capture or a whole session folder in one command

ORGANISED BY SESSION
Start a session (e.g. "SOC2 2026 Q4") and every capture is saved automatically to:
Downloads/Proof-Shot/<session>/<date>/

FAST
• One click from the toolbar, or the keyboard shortcut Alt+Shift+S (configurable)
• Local capture history with CSV export for your evidence register

PRIVATE BY DESIGN
• Everything stays on your device. No accounts, no analytics, no tracking.
• The only network request is to api.ipify.org to read your public IP at capture time.
• Minimal permissions: only the tab you click on is captured (activeTab).

Open source (MIT): https://github.com/saqpsaqp/chrome-screenshot-for-audit
Made by Saul Quintero: https://saulquintero.com.co/utilities/
```

**Graphic assets** (in `store/`, regenerate with `store/build.sh`):

| Asset | File |
|---|---|
| Store icon 128×128 | `icons/icon128.png` |
| Screenshot 1 (1280×800) | `store/screenshot-1.png` |
| Screenshot 2 (1280×800) | `store/screenshot-2.png` |
| Small promo tile 440×280 | `store/promo-small-440x280.png` |

**Homepage URL:** https://saulquintero.com.co/utilities/ (same as `homepage_url` in the manifest)
**Support URL:** https://github.com/saqpsaqp/chrome-screenshot-for-audit/issues

## Privacy practices tab

**Single purpose:**
> Capture the visible area of the current tab as audit evidence, adding a watermark with timestamp, public IP, URL and SHA-256 hash, and saving the image with a JSON metadata file.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `activeTab` | Capture a screenshot of the tab only when the user clicks the toolbar button or presses the shortcut, and read that tab's URL and title for the evidence metadata. |
| `downloads` | Save the watermarked screenshot and its JSON evidence file into an organised folder (Downloads/Proof-Shot/session/date) without prompting on every capture, and export the history as CSV. |
| `storage` | Store the user's settings (auditor name, root folder), the active session and the local capture history on the device. |
| Host permission `https://api.ipify.org/*` | Read the user's public IP address at capture time to include it in the evidence watermark and metadata. No other data is sent. |

**Remote code:** No, I am not using remote code.

**Data usage:** tick these categories (all handled locally, disclosed conservatively):
- Personally identifiable information (auditor name entered by the user)
- Location (public IP address)
- Web history (URL of the captured page)
- Website content (the screenshot)

Certify all three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/saqpsaqp/chrome-screenshot-for-audit/blob/main/PRIVACY.md

## Distribution tab

- Visibility: Public (or Unlisted for a first internal rollout)
- Regions: All
