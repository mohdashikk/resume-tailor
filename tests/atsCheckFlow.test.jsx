import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import resumeReducer, { resumeActions } from '../src/features/resume/resumeSlice';
import jobReducer from '../src/features/jobDescription/jobSlice';
import tailoringReducer from '../src/features/tailoring/tailoringSlice';
import { blankResume } from '../src/services/resumeValidation';
import { analyzeAtsLocally } from '../src/services/localAtsService';

// Exercise the actual ATS service and controlled paste input, without AI mocks.
vi.mock('../src/services/pdfService', () => ({ downloadResumePdf: vi.fn() }));
vi.mock('../src/services/fileExtraction', () => ({ extractResumeText: vi.fn() }));
let host, root, store;
const posting = 'Requirements:\nExperience\nReact and JavaScript\nPreferred:\nTypeScript\nYou will work with our product engineering team.';
async function click(label) {
  const button = [...host.querySelectorAll('button')].find(node => node.textContent.trim() === label);
  expect(button).toBeTruthy();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
async function paste(text) {
  const input = host.querySelector('textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    const { payload } = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ data: analyzeAtsLocally(payload.resume, payload.jobDescription) }) };
  }));
  store = configureStore({ reducer: { resume: resumeReducer, job: jobReducer, tailoring: tailoringReducer } });
  store.dispatch(resumeActions.setWorkingResume({ ...blankResume(), name: 'Test Candidate', skillGroups: [{ id: 'skills', name: 'Skills', skills: ['React', 'JavaScript'] }] }));
  store.dispatch(resumeActions.confirmMaster());
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Provider store={store}><App /></Provider>));
  await click('Check ATS');
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('shows a result for a pasted posting with common Experience headings', async () => {
  await paste(posting);
  expect(store.getState().job.text).toBe(posting);
  await click('Check ATS Score & Keywords →');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('RESUME MATCH REVIEW');
  expect(host.textContent).toContain('Choose keywords for the rewrite');
  expect(fetch).not.toHaveBeenCalled();
});
it('invalidates the displayed result and checks the newly pasted JD', async () => {
  await paste('Requirements:\nReact and JavaScript are required for our frontend product engineering team.');
  await click('Check ATS Score & Keywords →');
  expect(host.textContent).toContain('RESUME MATCH REVIEW');
  await paste('Requirements:\nPython and SQL are required for our backend data engineering product team.');
  expect(host.textContent).not.toContain('RESUME MATCH REVIEW');
  await click('Check ATS Score & Keywords →');
  expect(host.textContent).toContain('RESUME MATCH REVIEW');
  expect(host.textContent).toContain('python');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
