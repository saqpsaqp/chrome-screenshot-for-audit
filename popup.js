import { endSession, getHistory, getSession, getSettings, saveSettings, startSession, updateSession } from './lib/storage.js';

const $ = (id) => document.getElementById(id);

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

async function render() {
  const manifest = chrome.runtime.getManifest();
  $('appName').textContent = manifest.name;
  $('version').textContent = `v${manifest.version}`;

  const [session, settings, history] = await Promise.all([getSession(), getSettings(), getHistory()]);
  $('historyCount').textContent = `${history.length} capture${history.length === 1 ? '' : 's'} logged`;

  $('sessionForm').classList.toggle('hidden', !!session);
  $('capturePanel').classList.toggle('hidden', !session);

  if (!session) {
    $('auditorStart').value = settings.auditor;
    $('sessionName').focus();
    return;
  }

  $('sessionLabel').textContent = session.name;
  $('auditorLabel').textContent = settings.auditor ? `Auditor: ${settings.auditor}` : 'Auditor not set';
  $('caseId').value = session.caseId;

  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((c) => c.name === 'capture-visible')?.shortcut;
  $('shortcutHint').innerHTML = '';
  if (shortcut) {
    const kbd = document.createElement('kbd');
    kbd.textContent = shortcut;
    $('shortcutHint').append('Shortcut: ', kbd);
  } else {
    $('shortcutHint').textContent = 'No shortcut assigned (set it in Settings).';
  }
}

$('sessionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('sessionName').value.trim();
  if (!name) return;
  await saveSettings({ auditor: $('auditorStart').value.trim() });
  await startSession(name, $('caseIdStart').value);
  await render();
});

$('endSession').addEventListener('click', async () => {
  await endSession();
  setStatus('');
  $('lastHash').textContent = '';
  await render();
});

$('caseId').addEventListener('change', () => updateSession({ caseId: $('caseId').value.trim() }));

$('captureVisible').addEventListener('click', async () => {
  const btn = $('captureVisible');
  btn.disabled = true;
  setStatus('Capturing…');
  $('lastHash').textContent = '';
  try {
    await updateSession({ caseId: $('caseId').value.trim() });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.runtime.sendMessage({ type: 'capture', tabId: tab.id });
    if (!res?.ok) throw new Error(res?.error ?? 'Unknown error');
    setStatus(`Saved: ${res.evidence.files.image}`, 'ok');
    $('lastHash').textContent = `SHA-256 (final): ${res.evidence.integrity.sha256_final}`;
    const history = await getHistory();
    $('historyCount').textContent = `${history.length} capture${history.length === 1 ? '' : 's'} logged`;
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

render();
