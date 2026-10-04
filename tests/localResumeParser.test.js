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

  it('structures OCR-style role, company, dates, and wrapped experience bullets', () => {
    const text = `MUHAMMED ASHIK A
UI/UX Designer
Kerala, India | +91 8089911973 | mail4ashh@gmail.com | LinkedIn: linkedin.com/in/ashikar/
SUMMARY
Creative UI/UX Designer with 5+ years of experience crafting intuitive digital experiences.
EXPERIENCE
UI/UX Designer
EGlobe IT Solutions ~ Trivandrum, Kerala Jul 2023 Present
+ Led end-to-end UX design for scalable SaaS web applications
to wireframes and high-fidelity Figma prototypes
+ Built and maintained a shared design system
UI/UX Designer
DataGuard NXT - Kochi, Kerala Sep 2022 - May 2023
« Designed modern responsive web application interfaces
with a strong focus on clarity
TECHNICAL SKILLS
Design: Figma, Adobe XD, Wireframing, Prototyping
EDUCATION
Bachelor of Arts (BA) — Distance Education Expected: July 2026
Final Year Student
Diploma in Multimedia Arts 2018 — 2019
Image Creative Education, Kerala`;
    const result = parseResumeLocally(text);

    expect(result.contact.location).toBe('Kerala, India');
    expect(result.experience).toHaveLength(2);
    expect(result.experience[0]).toMatchObject({
      role: 'UI/UX Designer', company: 'EGlobe IT Solutions', location: 'Trivandrum, Kerala',
      startDate: 'Jul 2023', endDate: 'Present',
    });
    expect(result.experience[0].bullets[0].text).toContain('high-fidelity Figma prototypes');
    expect(result.experience[1]).toMatchObject({ company: 'DataGuard NXT', startDate: 'Sep 2022', endDate: 'May 2023' });
    expect(result.experience[1].bullets[0].text).toContain('strong focus on clarity');
    expect(result.skillGroups[0].skills).toContain('Figma');
    expect(result.education).toHaveLength(2);
    expect(result.education[0]).toMatchObject({ qualification: 'Bachelor of Arts (BA) — Distance Education', endDate: 'July 2026', details: 'Final Year Student' });
    expect(result.education[1]).toMatchObject({ qualification: 'Diploma in Multimedia Arts', institution: 'Image Creative Education', location: 'Kerala', startDate: '2018', endDate: '2019' });
  });
});
