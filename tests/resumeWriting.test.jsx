import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import resumeReducer, { resumeActions } from '../src/features/resume/resumeSlice';
import jobReducer, { jobActions } from '../src/features/jobDescription/jobSlice';
import tailoringReducer from '../src/features/tailoring/tailoringSlice';
import { blankResume } from '../src/services/resumeValidation';
import { analyzeAtsLocally } from '../src/services/localAtsService';
import { tailoringActions } from '../src/features/tailoring/tailoringSlice';
import { buildAnalysis } from '../src/services/atsAnalysis';
import { analyzeAtsWithAI, tailorResumeWithAI } from '../src/services/aiService';
import { downloadResumePdf } from '../src/services/pdfService';

vi.mock('../src/services/aiService', () => ({ analyzeAtsWithAI: vi.fn(), tailorResumeWithAI: vi.fn(), parseResumeWithAI: vi.fn() }));
vi.mock('../src/services/pdfService', () => ({ downloadResumePdf: vi.fn() }));
vi.mock('../src/services/fileExtraction', () => ({ extractResumeText: vi.fn() }));
let container, root, store, resolveAI, rejectAI, result, source;
async function click(text) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent.includes(text));
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', vi.fn());
  store = configureStore({ reducer: { resume: resumeReducer, job: jobReducer, tailoring: tailoringReducer } });
  source = { ...blankResume(), name: 'Asha Rao', title: 'Developer', summary: 'React developer building web interfaces.' };
  const jd = 'Seeking a React frontend engineer to build responsive user interfaces for our digital product team.';
  store.dispatch(resumeActions.setWorkingResume(source));
  store.dispatch(resumeActions.confirmMaster());
  store.dispatch(jobActions.updateJob({ text: jd, jobTitle: 'Frontend Engineer', company: 'Example' }));
  result = { resume: { ...source, id: 'tailored', title: 'Frontend Engineer', summary: 'Builds responsive interfaces with React.' }, changeSummary: [], missingRequirements: [] };
  analyzeAtsWithAI.mockResolvedValue(buildAnalysis({ requirements: [{ term: 'React', source: 'React', priority: 'required', status: 'matched', evidence: ['React developer building web interfaces.'] }] }, source, jd));
  tailorResumeWithAI.mockImplementation(() => new Promise((resolve, reject) => { resolveAI = resolve; rejectAI = reject; }));
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Provider store={store}><App /></Provider>));
  await click('Check ATS');
  await click('Check ATS Score');
  await click('Tailor for this job');
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.unstubAllGlobals(); vi.clearAllMocks();
});
it('starts the full rewrite directly after the match check', () => {
  expect(tailorResumeWithAI).toHaveBeenCalledTimes(1);
  expect(tailorResumeWithAI.mock.calls[0].slice(0, 4)).toEqual([source, store.getState().job.text, 'Example', 'Frontend Engineer']);
  expect(container.textContent).toContain('Building your tailored resume');
  expect(store.getState().tailoring.status).toBe('loading');
});
it('reports PDF rendering failures without changing the generated resume', async () => {
  await act(async () => resolveAI(result));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  downloadResumePdf.mockRejectedValueOnce(new Error('render failed'));
  await click('Export PDF');
  expect(container.textContent).toContain('PDF export failed while rendering the document.');
  expect(store.getState().tailoring.current.resume).toEqual(result.resume);
  expect(store.getState().resume.masterResume).toEqual(source);
  expect(JSON.stringify(warning.mock.calls)).not.toContain(source.name);
  warning.mockRestore();
});
it('shows the rewritten resume and review controls as soon as generation completes', async () => {
  await act(async () => resolveAI(result));
  expect(container.querySelector('[aria-label="Tailored resume preview"]').textContent).toContain(result.resume.summary);
  expect(container.textContent).toContain('ATS Match Score');
  expect(container.textContent).toContain('Cover Letter');
  expect(container.textContent).toContain('Rewrite Resume');
  expect(document.body.textContent).not.toContain('Review AI edits');
  expect(container.textContent).toContain('Export PDF');
  expect(store.getState().resume.masterResume).toEqual(source);
});
it('shows a retryable error when generation fails', async () => {
  await act(async () => rejectAI(new Error('Please try again.')));
  expect(container.textContent).toContain('Please try again.');
  expect(store.getState().tailoring.current).toBeNull();
  expect(store.getState().resume.masterResume).toEqual(source);
});
it('rejects malformed generated data before displaying a result', async () => {
  await act(async () => resolveAI({ resume: { name: 'Broken' } }));
  expect(container.textContent).toContain('malformed resume data');
  expect(container.querySelector('[aria-label="Tailored resume preview"]')).toBeNull();
});
it('shows before-and-after estimates and explains unavailable targeted editing', async () => {
  await act(async () => resolveAI({ ...result, matchComparison: { before: 80, after: 80, changedBullets: 0, rejectedBullets: 0, status: 'unavailable' } }));
  expect(container.textContent).toContain('ATS Match Score');
  expect(container.textContent).toContain('Original descriptions were retained');
  expect(store.getState().tailoring.current.matchComparison.status).toBe('unavailable');
});

it('updates review scores and keywords after experience edits and switches base previews', async () => {
  await act(async () => resolveAI(result));
  const edited = { ...result.resume, summary: 'React developer building web interfaces.', experience: [{ id: 'e', role: 'Developer', company: 'Example', location: '', startDate: '', endDate: '', bullets: [{ id: 'b', text: 'Built responsive user interfaces with React.' }] }] };
  await act(async () => store.dispatch(tailoringActions.updateTailoredResume(edited)));
  const expected = analyzeAtsLocally(edited, store.getState().job.text);
  const metric = container.querySelector('[aria-label="Tailored ATS match"]');
  expect(metric.getAttribute('aria-valuenow')).toBe(String(expected.score));
  expect(container.querySelector('[aria-label="Tailored resume preview"] mark')).toBeTruthy();
  await click('Base resume');
  expect(container.querySelector('[aria-label="Base resume preview"]').textContent).toContain(source.summary);
  expect(store.getState().resume.masterResume).toEqual(source);
});

it('rewrites the current copy using the validated rubric and preserves the master', async () => {
  await act(async () => resolveAI(result));
  const checks = analyzeAtsWithAI.mock.calls.length;
  await click('Rewrite Resume');
  expect(analyzeAtsWithAI.mock.calls.length).toBe(checks);
  expect(tailorResumeWithAI.mock.calls.at(-1)[0]).toEqual(result.resume);
  expect(tailorResumeWithAI.mock.calls.at(-1)[5]).toEqual({ force: true, confirmedSkills: [], verifiedCareerProfile: source });
  expect(container.textContent).toContain('Rewriting resume…');
  await act(async () => resolveAI(result));
  expect(container.textContent).toContain('Rewrite Resume');
  expect(store.getState().resume.masterResume).toEqual(source);
  expect(container.textContent).not.toContain('Fit to one page');
});
it('shows all keywords without application category filters', async () => {
  await act(async () => resolveAI(result));
  const meter = () => container.querySelector('[aria-label="Tailored ATS match"]').getAttribute('aria-valuenow');
  const before = meter();
  expect(container.querySelector('[aria-label="Filter job keywords"]')).toBeNull();
  expect(container.textContent).not.toContain('Detected:');
  expect(container.textContent).not.toContain('First tailoring target:');
  expect(container.querySelector('[aria-label="ATS match overview"]').textContent).toContain('Matched keywords');
  expect(meter()).toBe(before);
});
