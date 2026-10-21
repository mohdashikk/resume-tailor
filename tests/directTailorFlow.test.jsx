import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import resumeReducer, { resumeActions } from '../src/features/resume/resumeSlice';
import jobReducer, { jobActions } from '../src/features/jobDescription/jobSlice';
import tailoringReducer from '../src/features/tailoring/tailoringSlice';
import { blankResume } from '../src/services/resumeValidation';
import { validateAnalysis } from '../src/services/atsAnalysis';
import { analyzeAtsLocally } from '../src/services/localAtsService';
import { analyzeAtsWithAI, tailorResumeWithAI } from '../src/services/aiService';

vi.mock('../src/services/aiService', () => ({ analyzeAtsWithAI: vi.fn(), tailorResumeWithAI: vi.fn(), parseResumeWithAI: vi.fn() }));
vi.mock('../src/services/pdfService', () => ({ downloadResumePdf: vi.fn() }));
vi.mock('../src/services/fileExtraction', () => ({ extractResumeText: vi.fn() }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it('checks ATS, requires keyword selection, then rewrites Experience and shows the final ATS', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', vi.fn());
  const store = configureStore({ reducer: { resume: resumeReducer, job: jobReducer, tailoring: tailoringReducer } });
  const source = blankResume();
  source.name = 'Sample Candidate';
  source.title = 'Frontend Developer';
  source.summary = 'Frontend developer building React interfaces.';
  source.skillGroups = [{ id: 'skills', name: 'Skills', skills: ['React', 'CSS'] }];
  source.experience = [{ id: 'job', role: 'Frontend Developer', company: 'Example', location: '', startDate: '2022', endDate: '2024', bullets: [{ id: 'bullet', text: 'Built responsive web interfaces with React.' }] }];
  const jd = 'Seeking a frontend engineer to build responsive web interfaces with React and CSS in a product team.';
  store.dispatch(resumeActions.setWorkingResume(source));
  store.dispatch(resumeActions.confirmMaster());
  store.dispatch(jobActions.updateJob({ text: jd, jobTitle: 'Frontend Engineer', company: 'Product Team' }));
  analyzeAtsWithAI.mockImplementation(async (candidate, description) => analyzeAtsLocally(candidate, description));
  let resolveAI;
  tailorResumeWithAI.mockImplementation(() => new Promise(resolve => { resolveAI = resolve; }));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const click = async label => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent.includes(label));
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  try {
    await act(async () => root.render(<Provider store={store}><App /></Provider>));
    await click('Check ATS');
    expect(container.textContent).toContain('First, check your base ATS match');
    await click('Check ATS Score & Keywords');
    expect(tailorResumeWithAI).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Choose keywords for the rewrite');
    const keyword = container.querySelector('[aria-label="Choose keywords to prioritize"] input');
    expect(keyword).toBeTruthy();
    await act(async () => keyword.click());
    await click('Rewrite resume with AI');
    expect(analyzeAtsWithAI).toHaveBeenCalledTimes(1);
    expect(tailorResumeWithAI).toHaveBeenCalledTimes(1);
    expect(tailorResumeWithAI.mock.calls[0][5].selectedKeywords).toHaveLength(1);
    expect(() => validateAnalysis(tailorResumeWithAI.mock.calls[0][4], source, jd)).not.toThrow();
    expect(container.textContent).toContain('Rewrite Experience with AI');
    expect(container.textContent).toContain('Review and align skills');
    expect(container.textContent).toContain('Check the tailored ATS score');
    expect(container.querySelector('[aria-label="Base resume preview"]').textContent).toContain(source.experience[0].bullets[0].text);
    const tailored = structuredClone(source);
    tailored.id = 'tailored';
    tailored.experience[0].bullets[0].text = 'Developed web interfaces in React with responsive layouts.';
    await act(async () => resolveAI({ resume: tailored, changeSummary: [], missingRequirements: [] }));
    expect(container.textContent).toContain('Tailored copy ready to review');
    expect(container.textContent).toContain('1 of 1 experience bullets updated');
    expect(container.textContent).toContain('listed skills reviewed');
    expect(container.textContent).toMatch(/Tailored resume scored \d+\/100/);
    expect(container.querySelector('[aria-label="Tailored resume preview"]').textContent).toContain(tailored.experience[0].bullets[0].text);
    expect(store.getState().resume.masterResume).toEqual(source);
  } finally { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); }
});
