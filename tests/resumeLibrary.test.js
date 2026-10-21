import { describe, expect, it } from 'vitest';
import resumeReducer, { resumeActions } from '../src/features/resume/resumeSlice';
import { blankResume } from '../src/services/resumeValidation';

describe('resume library selection', () => {
  it('opens a parsed copy without replacing the confirmed master', () => {
    const master = { ...blankResume(), id: 'master', name: 'Saved master' };
    const parsedCopy = { ...blankResume(), id: 'parsed', name: 'Reparsed copy' };
    let state = resumeReducer(undefined, resumeActions.setWorkingResume(master));
    state = resumeReducer(state, resumeActions.confirmMaster());
    state = resumeReducer(state, resumeActions.upsertResumeLibrary({ resume: master, sourceName: 'original.pdf', isMaster: true }));
    const entry = { resume: parsedCopy, sourceName: 'reparsed.pdf', isMaster: false };
    state = resumeReducer(state, resumeActions.upsertResumeLibrary(entry));
    state = resumeReducer(state, resumeActions.loadResumeFromLibrary(entry));
    expect(state.workingResume.name).toBe('Reparsed copy');
    expect(state.masterResume).toEqual(master);
    expect(state.resumeLibrary.find((item) => item.resume.id === 'master').isMaster).toBe(true);
    expect(state.resumeLibrary.find((item) => item.resume.id === 'parsed').isMaster).toBe(false);
  });
});
