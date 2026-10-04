import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import resumeReducer, { resumeActions } from '../src/features/resume/resumeSlice';
import tailoringReducer, { tailoringActions } from '../src/features/tailoring/tailoringSlice';
import { blankResume } from '../src/services/resumeValidation';

describe('master and tailored resume separation', () => {
  it('never mutates the master when generated content is edited', () => {
    const store = configureStore({ reducer: { resume: resumeReducer, tailoring: tailoringReducer } });
    const base = { ...blankResume(), id: 'master', name: 'Asha', summary: 'Original summary' };
    store.dispatch(resumeActions.setWorkingResume(base)); store.dispatch(resumeActions.confirmMaster());
    store.dispatch(tailoringActions.setTailoredResult({ resume: { ...structuredClone(base), id: 'tailored', summary: 'Focused summary' }, changeSummary: [], missingRequirements: [] }));
    store.dispatch(tailoringActions.updateTailoredResume({ ...store.getState().tailoring.current.resume, summary: 'Edited tailored summary' }));
    expect(store.getState().resume.masterResume.summary).toBe('Original summary');
    expect(store.getState().tailoring.current.resume.summary).toBe('Edited tailored summary');
  });
});
