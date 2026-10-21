import { describe, expect, it } from 'vitest';
import { parseResumeLocally } from '../src/services/localResumeParser';

describe('conservative fallback parsing', () => {
  it('retains prose mistaken for a second employment location without exceeding metadata limits', () => {
    const misplaced = 'The developer collaborated with product teams on accessible interfaces. '.repeat(12) + 'Preserve this final sentence.';
    const result = parseResumeLocally(`Alex Morgan\nFrontend Engineer\nExperience\nEngineer | First Ltd | Kochi Jan 2020 - Dec 2021\n- Built web applications.\nDesigner\nSecond Ltd\n${misplaced}\nJan 2022 - Present\n- Built design systems.`);
    expect(result.experience).toHaveLength(2);
    expect(result.experience[1].location).toBe('');
    expect(result.experience[1].role).toBe('Designer');
    expect(result.experience[1].company).toBe('Second Ltd');
    expect(result.ambiguities.join(' ')).toContain(misplaced);
    expect(result.ambiguities.join(' ')).toContain('could not be identified as location');
  });

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

  it('keeps OCR bullet markers and a wrapped "projects" word inside Experience', () => {
    const raw = `Alex Morgan
UI Designer
EXPERIENCE
UI Designer
Alpha Studio — Kochi Jul 2023 — Present
» Designed customer interfaces and reusable components
for mobile applications
«+ Conducted usability testing with stakeholders
UI Designer
Beta Studio — Kochi Dec 2020 Sep 2022
+ Built assets for multiple client
projects
* Produced design system documentation
+. .Ensured visual consistency across products
UI Designer Jun 2019 — Feb 2020
Gamma Studio — Kochi, Kerala
«= Worked closely with developers on responsive designs
TECHNICAL SKILLS
Figma, Adobe XD`;
    const parsed = parseResumeLocally(raw);
    expect(parsed.experience.map((entry) => [entry.company, entry.bullets.length])).toEqual([
      ['Alpha Studio', 2], ['Beta Studio', 3], ['Gamma Studio', 1],
    ]);
    expect(parsed.experience[1].bullets[0].text).toContain('multiple client projects');
    expect(parsed.experience[2]).toMatchObject({ role: 'UI Designer', startDate: 'Jun 2019', endDate: 'Feb 2020' });
    expect(parsed.projects).toEqual([]);
  });

  it('keeps a garbled OCR tail out of an otherwise clear job location', () => {
    const parsed = parseResumeLocally('Alex Morgan\nExperience\nUI Designer Jun 2019 - Feb 2020\nHashwide Pvt Ltd — Kochi, Kerala un -re\n+ Designed UI layouts.');
    expect(parsed.experience[0].location).toBe('Kochi, Kerala');
    expect(parsed.experience[0].bullets).toHaveLength(1);
    expect(parsed.ambiguities.join(' ')).toContain('un -re');
  });

  it('keeps a role and dated employer together when OCR splits the heading across two lines', () => {
    const parsed = parseResumeLocally(`Alex Morgan
EXPERIENCE
UI Designer 2019 Feb 2020
Hashwide Pvt Ltd — Kochi, Kerala Jun 2019 - Fe
« Designed website layouts and branding assets
« Worked closely with developers on responsive designs
EDUCATION
Bachelor of Arts — Distance Education Expected: July 2026
Reum resume Page 1 of 2
Final Year Student
Diploma in Multimedia Arts — CONTINUED 2018 - 2019
Image Creative Education, Kerala
Reum resume Page 2 of 2`);
    expect(parsed.experience).toHaveLength(1);
    expect(parsed.experience[0]).toMatchObject({ role: 'UI Designer', company: 'Hashwide Pvt Ltd', startDate: 'Jun 2019', endDate: 'Feb 2020' });
    expect(parsed.experience[0].bullets).toHaveLength(2);
    expect(parsed.education).toHaveLength(2);
    expect(parsed.education[0].details).toBe('Final Year Student');
    expect(parsed.education[1].qualification).not.toContain('CONTINUED');
    expect(JSON.stringify(parsed.education)).not.toContain('Reum resume Page');
  });

  it('recovers unmarked PDF experience paragraphs as separate bullets across all jobs', () => {
    const parsed = parseResumeLocally(`Alex Morgan
UI/UX Designer
PROFESSIONAL SUMMARY
Designer with experience across multiple product teams.
EXPERIENCE
UI/UX Designer - EGlobe IT Solutions Jul 2023 - Present
Trivandrum, Kerala
Led end-to-end UX design for scalable SaaS applications from discovery and user research to wireframes and
high-fidelity Figma prototypes
Translated business requirements into intuitive interface designs
Built and maintained a shared design system
Conducted usability testing with customers
Defined user flows and information architecture
Collaborated with developers and product managers
Designed role-based UI experiences
UI/UX Designer - DataGuard NXT Sep 2022 - May 2023
Kochi, Kerala
Designed responsive web application interfaces
Created wireframes and interactive prototypes
Developed a component-based design system
Improved UI consistency across modules
Worked with developers on implementation
Delivered accessible cross-device designs
UI/UX Designer - Code9 Tech Dec 2020 - Sep 2022
Kochi, Kerala
Owned the design lifecycle for client projects
Created layouts and prototypes in Figma
Designed responsive web interfaces
Produced visual branding assets and UI kits
Applied user-centered design principles
UI Designer - Hashwide Pvt Ltd Jun 2019 - Feb 2020
Kochi, Kerala
Designed website layouts and branding assets
Worked with developers on responsive designs
EDUCATION
Bachelor Of Arts (BA) July 2026
Distance Education
Reum resume Page 1 of 2
EDUCATION - CONTINUED
Diploma In Multimedia Arts - Image Creative Education, Kerala 2018 - 2019
Kerala
Reum resume Page 2 of 2`);
    expect(parsed.experience.map((entry) => [entry.company, entry.bullets.length])).toEqual([
      ['EGlobe IT Solutions', 7], ['DataGuard NXT', 6], ['Code9 Tech', 5], ['Hashwide Pvt Ltd', 2],
    ]);
    expect(parsed.experience[0].bullets[0].text).toContain('high-fidelity Figma prototypes');
    expect(parsed.education.map((entry) => [entry.qualification, entry.institution, entry.endDate])).toEqual([
      ['Bachelor Of Arts (BA) — Distance Education', '', 'July 2026'],
      ['Diploma In Multimedia Arts', 'Image Creative Education', '2019'],
    ]);
  });

  it('separates skill labels when OCR loses commas and line breaks', () => {
    const raw = `Alex Morgan
TECHNICAL SKILLS
Design : Figma Adobe XD, Wireframing Prototyping Design, Systems User Research Usability Testing Responsive
Design Accessibility (WCAG) Information Architecture Interaction Design Visual Design
Technical (Design Support): HTML CSS / Tailwind / Sass JavaScript React.Js Git & GitHub
Tools & Workflow: Agile / Scrum Design Handoff (Zeplin / Figma Dev Mode) Component-Based Architecture
Performance Optimization Cross-Browser Compatibility Debugging & Problem Solving`;
    const parsed = parseResumeLocally(raw);
    expect(parsed.skillGroups.map((group) => group.skills.length)).toEqual([12, 8, 7]);
    expect(parsed.skillGroups[0].skills).toContain('Design Systems');
    expect(parsed.skillGroups[1].skills).toEqual(['HTML', 'CSS', 'Tailwind', 'Sass', 'JavaScript', 'React.js', 'Git', 'GitHub']);
    expect(parsed.skillGroups[2].skills).toContain('Design Handoff (Zeplin / Figma Dev Mode)');

    const unfamiliar = parseResumeLocally('Alex Morgan\nSkills\nFigma, ProprietaryTool, React');
    expect(unfamiliar.skillGroups[0].skills).toEqual(['Figma', 'ProprietaryTool', 'React']);
  });
});
