// End-to-end test: loads the extension in headless Chrome over CDP (pipe transport) and
// performs real captures against a local page.
//
// The extension is copied to a temp dir and patched for testing only:
//   - host_permissions += <all_urls>: there is no user gesture in headless to grant activeTab.
//   - IP endpoint -> local server, so the test is deterministic and offline.
//
// Usage: node tests/e2e/e2e.mjs   (CHROME_BIN overrides the browser binary)

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME_BIN = process.env.CHROME_BIN || 'google-chrome';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const VERIFIER = join(ROOT, 'verifier/proof-shot-verify.py');
const PORT = 8765;
const TEST_IP = '203.0.113.42'; // RFC 5737 documentation range
const SECRET = 'SUPERSECRET-TOKEN';

const work = mkdtempSync(join(tmpdir(), 'proof-shot-e2e-'));
const extDir = join(work, 'ext');
const profileDir = join(work, 'profile');
const downloadsDir = join(work, 'downloads');

// --- Prepare patched extension copy and Chrome profile -------------------------------------
for (const entry of ['manifest.json', 'background.js', 'popup.html', 'popup.js', 'options.html', 'options.js', 'styles.css', 'lib', 'icons']) {
  cpSync(join(ROOT, entry), join(extDir, entry), { recursive: true });
}
const manifestPath = join(extDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.host_permissions.push('<all_urls>');
writeFileSync(manifestPath, JSON.stringify(manifest));

const metadataPath = join(extDir, 'lib/metadata.js');
const metadataSrc = readFileSync(metadataPath, 'utf8');
assert.ok(metadataSrc.includes('https://api.ipify.org?format=json'), 'IP endpoint not found for patching');
writeFileSync(metadataPath, metadataSrc.replace('https://api.ipify.org?format=json', `http://localhost:${PORT}/ip`));

mkdirSync(join(profileDir, 'Default'), { recursive: true });
mkdirSync(downloadsDir);
writeFileSync(join(profileDir, 'Default/Preferences'), JSON.stringify({
  download: { default_directory: downloadsDir, prompt_for_download: false },
}));

// --- Local test server ---------------------------------------------------------------------
let ipResponse = JSON.stringify({ ip: TEST_IP });
const server = http.createServer((req, res) => {
  if (req.url === '/ip') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(ipResponse);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>E2E page</title><h1 style="font:40px sans-serif;padding:40px">Proof-Shot E2E</h1>');
}).listen(PORT);

// --- Minimal CDP client over --remote-debugging-pipe --------------------------------------
const chromeArgs = [
  '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=1280,800', 'about:blank',
];
if (process.env.CI) chromeArgs.unshift('--no-sandbox'); // CI runners restrict user namespaces

const chrome = spawn(CHROME_BIN, chromeArgs, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let nextId = 1;
let buffer = '';
const pending = new Map();
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, idx));
    buffer = buffer.slice(idx + 1);
    const p = pending.get(msg.id);
    if (!p) continue;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
    else p.resolve(msg.result);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolvePromise, reject) => {
  const id = nextId++;
  pending.set(id, { resolve: resolvePromise, reject });
  chrome.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) })}\0`);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Test helpers --------------------------------------------------------------------------
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✖ ${name}\n    ${String(err.stack ?? err).split('\n').slice(0, 12).join('\n    ')}`);
  }
}

/** Waits until `pairs` complete PNG + JSON evidence pairs exist (same basename, no partial downloads). */
async function waitForEvidencePairs(pairs, timeoutMs = 15_000) {
  const start = Date.now();
  let files = [];
  while (Date.now() - start < timeoutMs) {
    const all = readdirSync(downloadsDir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => join(d.parentPath ?? d.path, d.name));
    files = all.filter((f) => !f.endsWith('.crdownload'));
    const complete = files
      .filter((f) => f.endsWith('.png'))
      .filter((png) => files.includes(png.replace(/\.png$/, '.json')));
    if (complete.length >= pairs && all.length === files.length) {
      return complete.sort().map((png) => ({ png, json: png.replace(/\.png$/, '.json') }));
    }
    await sleep(200);
  }
  throw new Error(`Expected ${pairs} evidence pair(s), found files: ${JSON.stringify(files)}`);
}

