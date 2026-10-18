import { describe, expect, it } from 'vitest';
import reducer, { tailoringActions } from '../src/features/tailoring/tailoringSlice';

describe('confirming a missing JD requirement', () => {
  it('adds confirmed work evidence only to the selected tailored role', () => {
    const state = { versions: [], current: { resume: { experience: [{ id: 'one', company: 'Acme', bullets: [] }, { id: 'two', company: 'Other', bullets: [] }] }, changeSummary: [] } };
    const next = reducer(state, tailoringActions.addExperienceEvidence({ entryId: 'one', text: 'Built TypeScript components for the customer portal.', requirement: 'TypeScript' }));
    expect(next.current.resume.experience[0].bullets[0].text).toContain('TypeScript');
    expect(next.current.resume.experience[1]).toEqual(state.current.resume.experience[1]);
    expect(state.current.resume.experience[0].bullets).toEqual([]);
    expect(reducer(state, tailoringActions.addExperienceEvidence({ entryId: 'unknown', text: 'TypeScript', requirement: 'TypeScript' }))).toEqual(state);
  });
  it('adds a user-confirmed requirement to tailored skills and removes it from missing', () => {
    const state = {
      status: 'succeeded', error: '', versions: [],
      current: {
        resume: { skillGroups: [] },
        changeSummary: [],
        missingRequirements: ['Prototyping'],
      },
    };
    const next = reducer(state, tailoringActions.confirmMissingRequirement({ requirement: 'Prototyping', skill: 'Interactive prototyping' }));

    expect(next.current.resume.skillGroups[0]).toEqual({
      id: 'confirmed-jd-skills',
      name: 'Additional relevant skills',
      skills: ['Interactive prototyping'],
    });
    expect(next.current.missingRequirements).toEqual([]);
    expect(next.current.changeSummary[0]).toContain('Interactive prototyping');
  });
});
