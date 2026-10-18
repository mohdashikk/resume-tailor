import { describe, expect, it } from 'vitest';
import { parseResumeLocally } from '../src/services/localResumeParser';
import { prepareUploadedResume, reconcileParsedResume } from '../src/services/resumeParsingService';
import { blankResume } from '../src/services/resumeValidation';
import { extractProjectDescriptions } from '../src/services/projectRecoveryService';

const text = `Nisha Patel
Frontend Developer
nisha@example.com | +91 98765 43210 | Pune, India
Professional profile: Frontend developer building web applications.
Technical expertise: React, TypeScript, UI/UX, CI/CD, HTML/CSS
Employment history
Acme Ltd
Frontend Developer
Jan 2021 - Dec 2023
• Built accessible dashboards.
and improved page speed by 20%.
Senior Engineer | Beta Labs | Feb 2024 - Present
• Delivered the reporting application.
Academic qualifications
City University
B.Tech Computer Science
2017 - 2021
Certifications
Cloud Foundations
Projects
Customer Portal: Built a customer dashboard.
Work history
Developer | Early Ltd | 2020 - 2021
• Maintained internal tools.`;

describe('uploaded resume mapping into the existing template', () => {
  it('keeps standalone Backend and DevOps labels out of skill values', () => {
    const parsed = parseResumeLocally('Alex Morgan\nSkills\nBackend\nNode.js, SQL\nDevOps\nDocker, CI/CD');
    expect(parsed.skillGroups.map(({ name, skills }) => ({ name, skills }))).toEqual([
      { name: 'Backend', skills: ['Node.js', 'SQL'] },
      { name: 'DevOps', skills: ['Docker', 'CI/CD'] },
    ]);
  });

  it('removes invented skills and category labels while retaining source-backed aliases', () => {
    const parsed = reconcileParsedResume({ ...blankResume(), name: 'Alex Morgan', skillGroups: [
      { id: 's', name: 'Backend and DevOps', skills: ['React', 'Python', 'Docker'] },
    ] }, 'Alex Morgan\nSkills\nReact.js, Figma');
    expect(parsed.skillGroups[0]).toMatchObject({ name: 'Skills', skills: ['React'] });
    expect(parsed.ambiguities.join(' ')).toContain('Removed skills');
  });

  it('identifies all sections, inline headings and multiple work-entry layouts', () => {
    const parsed = parseResumeLocally(text);
    expect(parsed).toMatchObject({ name: 'Nisha Patel', title: 'Frontend Developer', contact: { email: 'nisha@example.com', phone: '+91 98765 43210', location: 'Pune, India' } });
    expect(parsed.summary).toBe('Frontend developer building web applications.');
    expect(parsed.skillGroups[0].skills).toEqual(['React', 'TypeScript', 'UI/UX', 'CI/CD', 'HTML/CSS']);
    expect(parsed.experience).toHaveLength(3);
    expect(parsed.experience[0]).toMatchObject({ role: 'Frontend Developer', company: 'Acme Ltd', startDate: 'Jan 2021', endDate: 'Dec 2023' });
    expect(parsed.experience[0].bullets[0].text).toBe('Built accessible dashboards. and improved page speed by 20%.');
    expect(parsed.experience[1]).toMatchObject({ role: 'Senior Engineer', company: 'Beta Labs' });
    expect(parsed.education[0]).toMatchObject({ institution: 'City University', qualification: 'B.Tech Computer Science', startDate: '2017', endDate: '2021' });
    expect(parsed.certifications[0].name).toBe('Cloud Foundations');
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0].bullets[0].text).not.toContain('Early Ltd');
  });

  it('recovers clearly identified sections omitted by AI without importing previous resume data', () => {
    const parsed = reconcileParsedResume({ ...blankResume(), name: 'Nisha Patel' }, text);
    expect(parsed.experience).toHaveLength(3);
    expect(parsed.education).toHaveLength(1);
    expect(parsed.skillGroups[0].skills).toContain('CI/CD');
    expect(parsed.contact.email).toBe('nisha@example.com');
    expect(parsed.ambiguities.some((warning) => warning.includes('Recovered experience'))).toBe(true);
  });

  it('rejects malformed AI entries before they can become blank success entries', () => {
    expect(() => reconcileParsedResume({ ...blankResume(), experience: ['Engineer at Acme'] }, text)).toThrow();
  });

  it('preserves language content as its own section, including when AI omits it', () => {
    const raw = 'Alex Morgan\nFrontend Engineer\nLanguages\nEnglish, Malayalam\nCertifications\nWeb Accessibility';
    const result = reconcileParsedResume({ ...blankResume(), name: 'Alex Morgan' }, raw);
    expect(result.languages).toEqual(['English', 'Malayalam']);
    expect(result.ambiguities.join(' ')).not.toContain('Additional source content');
  });

  it('retains bare portfolio domains without treating an email domain as a website', () => {
    const result = parseResumeLocally('Alex Morgan\nFrontend Engineer\nalex@gmail.com | Kochi, India | linkedin.com/in/alex | alexmorgan.dev\nSummary\nBuilds web applications.');
    expect(result.links.map((link) => link.url)).toEqual(['https://linkedin.com/in/alex', 'https://alexmorgan.dev']);
    expect(result.contact.location).toBe('Kochi, India');
  });

  it('separates comma-delimited role and employer and preserves location after dates', () => {
    const result = parseResumeLocally('Alex Morgan\nFrontend Engineer\nExperience\nFront-End Developer, Acme Ltd Jul 2023 - Present | Kochi, Kerala\n- Built accessible web applications.');
    expect(result.experience[0]).toMatchObject({ role: 'Front-End Developer', company: 'Acme Ltd', startDate: 'Jul 2023', endDate: 'Present', location: 'Kochi, Kerala' });
  });

  it('does not mistake education dates for a phone or a location for a title', () => {
    const parsed = parseResumeLocally('Nisha Patel\nPune, India\nEducation\nBSc Computer Science\n2017 - 2021\nCity University');
    expect(parsed.title).toBe('');
    expect(parsed.contact.phone).toBe('');
    expect(parsed.contact.location).toBe('Pune, India');
  });

  it('keeps separate documents even if AI repeats all IDs', () => {
    const first = prepareUploadedResume(parseResumeLocally(text));
    const second = prepareUploadedResume({ ...first, name: 'Ravi Shah', skillGroups: [], experience: [], education: [], projects: [], certifications: [], summary: '', contact: { email: '', phone: '', location: '' } });
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe('Ravi Shah');
    expect(second.experience).toEqual([]);
    expect(second.skillGroups).toEqual([]);
    expect(first.experience).toHaveLength(3);
  });

  it('separates standalone project titles and stops at any recognized next section', () => {
    expect(extractProjectDescriptions('Projects\nCustomer Portal\nBuilt a dashboard.\nReporting Tool\nCreated export reports.\nTechnical skills\nJavaScript')).toEqual([
      { name: 'Customer Portal', description: 'Built a dashboard.' }, { name: 'Reporting Tool', description: 'Created export reports.' },
    ]);
  });
});
