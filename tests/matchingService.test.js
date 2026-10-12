import { describe, expect, it } from 'vitest';
import { analyzeResumeReadiness, calculateAtsScore } from '../src/services/matchingService';
import { blankResume } from '../src/services/resumeValidation';

const completeResume = () => ({
  ...blankResume(),
  name: 'Asha Rao', title: 'Product Designer',
  contact: { email: 'asha@example.com', phone: '+91 99999 99999', location: 'Bengaluru' },
  summary: 'Product designer with six years of experience building accessible SaaS products through research and iterative design.',
  skillGroups: [{ id: 'skills', name: 'Design', skills: ['Figma', 'Research', 'Prototyping', 'Accessibility', 'Wireframing', 'Testing', 'Design systems', 'Strategy'] }],
  experience: [{ id: 'exp', role: 'Product Designer', company: 'Acme', startDate: '2020', endDate: 'Present', bullets: [
    { id: '1', text: 'Improved conversion by 24% through usability testing.' },
    { id: '2', text: 'Reduced task completion time by 18%.' },
    { id: '3', text: 'Built a reusable design system.' },
    { id: '4', text: 'Led user research for SaaS workflows.' },
  ] }],
  education: [{ id: 'edu', qualification: 'B.Des', institution: 'Design School' }],
  projects: [{ id: 'project', name: 'Design system', bullets: [] }],
});

describe('ATS scoring', () => {
  it('scores a complete resume strongly before a JD is supplied', () => {
    const result = analyzeResumeReadiness(completeResume());
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.label).toBe('Strong');
  });

  it('adds JD keyword coverage to the combined score', () => {
    const result = calculateAtsScore(completeResume(), 'Figma Figma research research accessibility accessibility prototyping prototyping');
    expect(result.hasJobKeywords).toBe(true);
    expect(result.match.coverage).toBe(100);
    expect(result.score).toBeGreaterThanOrEqual(result.readiness.score);
  });
});
