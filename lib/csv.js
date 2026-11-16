// CSV export helpers for the capture history.

export const CSV_COLUMNS = [
  'evidence_id', 'captured_at_utc', 'session', 'case_id', 'auditor',
  'url', 'public_ip', 'sha256_original', 'sha256_final', 'image',
];

/** Quotes a CSV cell and neutralizes spreadsheet formula injection (CWE-1236). */
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export function historyToCsv(history) {
  const rows = history.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}
