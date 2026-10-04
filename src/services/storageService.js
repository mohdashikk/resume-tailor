import { resumeSchema, tailoredResultSchema } from './resumeValidation';

export const STORAGE_KEY = 'reum-tailor:v1';

export function loadSavedState(storage = localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { data: null, recovered: false };
    const parsed = JSON.parse(raw);
    if (parsed.masterResume) resumeSchema.parse(parsed.masterResume);
    (parsed.versions || []).forEach((version) => tailoredResultSchema.parse({ resume: version.resume, changeSummary: version.changeSummary, missingRequirements: version.missingRequirements }));
    return { data: parsed, recovered: false };
  } catch (error) {
    try { storage.setItem(`${STORAGE_KEY}:recovery`, storage.getItem(STORAGE_KEY) || ''); storage.removeItem(STORAGE_KEY); } catch { /* storage may be unavailable */ }
    return { data: null, recovered: true, error: error.message };
  }
}

export function saveState(data, storage = localStorage) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
  catch (error) { throw new Error(`Could not save locally: ${error.message}`); }
}

export function exportBackup(data) {
  const blob = new Blob([JSON.stringify({ format: 'reum-tailor-backup', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `reum-tailor-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
}

export async function importBackup(file) {
  const parsed = JSON.parse(await file.text());
  if (parsed.format !== 'reum-tailor-backup' || !parsed.data) throw new Error('This is not a valid Reum backup.');
  if (parsed.data.masterResume) resumeSchema.parse(parsed.data.masterResume);
  return parsed.data;
}
