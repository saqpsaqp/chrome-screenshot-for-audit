// Capture pipeline: screenshot -> hash -> metadata -> watermark -> hash -> download PNG + JSON.

import { bytesToDataUrl, dataUrlToBytes, sha256Hex, textToDataUrl } from './encoding.js';
import { fetchPublicIp, getEnvironment, localDate, localTime, redactUrl, timeInfo } from './metadata.js';
import { renderWatermark } from './watermark.js';
import { DEFAULT_SETTINGS } from './storage.js';

const DEFAULT_ROOT_FOLDER = DEFAULT_SETTINGS.rootFolder;

export const SCHEMA_VERSION = '1.1';

/**
 * @param {chrome.tabs.Tab} tab
 * @param {{name: string, caseId: string}} session
 * @param {{auditor: string, rootFolder: string}} settings
 */
export async function captureEvidence(tab, session, settings) {
  const ipPromise = fetchPublicIp();
  const envPromise = getEnvironment();

  const capturedAt = new Date();
  const originalDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const originalBytes = dataUrlToBytes(originalDataUrl);

  const [ipInfo, env, sha256Original] = await Promise.all([ipPromise, envPromise, sha256Hex(originalBytes)]);

  const manifest = chrome.runtime.getManifest();
  const time = timeInfo(capturedAt);
  const evidence = {
    schema_version: SCHEMA_VERSION,
    evidence_id: crypto.randomUUID(),
    session: session.name,
    case_id: session.caseId || null,
    auditor: settings.auditor || null,
    captured_at_utc: time.utc,
    captured_at_local: time.local,
    timezone: time.timezone,
    page: {
      url: tab.url ?? null,
      url_redacted: redactUrl(tab.url),
      title: tab.title ?? null,
    },
    network: {
      public_ip: ipInfo.ip,
      ip_source: ipInfo.source,
      ip_error: ipInfo.error,
    },
    environment: {
      ...env,
      extension: `${manifest.name} ${manifest.version}`,
    },
    capture: {
      mode: 'visible',
      format: 'png',
      width: null,
      height: null,
    },
    integrity: {
      algorithm: 'SHA-256',
      sha256_original: sha256Original,
      sha256_pixels: null,
      sha256_final: null,
    },
  };

  const rendered = await renderWatermark(originalBytes, watermarkLines(evidence, time));
  const finalBytes = rendered.png;
  evidence.capture.width = rendered.width;
  evidence.capture.height = rendered.height;
  // Encoder-independent hash of the captured area: survives lossless re-encoding of the PNG.
  evidence.integrity.sha256_pixels = await sha256Hex(rendered.pixels);
  evidence.integrity.sha256_final = await sha256Hex(finalBytes);

  const paths = buildPaths(settings.rootFolder, session, capturedAt, evidence.evidence_id);
  evidence.files = { image: paths.image, metadata: paths.metadata };

  await download(bytesToDataUrl(finalBytes, 'image/png'), paths.image);
  await download(textToDataUrl(JSON.stringify(evidence, null, 2), 'application/json'), paths.metadata);

  return evidence;
}

function watermarkLines(e, time) {
  return [
    `${chrome.runtime.getManifest().name.toUpperCase()}  ·  ID ${e.evidence_id}`,
    `Session: ${e.session}  |  Case: ${e.case_id ?? '-'}  |  Auditor: ${e.auditor ?? '-'}`,
    `Local: ${time.local_display} (${time.timezone})  |  UTC: ${time.utc}`,
    `URL: ${e.page.url_redacted}`,
    `IP: ${e.network.public_ip}  |  ${e.environment.browser}  |  ${e.environment.os}`,
    `SHA-256 (original): ${e.integrity.sha256_original}`,
  ];
}

/** Windows-safe path segment. */
export function sanitizeSegment(value, fallback) {
  const clean = String(value ?? '')
    // eslint-disable-next-line no-control-regex -- stripping control chars is the intent
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 64);
  return clean || fallback;
}

function buildPaths(rootFolder, session, date, evidenceId) {
  const dir = [
    sanitizeSegment(rootFolder, DEFAULT_ROOT_FOLDER),
    sanitizeSegment(session.name, 'session'),
    localDate(date),
  ].join('/');
  const parts = [localTime(date).replaceAll(':', '')];
  if (session.caseId) parts.push(sanitizeSegment(session.caseId, 'case'));
  parts.push(evidenceId.slice(0, 8));
  const base = `${dir}/${parts.join('_')}`;
  return { image: `${base}.png`, metadata: `${base}.json` };
}

async function download(url, filename) {
  const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  if (id === undefined) throw new Error(chrome.runtime.lastError?.message ?? `Download failed: ${filename}`);
  return id;
}