// --- Run -----------------------------------------------------------------------------------
let exitCode = 1;
try {
  const { id: extId } = await send('Extensions.loadUnpacked', { path: extDir });
  await send('Target.createTarget', { url: `http://localhost:${PORT}/iam/policies?session_token=${SECRET}#frag` });
  await sleep(1000);
  const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options.html`, newWindow: true });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await sleep(800);

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate failed');
    return res.result.value;
  };
  const captureTestPage = () => evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://localhost:${PORT}/*' });
    return chrome.runtime.sendMessage({ type: 'capture', tabId: tab.id });
  })()`);

  console.log('Proof-Shot E2E');

  await step('rejects capture without an active session', async () => {
    const res = await captureTestPage();
    assert.equal(res.ok, false);
    assert.equal(res.code, 'SESSION_REQUIRED');
    assert.equal(readdirSync(downloadsDir).length, 0);
  });

  await evaluate(`chrome.storage.local.set({
    session: { name: 'E2E: PCI/Q4', caseId: 'SEC-1234', startedAt: new Date().toISOString() },
    settings: { auditor: 'CI Bot', rootFolder: 'Proof-Shot' },
  })`);

  let evidence;
  let pngPath;
  let jsonPath;
  await step('captures PNG + JSON into <root>/<session>/<date>/', async () => {
    const res = await captureTestPage();
    assert.equal(res.ok, true, res.error);
    evidence = res.evidence;
    const [pair] = await waitForEvidencePairs(1);
    ({ png: pngPath, json: jsonPath } = pair);
    const rel = pngPath.slice(downloadsDir.length + 1);
    assert.match(rel, /^Proof-Shot\/E2E_ PCI_Q4\/\d{4}-\d{2}-\d{2}\/\d{6}_SEC-1234_[0-9a-f]{8}\.png$/);
    assert.ok(rel.includes(evidence.evidence_id.slice(0, 8)), 'file name must carry the evidence id');
  });

  await step('PNG on disk matches sha256_final in the JSON sidecar', () => {
    const sidecar = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const actual = createHash('sha256').update(readFileSync(pngPath)).digest('hex');
    assert.equal(sidecar.integrity.sha256_final, actual);
    assert.notEqual(sidecar.integrity.sha256_original, actual);
    assert.equal(sidecar.evidence_id, evidence.evidence_id);
  });

  await step('watermark band is appended below the capture', async () => {
    const png = readFileSync(pngPath);
    const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    const tab = await evaluate(`chrome.tabs.query({ url: 'http://localhost:${PORT}/*' }).then(([t]) => ({ w: t.width, h: t.height }))`);
    assert.equal(width, tab.w);
    assert.ok(height > tab.h + 50, `expected a band below ${tab.w}x${tab.h}, got ${width}x${height}`);
  });

  await step('capture size and pixel hash are recorded (schema 1.1)', async () => {
    const tab = await evaluate(`chrome.tabs.query({ url: 'http://localhost:${PORT}/*' }).then(([t]) => ({ w: t.width, h: t.height }))`);
    assert.equal(evidence.schema_version, '1.1');
    assert.deepEqual([evidence.capture.width, evidence.capture.height], [tab.w, tab.h]);
    assert.match(evidence.integrity.sha256_pixels, /^[0-9a-f]{64}$/);
  });

  // Runs the real verifier against real captures: catches drift between lib/watermark.js
  // (band layout, canvas encoding) and verifier/proof-shot-verify.py.
  const runVerifier = (...args) => spawnSync(PYTHON_BIN, ['-I', VERIFIER, '--json', ...args], { encoding: 'utf8' });

  await step('verifier passes on the untouched evidence', () => {
    const res = runVerifier(pngPath);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const report = JSON.parse(res.stdout);
    assert.equal(report.status, 'PASS', res.stdout);
    assert.ok(report.checks.every((c) => c.status === 'PASS'), res.stdout);
    assert.equal(report.evidence_id, evidence.evidence_id);
  });

  await step('verifier fails on a tampered capture', () => {
    const forged = join(work, 'forged.png');
    copyFileSync(pngPath, forged);
    const bytes = readFileSync(forged);
    bytes[bytes.length - 20] ^= 0xff; // inside the last chunk
    writeFileSync(forged, bytes);
    const res = runVerifier(forged, jsonPath);
    assert.equal(res.status, 1, res.stdout);
    assert.equal(JSON.parse(res.stdout).status, 'FAIL');
  });

  await step('URL secrets only in JSON, redacted URL for the watermark', () => {
    assert.ok(evidence.page.url.includes(SECRET));
    assert.equal(evidence.page.url_redacted, `http://localhost:${PORT}/iam/policies`);
  });

  await step('metadata is complete', () => {
    assert.equal(evidence.network.public_ip, TEST_IP);
    assert.equal(evidence.session, 'E2E: PCI/Q4');
    assert.equal(evidence.case_id, 'SEC-1234');
    assert.equal(evidence.auditor, 'CI Bot');
    assert.match(evidence.captured_at_utc, /Z$/);
    assert.match(evidence.environment.extension, /^Proof-Shot \d+\.\d+\.\d+$/);
  });

  await step('history log records the capture', async () => {
    const history = await evaluate(`chrome.storage.local.get('history').then((r) => r.history)`);
    assert.equal(history.length, 1);
    assert.equal(history[0].sha256_final, evidence.integrity.sha256_final);
  });

  await step('malicious IP service response is rejected', async () => {
    ipResponse = JSON.stringify({ ip: '1.2.3.4\nURL: https://forged.example' });
    const res = await captureTestPage();
    assert.equal(res.ok, true, res.error);
    assert.equal(res.evidence.network.public_ip, 'unavailable');
    assert.match(res.evidence.network.ip_error, /Invalid IP/);
    await waitForEvidencePairs(2);
  });

  await step('restricted chrome:// pages fail with a friendly error', async () => {
    const res = await evaluate(`(async () => {
      const tab = await chrome.tabs.create({ url: 'chrome://version', active: true });
      await new Promise((r) => setTimeout(r, 800));
      return chrome.runtime.sendMessage({ type: 'capture', tabId: tab.id });
    })()`);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'RESTRICTED_PAGE');
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  exitCode = failed ? 1 : 0;
} catch (err) {
  console.error('E2E setup failed:', err);
} finally {
  chrome.kill();
  server.close();
  if (!process.env.KEEP_E2E_ARTIFACTS) rmSync(work, { recursive: true, force: true });
  else console.log(`Artifacts kept in ${work}`);
  process.exit(exitCode);
}
