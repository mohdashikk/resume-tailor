import { configureStore } from '@reduxjs/toolkit';
import resumeReducer from '../features/resume/resumeSlice';
import jobReducer from '../features/jobDescription/jobSlice';
import tailoringReducer from '../features/tailoring/tailoringSlice';
import { loadSavedState, saveState } from '../services/storageService';

export function makeStore(storage) {
  const loaded = loadSavedState(storage);
  const preloadedState = loaded.data ? {
    resume: { masterResume: loaded.data.masterResume || null, workingResume: loaded.data.workingResume, extractedText: '', sourceName: loaded.data.sourceName || '', upload: { status: 'idle', progress: 0, message: '', error: '' } },
    job: loaded.data.job,
    tailoring: { current: loaded.data.current || null, versions: loaded.data.versions || [], status: 'idle', error: '' },
  } : undefined;
  const store = configureStore({ reducer: { resume: resumeReducer, job: jobReducer, tailoring: tailoringReducer }, preloadedState });
  let timer;
  store.subscribe(() => {
    clearTimeout(timer); timer = setTimeout(() => {
      const state = store.getState();
      try { saveState({ masterResume: state.resume.masterResume, workingResume: state.resume.workingResume, sourceName: state.resume.sourceName, job: state.job, current: state.tailoring.current, versions: state.tailoring.versions }, storage); }
      catch { /* surfaced by explicit backup controls; keep the app usable */ }
    }, 250);
  });
  return { store, recovery: loaded.recovered };
}
