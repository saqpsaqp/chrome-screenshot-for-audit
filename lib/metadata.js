// Collects evidence metadata: time, public IP, browser/OS and URL handling.

const IP_ENDPOINT = 'https://api.ipify.org?format=json';
const IP_TIMEOUT_MS = 3000;

export async function fetchPublicIp() {
  try {
    const res = await fetch(IP_ENDPOINT, { cache: 'no-store', signal: AbortSignal.timeout(IP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { ip } = await res.json();
    return { ip, source: 'api.ipify.org', error: null };
  } catch (err) {
    return { ip: 'unavailable', source: 'api.ipify.org', error: String(err?.message ?? err) };
  }
}

export async function getEnvironment() {
  const env = {
    user_agent: navigator.userAgent,
    browser: 'Chromium',
    os: navigator.userAgentData?.platform || 'unknown',
  };
  try {
    const hints = await navigator.userAgentData.getHighEntropyValues(['platformVersion', 'fullVersionList']);
    const brand = pickBrand(hints.fullVersionList ?? []);
    if (brand) env.browser = `${brand.brand} ${brand.version}`;
    env.os = describeOs(env.os, hints.platformVersion);
  } catch {
    // Client hints unavailable: keep defaults.
  }
  return env;
}

function pickBrand(list) {
  const real = list.filter((b) => !/not.?a.?brand/i.test(b.brand));
  return real.find((b) => b.brand !== 'Chromium') ?? real[0];
}

function describeOs(platform, platformVersion = '') {
  const major = parseInt(platformVersion.split('.')[0], 10);
  // On Windows, platformVersion >= 13 means Windows 11 (UA-CH convention).
  if (platform === 'Windows' && !Number.isNaN(major)) return major >= 13 ? 'Windows 11' : 'Windows 10 or earlier';
  return platformVersion ? `${platform} ${platformVersion}` : platform;
}

const pad = (n, len = 2) => String(n).padStart(len, '0');

function offsetString(date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function localDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** ISO 8601 with local offset, e.g. 2026-11-16T16:40:12.123-05:00 */
export function localIso(date) {
  return `${localDate(date)}T${localTime(date)}.${pad(date.getMilliseconds(), 3)}${offsetString(date)}`;
}

export function timeInfo(date) {
  return {
    utc: date.toISOString(),
    local: localIso(date),
    local_display: `${localDate(date)} ${localTime(date)} UTC${offsetString(date)}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** URL without query string or fragment, to avoid leaking tokens on the watermark. */
export function redactUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.origin !== 'null' ? `${u.origin}${u.pathname}` : `${u.protocol}${u.pathname}`;
  } catch {
    return 'unknown';
  }
}
