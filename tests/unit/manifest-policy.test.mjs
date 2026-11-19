// Security policy gate for the published extension: fails CI if the attack surface grows unnoticed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

const ALLOWED_PERMISSIONS = ['activeTab', 'downloads', 'storage'];
const ALLOWED_HOSTS = ['https://api.ipify.org/*'];
const ALLOWED_ORIGINS = new Set(['https://api.ipify.org']);
// User-clicked navigation only (never fetched by the extension).
const ALLOWED_LINKS = new Set(['https://saulquintero.com.co/utilities/']);
const SAFE_ANCHOR = /<a href="([^"]+)" target="_blank" rel="noopener noreferrer">/g;

/** Exact origin match: a prefix check would accept https://api.ipify.org.evil.example */
export function isAllowedUrl(raw) {
  try {
    return ALLOWED_ORIGINS.has(new URL(raw).origin);
  } catch {
    return false;
  }
}

function packagedFiles() {
  const script = readFileSync(join(ROOT, 'pack.sh'), 'utf8');
  const block = script.slice(script.indexOf('zip -qr'), script.indexOf('echo "Created'));
  return block.split(/[\s\\]+/).filter((t) => t && !t.startsWith('-') && !t.startsWith('"') && !['zip', '-qr'].includes(t))
    .flatMap((p) => (existsSync(join(ROOT, p)) && !p.includes('.') ? readdirSync(join(ROOT, p)).map((f) => `${p}/${f}`) : [p]));
}

describe('manifest policy', () => {
  it('is Manifest V3 with semver version', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  });
  it('requests only the allowlisted permissions', () => {
    assert.deepEqual([...manifest.permissions].sort(), ALLOWED_PERMISSIONS);
    assert.deepEqual(manifest.host_permissions, ALLOWED_HOSTS);
    assert.equal(manifest.optional_permissions, undefined);
    assert.equal(manifest.optional_host_permissions, undefined);
  });
  it('exposes no extra attack surface', () => {
    for (const key of ['content_scripts', 'externally_connectable', 'web_accessible_resources', 'content_security_policy', 'update_url', 'key']) {
      assert.equal(manifest[key], undefined, `unexpected manifest key: ${key}`);
    }
  });
  it('references files that exist', () => {
    const refs = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page,
      ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
    for (const ref of refs) assert.ok(existsSync(join(ROOT, ref)), `missing ${ref}`);
  });
  it('keeps the store package and manifest version in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.version, manifest.version);
  });
  it('ships the evidence verifier with the same version (released together)', () => {
    const verifier = readFileSync(join(ROOT, 'verifier/proofshot_verify.py'), 'utf8');
    assert.equal(verifier.match(/^__version__ = "([^"]+)"$/m)?.[1], manifest.version);
  });
});

describe('source policy', () => {
  const sources = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.js', '*.html'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.startsWith('store/') && !f.startsWith('tests/'));

  it('has no remote scripts, eval or dynamic code', () => {
    for (const file of sources) {
      const code = readFileSync(join(ROOT, file), 'utf8');
      assert.doesNotMatch(code, /<script[^>]+src=["']https?:/i, `${file}: remote script`);
      assert.doesNotMatch(code, /\beval\s*\(|new Function\s*\(|import\s*\(\s*['"`]https?:/, `${file}: dynamic code`);
    }
  });
  it('only contacts the allowlisted network endpoint', () => {
    for (const file of sources) {
      let code = readFileSync(join(ROOT, file), 'utf8');
      // Allowlisted links are permitted only as anchors with rel="noopener noreferrer".
      code = code.replace(SAFE_ANCHOR, (match, href) => (ALLOWED_LINKS.has(href) ? '' : match));
      const urls = code.match(/https?:\/\/[^\s'"`)<>]+/g) ?? [];
      for (const url of urls) assert.ok(isAllowedUrl(url), `${file}: unexpected URL ${url}`);
    }
  });
  it('homepage_url is the author website', () => {
    assert.ok(ALLOWED_LINKS.has(manifest.homepage_url));
  });
  it('external links never open without rel="noopener noreferrer"', () => {
    for (const file of sources.filter((f) => f.endsWith('.html'))) {
      for (const tag of readFileSync(join(ROOT, file), 'utf8').match(/<a\s[^>]*target="_blank"[^>]*>/g) ?? []) {
        assert.match(tag, /rel="noopener noreferrer"/, `${file}: ${tag}`);
      }
    }
  });
  it('URL allowlist cannot be bypassed with look-alike hosts', () => {
    assert.ok(isAllowedUrl('https://api.ipify.org?format=json'));
    for (const bad of ['https://api.ipify.org.evil.example/', 'https://api.ipify.org@evil.example/', 'http://api.ipify.org/', 'https://evil.example/?https://api.ipify.org']) {
      assert.ok(!isAllowedUrl(bad), bad);
    }
  });
  it('packages every runtime file and nothing else', () => {
    const packed = new Set(packagedFiles());
    const runtime = sources.filter((f) => !f.endsWith('.config.mjs'));
    for (const f of runtime) assert.ok(packed.has(f), `${f} is not in pack.sh`);
    for (const f of packed) assert.ok(!/^(tests|store|node_modules|verifier)\//.test(f) && !f.endsWith('.md'), `${f} must not be packaged`);
  });
});
