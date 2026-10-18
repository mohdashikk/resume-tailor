import { describe, expect, it } from 'vitest';
import { analysisKey, buildAnalysis, cacheAnalysis, canonicalTerm, containsTerm, normalizeAliases, readCachedAnalysis, validateAnalysis, rescoreAnalysis } from '../src/services/atsAnalysis';

export const resume = 'Frontend developer with 3 years of experience. Skills: React, JavaScript, TypeScript, HTML, CSS, Git, REST APIs. Built React interfaces and improved page performance by 30%.';
export const jd = 'Frontend Developer with 3 years of experience in React, JavaScript, TypeScript, HTML, CSS, Git, and REST APIs. Build accessible responsive interfaces, improve page performance, and write unit tests with Jest. Redux and CI/CD are preferred.';
export const extraction = { requirements: [
  ...['React', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'Git', 'REST APIs', '3 years of experience'].map((term) => ({ term, source: term, priority: 'required', status: 'matched', evidence: [resume] })),
  { term: 'page performance', source: 'improve page performance', priority: 'required', status: 'matched', evidence: ['improved page performance by 30%'] },
  ...['accessible interfaces', 'responsive interfaces', 'Jest', 'Redux', 'CI/CD'].map((term) => ({ term, source: term.includes('interfaces') ? 'Build accessible responsive interfaces' : term, priority: ['Redux', 'CI/CD'].includes(term) ? 'preferred' : 'required', status: 'missing', evidence: [] })),
] };
const storage = () => { const entries = new Map(); return { getItem: (k) => entries.get(k) || null, setItem: (k, v) => entries.set(k, v) }; };

describe('validated ATS rubric', () => {
  it('excludes posting headings from selectable requirements and scoring', () => {
    const description = 'Essential responsibilities:\nReact is required for this frontend role.';
    const report = buildAnalysis({ requirements: [{ term: 'Essential responsibilities:', source: 'Essential responsibilities:', priority: 'required', status: 'uncertain', evidence: [] }, { term: 'React', source: 'React', priority: 'required', status: 'matched', evidence: ['Uses React.'] }] }, { summary: 'Uses React.' }, description);
    expect(report.match.keywords).toEqual(['react']);
    expect(report.score).toBe(100);
  });
  it('credits explicit skills and equivalent wording even when AI labels them missing', () => {
    const terms = ['accessibility', 'responsive design', 'component architecture', 'cross-browser compatibility', 'ux', 'collaboration', 'WebRTC'];
    const description = 'Requirements: ' + terms.join(', ');
    const candidate = { summary: 'Designed accessible UX. Collaborated with developers.', skillGroups: [{ skills: ['responsive web design', 'component-based architectures', 'cross browser compatible'] }] };
    const report = buildAnalysis({ requirements: terms.map(term => ({ term, source: term, priority: 'required', status: 'missing', evidence: [] })) }, candidate, description);
    expect(report.match.matched).toHaveLength(6);
    expect(report.match.missing).toEqual(['webrtc']);
    expect(report.score).toBe(86);
  });
  it('compares documents using the original requirements and does not count negated evidence', () => {
    const description = 'Requirements: React and TypeScript are required for our frontend product engineering team.';
    const original = { summary: 'Uses React.' };
    const report = buildAnalysis({ requirements: [{ term: 'React', source: 'React', priority: 'required', status: 'matched', evidence: ['Uses React.'] }, { term: 'TypeScript', source: 'TypeScript', priority: 'required', status: 'missing', evidence: [] }] }, original, description);
    const improved = rescoreAnalysis(report, { summary: 'Uses React and TypeScript.' }, description);
    expect(improved.score).toBe(100);
    expect(improved.rubric.totalWeight).toBe(report.rubric.totalWeight);
    expect(rescoreAnalysis(report, { summary: 'No experience. Never Uses React.' }, description).score).toBe(0);
  });
  it('scores the regression scenario deterministically with a complete denominator', () => {
    const report = buildAnalysis(extraction, resume, jd);
    expect(report).toEqual(buildAnalysis(extraction, resume, jd));
    expect(report.score).toBe(71); // 27 / 38 weighted points
    expect(report.match.coverage).toBe(62); // 8 / 13 skill keywords; tenure stays in the rubric
    expect(report.match.matched).toContain('javascript');
    expect(report.match.matched).toContain('rest api');
    expect(report.match.missing).toEqual(expect.arrayContaining(['jest', 'redux', 'ci/cd', 'accessibility', 'responsive design']));
    expect(report.match.keywords).not.toContain('experience');
  });
  it('normalizes aliases without conflating distinct technologies', () => {
    expect(canonicalTerm(' React.JS ')).toBe('react');
    expect(containsTerm(normalizeAliases('REACT.JS, JS, HTML5, REST APIs'), 'javascript')).toBe(true);
    expect(containsTerm('javascript', 'java')).toBe(false);
    expect(canonicalTerm('React Native')).not.toBe(canonicalTerm('React'));
  });
  it('rejects empty, malformed, generic, incomplete and fabricated extraction', () => {
    for (const raw of [{ requirements: [] }, {}, { requirements: [{ term: 'React' }] }, { requirements: [{ ...extraction.requirements[0], term: 'experience' }] }]) {
      expect(() => buildAnalysis(raw, resume, jd)).toThrow();
    }
    expect(() => buildAnalysis({ requirements: extraction.requirements.filter((r) => r.term !== 'Jest') }, resume, jd)).toThrow(/omitted jest/);
    expect(() => buildAnalysis({ requirements: extraction.requirements.map((r) => ({ ...r, source: 'made up posting quote' })) }, resume, jd)).toThrow();
  });
  it('does not accept unrelated or invented evidence as proof', () => {
    const raw = structuredClone(extraction);
    for (const row of raw.requirements.filter((r) => ['Jest', 'accessible interfaces'].includes(r.term))) {
      row.status = 'matched'; row.evidence = ['Built React interfaces'];
    }
    const report = buildAnalysis(raw, resume, jd);
    expect(report.match.uncertain).toEqual(['jest']);
    expect(report.match.missing).toContain('accessibility');
    expect(report.requirements.find(row => row.term === 'accessible interfaces').status).toBe('uncertain');
    expect(report.score).toBeLessThan(100);
  });
  it('validates cached data and invalidates content and version changes', () => {
    const store = storage(); const report = buildAnalysis(extraction, resume, jd);
    cacheAnalysis(report, resume, jd, store);
    expect(readCachedAnalysis(resume.toUpperCase(), '  ' + jd, store)).toEqual(report);
    expect(readCachedAnalysis(resume + ' Redux', jd, store)).toBeNull();
    expect(readCachedAnalysis(resume, jd + ' Python', store)).toBeNull();
    expect(() => validateAnalysis({ ...report, version: 'old' }, resume, jd)).toThrow();
    expect(analysisKey({ id: 'one', summary: resume }, jd)).toBe(analysisKey({ id: 'two', summary: resume }, jd));
  });
});
