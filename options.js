import { sanitizeSegment } from './lib/capture.js';
import { historyToCsv } from './lib/csv.js';
import { clearHistory, DEFAULT_SETTINGS, getHistory, getSettings, saveSettings } from './lib/storage.js';

const $ = (id) => document.getElementById(id);
const TABLE_ROWS = 100;

async function loadSettings() {
  const settings = await getSettings();
  $('auditor').value = settings.auditor;
  $('rootFolder').value = settings.rootFolder;
  $('pathPreview').textContent = settings.rootFolder;
}

async function loadShortcut() {
  const commands = await chrome.commands.getAll();
  $('shortcut').textContent = commands.find((c) => c.name === 'capture-visible')?.shortcut || 'not set';
}

async function loadHistory() {
  const history = await getHistory();
  $('historySummary').textContent = history.length
    ? `${history.length} capture${history.length === 1 ? "" : "s"} logged. Showing the latest ${Math.min(history.length, TABLE_ROWS)}.`
    : 'No captures yet.';

  const body = $('historyBody');
  body.replaceChildren();
  for (const r of history.slice(-TABLE_ROWS).reverse()) {
    const tr = document.createElement('tr');
    const cells = [r.captured_at_utc, r.session, r.case_id ?? '-', r.url, r.public_ip, r.sha256_final];
    cells.forEach((value, i) => {
      const td = document.createElement('td');
      if (i === 5) {
        const code = document.createElement('code');
        code.textContent = value ?? '';
        td.append(code);
      } else {
        td.textContent = value ?? '';
      }
      if (i === 3) { td.className = 'url'; td.title = value ?? ''; }
      tr.append(td);
    });
    body.append(tr);
  }
}

$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const settings = await saveSettings({
    auditor: $('auditor').value.trim(),
    rootFolder: sanitizeSegment($('rootFolder').value, DEFAULT_SETTINGS.rootFolder),
  });
  $('rootFolder').value = settings.rootFolder;
  $('pathPreview').textContent = settings.rootFolder;
  $('settingsStatus').textContent = 'Saved.';
  $('settingsStatus').className = 'status ok';
  setTimeout(() => { $('settingsStatus').textContent = ''; }, 2000);
});

$('editShortcut').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

$('exportCsv').addEventListener('click', async () => {
  const history = await getHistory();
  if (!history.length) return;
  const csv = historyToCsv(history);
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const { rootFolder } = await getSettings();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    await chrome.downloads.download({ url, filename: `${sanitizeSegment(rootFolder, DEFAULT_SETTINGS.rootFolder)}/history_${stamp}.csv`, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
});

$('clearHistory').addEventListener('click', async () => {
  if (!confirm('Clear the local capture history? Evidence files on disk are not deleted.')) return;
  await clearHistory();
  await loadHistory();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) loadHistory();
});

$('title').textContent = `${chrome.runtime.getManifest().name} Settings`;
loadSettings();
loadShortcut();
loadHistory();
