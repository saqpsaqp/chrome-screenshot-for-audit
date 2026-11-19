# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository.

You can expect an acknowledgement within 5 business days. Fixes are released as a new extension version on the Chrome Web Store and a GitHub release.

## Supported versions

Only the latest version published on the Chrome Web Store is supported.

## Security model

What Proof-Shot guarantees:

- **Integrity of the file**: `sha256_final` in the JSON sidecar lets anyone detect modification of the PNG after capture (`sha256sum file.png`). `sha256_pixels` (schema 1.1) covers the captured area independently of PNG encoding. `verifier/proof-shot-verify.py` checks both plus dimensions, PNG structure, timestamps and naming consistency.
- **No secret leakage on the image**: the watermark shows the URL without query string, fragment or credentials.
- **Minimal attack surface**: `activeTab` only (no `<all_urls>`), no content scripts, no `externally_connectable`, no remote code; messages are accepted only from the extension's own pages; the third-party IP response is validated before use.

What it does **not** guarantee (by design, for v1):

- **Authenticity / non-repudiation**: hashes are not signed. Someone who controls the machine can produce a new PNG + JSON pair with consistent hashes. Store the evidence in a write-once location (e.g. S3 Object Lock, WORM storage) or register the hashes in your ticketing system at capture time.
- **Trusted time**: timestamps come from the local system clock. A future version may add RFC 3161 trusted timestamps.
- **JSON-only edits that stay consistent**: the image hashes do not cover the JSON. Changing, say, the auditor or page title in the JSON is only visible by comparing it with the watermark text (the verifier prints the expected text for that comparison).

The verifier treats both files as untrusted input: size and dimension limits, bounded decompression (no decompression bombs), CRC validation, no network access, standard library only.

## Supply chain

- The published extension has **zero runtime dependencies**; `node_modules` is dev tooling only and is never packaged (enforced by `tests/unit/manifest-policy.test.mjs`).
- CI runs ESLint (security + no-unsanitized), unit/policy/E2E tests, CodeQL, Semgrep, gitleaks, zizmor, dependency review, npm audit and OpenSSF Scorecard. All actions are pinned by commit SHA and updated by Dependabot.
- Release packages are built in GitHub Actions with build provenance attestations:
  ```bash
  gh attestation verify proof-shot-v1.0.0.zip --repo saqpsaqp/chrome-screenshot-for-audit
  ```
