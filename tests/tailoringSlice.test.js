import { describe, expect, it } from 'vitest';
import reducer, { tailoringActions } from '../src/features/tailoring/tailoringSlice';

describe('confirming a missing JD requirement', () => {
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
