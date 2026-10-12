import { resumeSchema, tailoredResultSchema } from './resumeValidation';

export const STORAGE_KEY = 'doitnext:v1';
const LEGACY_STORAGE_KEY = 'reum-tailor:v1';
const BACKUP_FORMAT = 'doitnext-backup';
const LEGACY_BACKUP_FORMAT = 'reum-tailor-backup';

export function loadSavedState(storage = localStorage) {
  let sourceKey = STORAGE_KEY;
  try {
    const current = storage.getItem(STORAGE_KEY);
    sourceKey = current ? STORAGE_KEY : LEGACY_STORAGE_KEY;
    const raw = current || storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { data: null, recovered: false };
    const parsed = JSON.parse(raw);
    if (parsed.masterResume) resumeSchema.parse(parsed.masterResume);
    (parsed.resumeLibrary || []).forEach((entry) => resumeSchema.parse(entry.resume));
    (parsed.versions || []).forEach((version) => tailoredResultSchema.parse({ resume: version.resume, changeSummary: version.changeSummary, missingRequirements: version.missingRequirements }));
    if (sourceKey === LEGACY_STORAGE_KEY) {
      try { storage.setItem(STORAGE_KEY, raw); storage.removeItem(LEGACY_STORAGE_KEY); } catch { /* migration can retry later */ }
    }
    return { data: parsed, recovered: false };
  } catch (error) {
    try { storage.setItem(`${sourceKey}:recovery`, storage.getItem(sourceKey) || ''); storage.removeItem(sourceKey); } catch { /* storage may be unavailable */ }
    return { data: null, recovered: true, error: error.message };
  }
}

export function saveState(data, storage = localStorage) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
  catch (error) { throw new Error(`Could not save locally: ${error.message}`); }
}

export function exportBackup(data) {
  const blob = new Blob([JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `doitnext.ai-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
}

export async function importBackup(file) {
  const parsed = JSON.parse(await file.text());
  if (![BACKUP_FORMAT, LEGACY_BACKUP_FORMAT].includes(parsed.format) || !parsed.data) throw new Error('This is not a valid doitnext.ai backup.');
  if (parsed.data.masterResume) resumeSchema.parse(parsed.data.masterResume);
  (parsed.data.resumeLibrary || []).forEach((entry) => resumeSchema.parse(entry.resume));
  return parsed.data;
}
