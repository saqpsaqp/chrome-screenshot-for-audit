import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.TZ = 'America/Bogota';

const { sanitizeSegment } = await import('../../lib/capture.js');
const { csvCell, historyToCsv, CSV_COLUMNS } = await import('../../lib/csv.js');
const { bytesToDataUrl, dataUrlToBytes, sha256Hex, textToDataUrl } = await import('../../lib/encoding.js');
const { describeOs, isValidIp, pickBrand, redactUrl, timeInfo } = await import('../../lib/metadata.js');

describe('sanitizeSegment (download paths)', () => {
  it('replaces Windows-reserved characters', () => {
    assert.equal(sanitizeSegment('PCI:Q4/<review>|"x"?*', 'f'), 'PCI_Q4__review___x___');
  });
  it('blocks path traversal', () => {
    assert.equal(sanitizeSegment('..', 'fallback'), 'fallback');
    assert.equal(sanitizeSegment('../../etc', 'f'), '_.._etc');
    assert.ok(!sanitizeSegment('..\\..\\Windows', 'f').includes('\\'));
  });
  it('strips control characters and collapses whitespace', () => {
    assert.equal(sanitizeSegment('a\u0000b\n\tc   d', 'f'), 'a_b__c d');
  });
  it('falls back on empty values and truncates long ones', () => {
    assert.equal(sanitizeSegment('   ', 'fallback'), 'fallback');
    assert.equal(sanitizeSegment(null, 'fallback'), 'fallback');
    assert.equal(sanitizeSegment('x'.repeat(200), 'f').length, 64);
  });
});

describe('redactUrl (watermark URL)', () => {
  it('drops query string and fragment', () => {
    assert.equal(redactUrl('https://bank.example/acct/1?token=SECRET&x=1#frag'), 'https://bank.example/acct/1');
  });
  it('drops userinfo credentials', () => {
    assert.equal(redactUrl('https://user:pass@host.example/p'), 'https://host.example/p');
  });
  it('handles non-http schemes and garbage', () => {
    assert.equal(redactUrl('file:///C:/a.html?q=1'), 'file:/C:/a.html');
    assert.equal(redactUrl('not a url'), 'unknown');
    assert.equal(redactUrl(undefined), 'unknown');
  });
});

describe('isValidIp (untrusted ipify response)', () => {
  for (const ip of ['190.66.214.121', '0.0.0.0', '255.255.255.255', '2001:db8::1', '::1']) {
    it(`accepts ${ip}`, () => assert.ok(isValidIp(ip)));
  }
  for (const ip of ['256.1.1.1', '1.2.3', '<script>', '1.2.3.4\nURL: evil', '', null, 42, 'a'.repeat(100)]) {
    it(`rejects ${JSON.stringify(ip)}`, () => assert.ok(!isValidIp(ip)));
  }
});

describe('timeInfo', () => {
  it('formats local time with offset and timezone', () => {
    const t = timeInfo(new Date('2026-11-16T21:40:12.345Z'));
    assert.deepEqual(t, {
      utc: '2026-11-16T21:40:12.345Z',
      local: '2026-11-16T16:40:12.345-05:00',
      local_display: '2026-11-16 16:40:12 UTC-05:00',
      timezone: 'America/Bogota',
    });
  });
});

describe('environment helpers', () => {
  it('detects Windows 11 from UA-CH platformVersion', () => {
    assert.equal(describeOs('Windows', '15.0.0'), 'Windows 11');
    assert.equal(describeOs('Windows', '10.0.0'), 'Windows 10 or earlier');
    assert.equal(describeOs('macOS', '15.1.0'), 'macOS 15.1.0');
  });
  it('picks the real brand over Chromium and GREASE', () => {
    const list = [{ brand: 'Not)A;Brand', version: '99' }, { brand: 'Chromium', version: '151' }, { brand: 'Google Chrome', version: '151.0.1' }];
    assert.equal(pickBrand(list).brand, 'Google Chrome');
    assert.equal(pickBrand([{ brand: 'Chromium', version: '1' }]).brand, 'Chromium');
  });
});

describe('encoding', () => {
  it('round-trips binary through data URLs', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
    assert.deepEqual(dataUrlToBytes(bytesToDataUrl(bytes, 'image/png')), bytes);
  });
  it('encodes UTF-8 text', () => {
    const url = textToDataUrl('{"a":"ñ"}', 'application/json');
    assert.equal(new TextDecoder().decode(dataUrlToBytes(url)), '{"a":"ñ"}');
  });
  it('computes SHA-256 (FIPS 180-2 test vector)', async () => {
    assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('CSV export', () => {
  it('neutralizes formula injection', () => {
    for (const payload of ['=HYPERLINK("http://evil")', '+1', '-1+1', '@SUM(A1)', '\t=1']) {
      assert.ok(csvCell(payload).startsWith(`"'`), payload);
    }
  });
  it('escapes quotes and handles nulls', () => {
    assert.equal(csvCell('a "b"'), '"a ""b"""');
    assert.equal(csvCell(null), '""');
  });
  it('builds header plus one row per record', () => {
    const csv = historyToCsv([{ evidence_id: '1', url: 'https://x' }]);
    const lines = csv.split('\r\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0], CSV_COLUMNS.join(','));
  });
});
