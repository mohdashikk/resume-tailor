import { describe, expect, it } from 'vitest';
import { extractProjectDescriptions, extractProjectSectionTitle, normalizeProjectPresentation, projectDisplayName, projectDisplaySubtitle, restoreProjectDescriptions } from '../src/services/projectRecoveryService';
import { parseResumeLocally } from '../src/services/localResumeParser';
import { blankResume } from '../src/services/resumeValidation';

const sourceText = `
MUHAMMED ASHIK A
UI/UX Designer
SELECTED FREELANCE PROJECTS
Blockspace Applicant Tracking System - Designed the UI/UX for recruitment and candidate-management workflows.
Enabled2Parent - Designed a responsive website for a UK charity supporting parents, with clear and accessible content structure.
Insasoft and Jasha Solutions - Designed responsive business websites with clear page structure, polished interface layouts, and mobile-friendly experiences.
EDUCATION
Bachelor of Arts
`;

describe('project description recovery', () => {
  it('extracts complete project names and descriptions after separators', () => {
    const projects = extractProjectDescriptions(sourceText);
    expect(projects).toHaveLength(3);
    expect(projects[0].name).toBe('Blockspace Applicant Tracking System');
    expect(projects[0].description).toContain('recruitment and candidate-management workflows');
    expect(projects[2].description).toContain('mobile-friendly experiences');
    expect(extractProjectSectionTitle(sourceText)).toBe('Selected Freelance Projects');
  });

  it('repairs an AI result that kept only the short project name', () => {
    const resume = { ...blankResume(), projects: [{ id: 'project-1', masterId: 'project-1', name: 'Blockspace', subtitle: '', link: '', startDate: '', endDate: '', bullets: [] }] };
    const restored = restoreProjectDescriptions(resume, sourceText, () => 'recovered-bullet');
    expect(restored.projects[0].name).toBe('Blockspace Applicant Tracking System');
    expect(restored.projects[0].bullets).toEqual([{ id: 'recovered-bullet', text: 'Designed the UI/UX for recruitment and candidate-management workflows.' }]);
  });

  it('preserves project descriptions in the non-AI fallback parser', () => {
    const parsed = parseResumeLocally(sourceText);
    expect(parsed.projects).toHaveLength(3);
    expect(parsed.projects[1].name).toBe('Enabled2Parent');
    expect(parsed.projects[1].bullets[0].text).toContain('UK charity supporting parents');
  });

  it('shows a repeated project description only as a bullet', () => {
    const project = {
      id: 'project-1', masterId: 'project-1', name: 'Blockspace',
      subtitle: 'UI/UX for an applicant tracking system and candidate-management workflows.',
      link: '', startDate: '', endDate: '',
      bullets: [{ id: 'bullet-1', text: 'UI/UX for an applicant tracking system and candidate-management workflows.' }],
    };
    expect(projectDisplaySubtitle(project)).toBe('');
    expect(normalizeProjectPresentation({ projects: [project] }).projects[0].subtitle).toBe('');
  });

  it('removes a repeated description that was incorrectly stored in the project name', () => {
    const project = {
      id: 'project-1', masterId: 'project-1',
      name: 'Blockspace: UI/UX for an applicant tracking system and candidate-management workflows.',
      subtitle: '', link: '', startDate: '', endDate: '',
      bullets: [{ id: 'bullet-1', text: 'UI/UX for an applicant tracking system and candidate-management workflows.' }],
    };
    expect(projectDisplayName(project)).toBe('Blockspace');
    expect(normalizeProjectPresentation({ projects: [project] }).projects[0].name).toBe('Blockspace');
  });
});
