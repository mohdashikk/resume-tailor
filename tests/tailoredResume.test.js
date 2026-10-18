import { describe, expect, it } from 'vitest';
import { blankResume } from '../src/services/resumeValidation.js';
import { reconcileTailoredResume } from '../src/services/tailoredResumeService.js';
import { buildChangeAudit, rejectAuditChange } from '../src/services/changeAuditService.js';

const master = {
  ...blankResume(), name: 'Alex', title: 'Developer', summary: 'Builds web interfaces.',
  skillGroups: [{ id: 's', name: 'Frontend', skills: ['Git', 'React.js', 'Figma'] }],
  experience: [{ id: 'work', role: 'Developer', company: 'Acme', location: 'Kochi', startDate: '2022', endDate: 'Present', bullets: [{ id: 'b', text: 'Built React interfaces.' }] }],
  projects: [{ id: 'project', name: 'Portal', subtitle: '', link: '', startDate: '', endDate: '', bullets: [{ id: 'pb', text: 'Built a reporting dashboard.' }] }],
};

describe('complete resume tailoring', () => {
  it('keeps full rewrites while restoring facts, omitted entries and unsupported skill categories', () => {
    const candidate = { ...structuredClone(master), name: 'Wrong name', title: 'Frontend Engineer',
      summary: 'React developer building user-focused interfaces.',
      skillGroups: [{ id: 'ai', name: 'Backend & DevOps', skills: ['React', 'Python'] }],
      experience: [{ ...master.experience[0], id: 'new-work', masterId: 'work', company: 'Invented', startDate: '2010', bullets: [{ id: 'new-b', text: 'Developed user-focused interfaces using React.' }] }],
      projects: [],
    };
    const result = reconcileTailoredResume(master, candidate, 'Seeking React frontend engineers.');
    expect(result.title).toBe('Frontend Engineer');
    expect(result.summary).toBe(candidate.summary);
    expect(result.name).toBe(master.name);
    expect(result.experience[0]).toMatchObject({ company: 'Acme', startDate: '2022', masterId: 'work', bullets: candidate.experience[0].bullets });
    expect(result.projects[0].name).toBe('Portal');
    expect(result.skillGroups[0]).toMatchObject({ name: 'Frontend', skills: ['React'] });
    expect(result.skillGroups.flatMap((group) => group.skills)).toEqual(['React', 'Git', 'Figma']);
    expect(result.id).not.toBe(master.id);
    expect(master.experience[0].company).toBe('Acme');
    const change = buildChangeAudit(master, result).changes.find((row) => row.location === 'Professional headline');
    expect(change.after).toBe('Frontend Engineer');
    expect(rejectAuditChange(result, master, change).title).toBe(master.title);
  });

  it('rejects invented employers or projects instead of presenting them as source evidence', () => {
    expect(() => reconcileTailoredResume(master, { ...master, experience: [{ ...master.experience[0], id: 'invented' }] }, 'React')).toThrow(/linked to the source/);
  });
});
