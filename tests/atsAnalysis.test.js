import { describe, expect, it } from 'vitest';
import { analysisKey, buildAnalysis, cacheAnalysis, canonicalTerm, containsTerm, normalizeAliases, readCachedAnalysis, validateAnalysis } from '../src/services/atsAnalysis';

export const resume = 'Frontend developer with 3 years of experience. Skills: React, JavaScript, TypeScript, HTML, CSS, Git, REST APIs. Built React interfaces and improved page performance by 30%.';
export const jd = 'Frontend Developer with 3 years of experience in React, JavaScript, TypeScript, HTML, CSS, Git, and REST APIs. Build accessible responsive interfaces, improve page performance, and write unit tests with Jest. Redux and CI/CD are preferred.';
export const extraction = { requirements: [
  ...['React', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'Git', 'REST APIs', '3 years of experience'].map((term) => ({ term, source: term, priority: 'required', status: 'matched', evidence: [resume] })),
  { term: 'page performance', source: 'improve page performance', priority: 'required', status: 'matched', evidence: ['improved page performance by 30%'] },
  ...['accessible interfaces', 'responsive interfaces', 'Jest', 'Redux', 'CI/CD'].map((term) => ({ term, source: term.includes('interfaces') ? 'Build accessible responsive interfaces' : term, priority: ['Redux', 'CI/CD'].includes(term) ? 'preferred' : 'required', status: 'missing', evidence: [] })),
] };
const storage = () => { const entries = new Map(); return { getItem: (k) => entries.get(k) || null, setItem: (k, v) => entries.set(k, v) }; };

describe('validated ATS rubric', () => {
  it('scores the regression scenario deterministically with a complete denominator', () => {
    const report = buildAnalysis(extraction, resume, jd);
    expect(report).toEqual(buildAnalysis(extraction, resume, jd));
    expect(report.score).toBe(69); // 18 / 26 weighted points
    expect(report.match.coverage).toBe(64); // 9 / 14 requirements
    expect(report.match.matched).toContain('javascript');
    expect(report.match.matched).toContain('rest api');
    expect(report.match.missing).toEqual(expect.arrayContaining(['jest', 'redux', 'ci/cd', 'accessible interfaces', 'responsive interfaces']));
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
    expect(report.match.uncertain).toEqual(['accessible interfaces', 'jest']);
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
