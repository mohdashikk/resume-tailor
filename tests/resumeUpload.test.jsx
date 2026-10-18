import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import ResumePreview from '../src/components/ResumePreview';
import resumeReducer, { resumeActions } from '../src/features/resume/resumeSlice';
import jobReducer, { jobActions } from '../src/features/jobDescription/jobSlice';
import tailoringReducer from '../src/features/tailoring/tailoringSlice';
import { blankResume } from '../src/services/resumeValidation';
import { parseResumeWithAI, analyzeAtsWithAI } from '../src/services/aiService';
import { analyzeAtsLocally } from '../src/services/localAtsService';
import { extractResumeText } from '../src/services/fileExtraction';

vi.mock('../src/services/aiService', () => ({ parseResumeWithAI: vi.fn(), analyzeAtsWithAI: vi.fn(), tailorResumeWithAI: vi.fn() }));
vi.mock('../src/services/fileExtraction', () => ({ extractResumeText: vi.fn() }));
vi.mock('../src/services/pdfService', () => ({ downloadResumePdf: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('uses the latest upload in the existing template without mixing previous resumes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  localStorage.clear();
  const store = configureStore({ reducer: { resume: resumeReducer, job: jobReducer, tailoring: tailoringReducer } });
  const old = { ...blankResume(), id: 'provider-repeats-id', name: 'Previous Person', skillGroups: [{ id: 's', name: 'Skills', skills: ['Old skill'] }] };
  store.dispatch(resumeActions.setWorkingResume(old)); store.dispatch(resumeActions.confirmMaster());
  const pending = [];
  extractResumeText.mockImplementation(async (file) => ({ text: file.name, warnings: [] }));
  parseResumeWithAI.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<Provider store={store}><App /></Provider>));
    const input = container.querySelector('input[accept^=".pdf"]');
    const upload = async (name) => {
      Object.defineProperty(input, 'files', { configurable: true, value: [{ name }] });
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    };
    await upload('first.pdf'); await upload('second.pdf');
    expect(pending).toHaveLength(2);
    const second = { ...blankResume(), id: old.id, name: 'New Person', title: 'Accountant', contact: { email: 'new@example.com', phone: '', location: '' } };
    await act(async () => pending[1](second));
    await act(async () => pending[0]({ ...old, name: 'Stale Upload' }));
    const state = store.getState().resume;
    expect(state.workingResume.name).toBe('New Person');
    expect(state.workingResume.id).not.toBe(old.id);
    expect(state.workingResume.skillGroups).toEqual([]);
    expect(state.masterResume).toEqual(old);
    expect(state.sourceName).toBe('second.pdf');
    expect(state.resumeLibrary).toHaveLength(1);
    const preview = container.querySelector('[aria-label="Resume preview"]');
    expect(preview.textContent).toContain('New Person');
    expect(preview.textContent).toContain('new@example.com');
    expect(preview.textContent).not.toContain('Previous Person');
    expect(preview.textContent).not.toContain('Old skill');
    await act(async () => store.dispatch(jobActions.updateJob({ text: 'Requirements:\nReact and JavaScript are required for our frontend product engineering team.' })));
    analyzeAtsWithAI.mockImplementation(async (candidate, jd) => analyzeAtsLocally(candidate, jd));
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Check ATS').click());
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent.includes('Check ATS Score')).click());
    expect(analyzeAtsWithAI.mock.calls.at(-1)[0].name).toBe('New Person');
    expect(analyzeAtsWithAI.mock.calls.at(-1)[0].id).toBe(state.workingResume.id);
    expect(container.textContent).toContain('second.pdf');
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it('shows parsed project links and education locations in the template', () => {
  const resume = { ...blankResume(), name: 'New Person', projects: [{ id: 'p', name: 'Portal', link: 'https://example.com/portal', bullets: [] }], education: [{ id: 'e', qualification: 'BSc', institution: 'College', location: 'Pune, India', details: '' }] };
  const html = renderToStaticMarkup(<ResumePreview resume={resume} />);
  expect(html).toContain('https://example.com/portal');
  expect(html).toContain('Pune, India');
});

it('keeps source text and the saved resume when both AI and fallback parsing fail', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const store = configureStore({ reducer: { resume: resumeReducer, job: jobReducer, tailoring: tailoringReducer } });
  const original = { ...blankResume(), name: 'Saved Person' };
  store.dispatch(resumeActions.setWorkingResume(original));
  store.dispatch(resumeActions.confirmMaster());
  const raw = `Alex Morgan\nFrontend Engineer\nEducation\nDiploma ${'unstructured source content '.repeat(30)}`;
  extractResumeText.mockResolvedValue({ text: raw, warnings: [] });
  parseResumeWithAI.mockRejectedValue(new Error('AI unavailable'));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Provider store={store}><App /></Provider>));
    const input = container.querySelector('input[accept^=".pdf"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'unclear.pdf' }] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(store.getState().resume.masterResume).toEqual(original);
    expect(store.getState().resume.workingResume).toEqual(original);
    expect(store.getState().resume.extractedText).toBe(raw);
    expect(store.getState().resume.upload.status).toBe('error');
    expect(container.textContent).toContain('Some resume fields could not be read reliably');
    expect(container.textContent).not.toContain('too_big');
  } finally { await act(async () => root.unmount()); container.remove(); }
});
