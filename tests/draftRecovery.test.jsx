import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { makeStore } from '../src/app/store';
import { blankResume } from '../src/services/resumeValidation';
import { buildAnalysis } from '../src/services/atsAnalysis';
import { loadSavedState, STORAGE_KEY } from '../src/services/storageService';

vi.mock('../src/services/pdfService', () => ({ downloadResumePdf: vi.fn() }));
vi.mock('../src/services/fileExtraction', () => ({ extractResumeText: vi.fn() }));
const source = { ...blankResume(), name: 'Asha', summary: 'React developer', skillGroups: [{ id: 's', name: 'Skills', skills: ['Git', 'React'] }] };
const jd = 'React and Jest';
const analysis = buildAnalysis({ requirements: ['React', 'Jest'].map((term) => ({ term, source: term, priority: 'required', status: term === 'React' ? 'matched' : 'missing', evidence: term === 'React' ? ['React developer'] : [] })) }, source, jd);
const draft = { id: 'draft', resume: { ...source, id: 'tailored', skillGroups: [{ ...source.skillGroups[0], skills: ['React', 'Git'] }] }, sourceResume: source, analysis, jobDescription: jd, changeSummary: ['Added missingRequirements'], missingRequirements: ['jest'] };
const storageFor = (data) => { const map = new Map([[STORAGE_KEY, JSON.stringify(data)]]); return { getItem: (k) => map.get(k) || null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) }; };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('isolates bad drafts, preserves legacy drafts, and validates persisted analysis', () => {
  const legacy = { resume: draft.resume };
  const saved = loadSavedState(storageFor({ masterResume: source, current: draft, versions: [draft, legacy, { resume: 7 }] })).data;
  expect(saved.versions).toHaveLength(2);
  expect(saved.versions[1].changeSummary).toEqual([]);
  expect(saved.versions[1].analysis).toBeNull();
  expect(saved.current.analysis.score).toBe(50);
  expect(saved.masterResume.id).toBe(source.id);
  expect(loadSavedState(storageFor({ current: { ...draft, analysis: { ...analysis, version: 'old' } } })).data.current.analysis).toBeNull();
});
it('opens saved versions after refresh without ATS and shows actual skill reordering', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  const fetch = vi.spyOn(globalThis, 'fetch');
  const { store } = makeStore(storageFor({ masterResume: source, job: { text: '', company: '', jobTitle: '' }, versions: [draft] }));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Provider store={store}><App /></Provider>));
    const nav = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Tailor & review'));
    expect(nav.disabled).toBe(false);
    await act(async () => nav.click());
    expect(container.querySelector('[aria-label="Tailored ATS match"]').getAttribute('aria-valuenow')).toBe('50');
    expect(container.querySelector('[aria-label="Tailored resume preview"]')).toBeTruthy();
    expect(container.textContent).not.toContain('What changed');
    expect(container.textContent).not.toContain('Added missingRequirements');
    expect(store.getState().job.text).toBe(jd);
    expect(store.getState().resume.masterResume).toEqual(source);
    expect(fetch).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); container.remove(); }
});
