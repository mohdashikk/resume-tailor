import { describe, expect, it } from 'vitest';
import { parseResumeLocally } from '../src/services/localResumeParser';

describe('conservative fallback parsing', () => {
  it('does not turn a flattened document into an oversized name', () => {
    const flattened = `MUHAMMED ASHIK A mail4ashh@gmail.com +91 8089911973 PROFESSIONAL SUMMARY UI/UX Designer with 6+ years of experience creating responsive products. CORE SKILLS Figma, user flows, design systems, React PROFESSIONAL EXPERIENCE Example Company UI/UX Designer Jul 2023 - Present ${'Designed accessible interfaces. '.repeat(30)}`;
    const result = parseResumeLocally(flattened);
    expect(result.name.length).toBeLessThanOrEqual(120);
    expect(result.contact.email).toBe('mail4ashh@gmail.com');
    expect(result.summary).toContain('UI/UX Designer');
  });

  it('preserves a selected freelance projects heading', () => {
    const result = parseResumeLocally('Asha Rao\nDesigner\nSELECTED FREELANCE PROJECTS\nOrbit: Designed a responsive dashboard.\nEDUCATION\nBA');
    expect(result.projectSectionTitle).toBe('Selected Freelance Projects');
    expect(result.projects[0].name).toBe('Orbit');
    expect(result.projects[0].bullets[0].text).toBe('Designed a responsive dashboard.');
  });
});
