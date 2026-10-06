import { describe, expect, it } from 'vitest';
import { calculateSkillLabelColumnWidth, createResumePdfDocument, sanitizePdfText } from '../src/services/pdfService';

const longResume = {
  id: 'resume-1', name: 'Alex Morgan', title: 'UI/UX Designer | Product Design | Front-End UI',
  contact: { email: 'alex@example.com', phone: '+91 90000 00000', location: 'Kerala, India' },
  links: [{ id: 'link-1', label: 'linkedin.com/in/alex', url: 'https://linkedin.com/in/alex' }],
  summary: 'Product designer with 6+ years of experience delivering end-to-end UX and UI for SaaS applications. Expert in user flows, wireframing, prototyping, design systems, accessibility, and practical front-end collaboration.',
  skillGroups: [
    { id: 's1', name: 'UX / Product', skills: ['User research', 'User flows', 'Information architecture', 'Wireframing', 'Prototyping', 'Usability testing'] },
    { id: 's2', name: 'UI / Systems', skills: ['Figma', 'Components', 'UI kits', 'Visual design', 'Responsive design', 'WCAG accessibility'] },
  ],
  experience: Array.from({ length: 8 }, (_, index) => ({
    id: `exp-${index}`, role: index ? 'UI/UX Designer' : 'Senior UI/UX Designer', company: `Example Product Company ${index + 1}`,
    location: 'Kochi, Kerala', startDate: `Jan 20${18 + index}`, endDate: index ? `Dec 20${19 + index}` : 'Present',
    bullets: [
      { id: `b-${index}-1`, text: 'Designed end-to-end responsive product workflows spanning onboarding, dashboards, order processing, reporting, and role-based access.' },
      { id: `b-${index}-2`, text: 'Translated complex requirements into user flows, wireframes, validation states, polished Figma screens, prototypes, and reusable design-system components.' },
    ],
  })),
  projects: [{ id: 'p1', name: 'Blockspace Applicant Tracking System', subtitle: 'Candidate-management workflows and responsive recruiter tools', link: 'https://example.com/project', startDate: '', endDate: '', bullets: [{ id: 'pb1', text: 'Designed accessible recruitment and candidate-management workflows with clear information hierarchy.' }] }],
  education: [{ id: 'e1', qualification: 'Bachelor of Arts (BA) - Distance Education', institution: 'Example University', location: 'Kerala, India', startDate: '2018', endDate: '2021', details: 'Final-year project focused on digital product communication.' }],
  certifications: [{ id: 'c1', name: 'Accessibility for Designers', issuer: 'Example Institute', date: '2024' }], ambiguities: [],
};

describe('PDF resume export', () => {
  it('normalizes typography unsupported by standard PDF fonts', () => {
    expect(sanitizePdfText('Designer — Product “Systems”')).toBe('Designer - Product "Systems"');
  });

  it('expands the skill label column for long group names without consuming the whole row', () => {
    const groups = [
      { name: 'Design' },
      { name: 'Technical (design support)' },
      { name: 'Additional relevant skills' },
    ];
    const width = calculateSkillLabelColumnWidth(groups, (text) => text.length * 1.8, 176);

    expect(width).toBeGreaterThan(35);
    expect(width).toBeLessThanOrEqual(176 * 0.42);
  });

  it('creates a readable multi-page document without dropping final sections', async () => {
    const doc = await createResumePdfDocument(longResume);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(doc.getNumberOfPages()).toBeLessThan(8);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(5_000);
  }, 15000);
});
