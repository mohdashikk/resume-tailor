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
import { analyzeAtsWithAI, tailorResumeWithAI } from '../src/services/aiService';

vi.mock('../src/services/aiService', () => ({ analyzeAtsWithAI: vi.fn(), tailorResumeWithAI: vi.fn(), parseResumeWithAI: vi.fn() }));
vi.mock('../src/services/pdfService', () => ({ downloadResumePdf: vi.fn() }));
vi.mock('../src/services/fileExtraction', () => ({ extractResumeText: vi.fn() }));

let container, root, resolveAI, rejectAI, result;
const writing = () => container.querySelector('[aria-label="Writing tailored resume"]');
const finished = () => container.querySelector('[aria-label="Tailored resume preview"]');
async function click(text) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent.includes(text));
  expect(button).toBeTruthy();
  await act(async () => button.click());
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('scrollTo', vi.fn());
  const store = configureStore({ reducer: { resume: resumeReducer, job: jobReducer, tailoring: tailoringReducer } });
  const resume = { ...blankResume(), name: 'Asha Rao', summary: 'Designs accessible products. '.repeat(40), certifications: [{ id: 'last', name: 'Final certification', issuer: 'Design Academy', date: '2025' }] };
  store.dispatch(resumeActions.setWorkingResume(resume));
  store.dispatch(resumeActions.confirmMaster());
  store.dispatch(jobActions.updateJob({ text: 'Seeking a product designer with research, prototyping, accessibility, and design systems experience.' }));
  result = { resume: { ...resume, id: 'tailored' }, changeSummary: [], missingRequirements: [] };
  analyzeAtsWithAI.mockResolvedValue({ score: 70, summary: 'Good match', strengths: [], gaps: [], nextSteps: [] });
  tailorResumeWithAI.mockImplementation(() => new Promise((resolve, reject) => { resolveAI = resolve; rejectAI = reject; }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Provider store={store}><App /></Provider>));
  await click('Check ATS');
  await click('Check ATS Score');
  await click('Tailor for this job');
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps writing after a fast AI response and reveals the last line before switching views', async () => {
  await click('Create tailored resume');
  await act(async () => vi.advanceTimersByTime(1000));
  await act(async () => resolveAI(result));
  expect(writing()).toBeTruthy();
  expect(finished()).toBeNull();
  await act(async () => vi.advanceTimersByTime(22000));
  expect(writing().textContent).toContain('Final certification — Design Academy — 2025');
  await act(async () => vi.advanceTimersByTime(400));
  expect(writing()).toBeNull();
  expect(finished()).toBeTruthy();
});

it('keeps the fully written page visible while waiting for a slower AI response', async () => {
  await click('Create tailored resume');
  await act(async () => vi.advanceTimersByTime(22000));
  await act(async () => vi.advanceTimersByTime(400));
  expect(writing().textContent).toContain('Final certification');
  expect(finished()).toBeNull();
  await act(async () => resolveAI(result));
  expect(finished()).toBeTruthy();
});

it('stops writing immediately when generation fails', async () => {
  await click('Create tailored resume');
  await act(async () => rejectAI(new Error('Please try again.')));
  expect(writing()).toBeNull();
  expect(container.textContent).toContain('Please try again.');
});

it('completes without typing delays when reduced motion is enabled', async () => {
  window.matchMedia.mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  await click('Create tailored resume');
  expect(writing().textContent).toContain('Final certification');
  await act(async () => resolveAI(result));
  await act(async () => vi.advanceTimersByTime(400));
  expect(finished()).toBeTruthy();
});
