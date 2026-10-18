import { describe, expect, it } from 'vitest';
import { detectDeveloperProfile, keywordCategory, keywordCoverageTarget } from '../src/services/profileKeywords.js';
import { includeSupportedJobKeywords } from '../src/services/targetedTailoringService.js';
import { blankResume } from '../src/services/resumeValidation.js';

describe('profile keyword targeting', () => {
  it('separates frontend, backend and all other skills', () => {
    expect(keywordCategory('React.js')).toBe('frontend');
    expect(keywordCategory('CSS3')).toBe('frontend');
    expect(keywordCategory('Node.js')).toBe('backend');
    expect(keywordCategory('PostgreSQL')).toBe('backend');
    expect(keywordCategory('Docker')).toBe('other');
    expect(keywordCategory('Communication')).toBe('other');
    expect(detectDeveloperProfile({ title: 'Frontend Developer' }).id).toBe('frontend');
    expect(detectDeveloperProfile({ title: 'Backend Engineer' }).id).toBe('backend');
    expect(detectDeveloperProfile({ title: 'Full Stack Engineer' }).id).toBe('all');
    expect(detectDeveloperProfile({ title: 'Product Designer' }).developer).toBe(false);
  });
  it('shows the 60 percent coverage target independently of weighted ATS', () => {
    expect(keywordCoverageTarget({ keywords: Array(10).fill('term'), matched: ['React','CSS','HTML'] })).toEqual({ total: 10, matched: 3, target: 6, coverage: 30 });
  });
  it('adds supported experience keywords without inventing missing technologies', () => {
    const resume = { ...blankResume(), title: 'Frontend Developer', summary: 'Developed React interfaces with JavaScript and CSS.', skillGroups: [{ id: 's', name: 'Skills', skills: ['React.js'] }] };
    const analysis = { requirements: ['React', 'JavaScript', 'CSS', 'Docker', 'Python'].map(term => ({ term, status: ['Docker','Python'].includes(term) ? 'missing' : 'matched', priority: 'required' })) };
    const result = includeSupportedJobKeywords(resume, analysis);
    const skills = result.skillGroups.flatMap(group => group.skills);
    expect(skills).toEqual(expect.arrayContaining(['React.js','JavaScript','CSS']));
    expect(skills).not.toContain('Docker'); expect(skills).not.toContain('Python');
    expect(resume.skillGroups[0].skills).toEqual(['React.js']);
  });
});
