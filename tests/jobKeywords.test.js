import { expect, it } from 'vitest';
import { cleanKeywordTerms } from '../src/services/jobKeywords.js';
import { buildAnalysis } from '../src/services/atsAnalysis.js';

it('removes screenshot heading labels and trims the actual AI-tool keyword', () => {
  for (const heading of ['job requirements', 'must-have skills & experience:', 'role summary', 'Essential responsibilities:']) expect(cleanKeywordTerms(heading)).toEqual([]);
  expect(cleanKeywordTerms('use of AI-assisted engineering tools.')).toEqual(['ai-assisted engineering tools']);
  expect(cleanKeywordTerms('AI assist')).toEqual(['ai-assisted engineering tools']);
  const terms = cleanKeywordTerms('Ability to write clean, maintainable code and automated tests.');
  expect(terms).toContain('automated testing');
  expect(terms.some(term => term.startsWith('ability to'))).toBe(false);
});
it('keeps qualifications in the rubric but shows only concise JD keyword chips', () => {
  const jd = 'Role summary:\nUse of AI-assisted engineering tools.\n4+ years in React.\nWrite unit and component tests, support regression testing, and resolve defects.';
  const rows = [
    { term: 'role summary', source: 'Role summary:', priority: 'required', status: 'uncertain', evidence: [] },
    { term: 'use of AI-assisted engineering tools.', source: 'Use of AI-assisted engineering tools.', priority: 'preferred', status: 'missing', evidence: [] },
    { term: '4+ years in React', source: '4+ years in React.', priority: 'required', status: 'uncertain', evidence: [] },
    { term: 'Write unit and component tests, support regression testing, and resolve defects.', source: 'Write unit and component tests, support regression testing, and resolve defects.', priority: 'required', status: 'missing', evidence: [] },
  ];
  const report = buildAnalysis({ requirements: rows }, { summary: 'Builds React interfaces.' }, jd);
  expect(report.match.keywords).toEqual(expect.arrayContaining(['react','unit testing','component testing','ai-assisted engineering tools']));
  expect(report.match.keywords.some(term => /years|^use of|^write|summary/.test(term))).toBe(false);
  expect(report.requirements.some(row => row.term.includes('years'))).toBe(true);
  expect(report.match.matched).toContain('react');
  expect(report.score).toBe(0); // Keyword presence does not prove four years of React.
});
