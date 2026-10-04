import { describe, expect, it } from 'vitest';
import { blankResume } from '../src/services/resumeValidation';
import { buildChangeAudit } from '../src/services/changeAuditService';

describe('tailoring edit history', () => {
  it('shows before/after changes and JD terms introduced after tailoring', () => {
    const master = {
      ...blankResume(), id: 'master', summary: 'Product designer focused on accessible interfaces.',
      experience: [{ id: 'exp-1', role: 'Designer', company: 'Orbit', location: '', startDate: '2022', endDate: 'Present', bullets: [{ id: 'b-1', text: 'Designed responsive product interfaces.' }] }],
    };
    const tailored = {
      ...structuredClone(master), id: 'tailored', summary: 'Product designer focused on accessible SaaS interfaces.',
      experience: [{ ...structuredClone(master.experience[0]), id: 'tailored-exp-1', masterId: 'exp-1', bullets: [{ id: 'tb-1', text: 'Designed responsive SaaS product interfaces.' }] }],
    };
    const audit = buildChangeAudit(master, tailored, ['saas', 'leadership']);
    expect(audit.introducedTerms).toEqual(['saas']);
    expect(audit.changes.some((change) => change.location === 'Professional summary')).toBe(true);
    expect(audit.changes.some((change) => change.location.includes('Bullet 1') && change.jdTerms.includes('saas'))).toBe(true);
  });

  it('returns no edits for identical resumes', () => {
    const master = blankResume();
    expect(buildChangeAudit(master, structuredClone(master), []).changes).toEqual([]);
  });
});
