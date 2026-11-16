// Service worker: entry point for popup messages and keyboard shortcuts.

import { captureEvidence } from './lib/capture.js';
import { appendHistory, getSession, getSettings } from './lib/storage.js';

class SessionRequiredError extends Error {
  constructor() {
    super('No active session. Start a session first.');
    this.code = 'SESSION_REQUIRED';
  }
}

let captureInProgress = false;

async function runCapture(tabId) {
  if (captureInProgress) throw new Error('A capture is already in progress.');
  const session = await getSession();
  if (!session) throw new SessionRequiredError();

  captureInProgress = true;
  try {
    const [tab, settings] = await Promise.all([chrome.tabs.get(tabId), getSettings()]);
    const evidence = await captureEvidence(tab, session, settings);
    await appendHistory({
      evidence_id: evidence.evidence_id,
      captured_at_utc: evidence.captured_at_utc,
      session: evidence.session,
      case_id: evidence.case_id,
      auditor: evidence.auditor,
      url: evidence.page.url,
      public_ip: evidence.network.public_ip,
      sha256_original: evidence.integrity.sha256_original,
      sha256_final: evidence.integrity.sha256_final,
      image: evidence.files.image,
    });
    return evidence;
  } finally {
    captureInProgress = false;
  }
}

async function flashBadge(text, color, ms = 2500) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), ms);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'capture') return false;
  runCapture(msg.tabId)
    .then((evidence) => sendResponse({ ok: true, evidence }))
    .catch((err) => sendResponse({ ok: false, error: err.message, code: err.code ?? null }));
  return true;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'capture-visible' || !tab?.id) return;
  try {
    await runCapture(tab.id);
    await flashBadge('OK', '#2e7d32');
  } catch (err) {
    console.error('[capture]', err);
    if (err.code === 'SESSION_REQUIRED') {
      // Ask for the session name: open the popup when supported, otherwise flag it on the badge.
      try {
        await chrome.action.openPopup();
        return;
      } catch {
        /* fall through */
      }
    }
    await flashBadge('ERR', '#c62828', 4000);
  }
});
