import { describe, expect, it } from 'vitest';
import { blankResume, normalizeResume, validateResume } from '../src/services/resumeValidation';

describe('resume validation', () => {
  it('normalizes stable IDs and validates structured resume data', () => {
    const result = normalizeResume({ ...blankResume(), id: 'resume-1', name: 'Asha Rao', experience: [{ id: 'exp-1', role: 'Engineer', company: 'Orbit', location: '', startDate: '2022', endDate: 'Present', bullets: ['Improved delivery time by 20%.'] }] });
    expect(result.experience[0].id).toBe('exp-1');
    expect(result.experience[0].bullets[0].id).toBeTruthy();
    expect(validateResume(result).success).toBe(true);
  });

  it('rejects malformed nested data', () => {
    const value = blankResume(); value.contact = 'not-an-object';
    expect(validateResume(value).success).toBe(false);
  });
});
