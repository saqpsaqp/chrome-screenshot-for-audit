// Persistent state: settings, active session and capture history (chrome.storage.local).

const HISTORY_LIMIT = 2000;

export const DEFAULT_SETTINGS = {
  auditor: '',
  rootFolder: 'EvidenceCapture',
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const settings = { ...current, ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

/** @returns {Promise<{name: string, caseId: string, startedAt: string} | null>} */
export async function getSession() {
  const { session } = await chrome.storage.local.get('session');
  return session?.name ? session : null;
}

export async function startSession(name, caseId = '') {
  const session = { name: name.trim(), caseId: caseId.trim(), startedAt: new Date().toISOString() };
  await chrome.storage.local.set({ session });
  return session;
}

export async function updateSession(patch) {
  const current = await getSession();
  if (!current) return null;
  const session = { ...current, ...patch };
  await chrome.storage.local.set({ session });
  return session;
}

export async function endSession() {
  await chrome.storage.local.remove('session');
}

export async function getHistory() {
  const { history } = await chrome.storage.local.get('history');
  return Array.isArray(history) ? history : [];
}

export async function appendHistory(record) {
  const history = await getHistory();
  history.push(record);
  await chrome.storage.local.set({ history: history.slice(-HISTORY_LIMIT) });
}

export async function clearHistory() {
  await chrome.storage.local.remove('history');
}
