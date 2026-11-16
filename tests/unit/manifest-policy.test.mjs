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
      const urls = readFileSync(join(ROOT, file), 'utf8').match(/https?:\/\/[^\s'"`)<>]+/g) ?? [];
      for (const url of urls) assert.ok(url.startsWith('https://api.ipify.org'), `${file}: unexpected URL ${url}`);
    }
  });
  it('packages every runtime file and nothing else', () => {
    const packed = new Set(packagedFiles());
    const runtime = sources.filter((f) => !f.endsWith('.config.mjs'));
    for (const f of runtime) assert.ok(packed.has(f), `${f} is not in pack.sh`);
    for (const f of packed) assert.ok(!/^(tests|store|node_modules)\//.test(f) && !f.endsWith('.md'), `${f} must not be packaged`);
  });
});
