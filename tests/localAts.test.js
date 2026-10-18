import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeAtsLocally } from '../src/services/localAtsService.js';
import { parseResumeHybrid } from '../src/services/hybridResumeParser.js';
import { blankResume } from '../src/services/resumeValidation.js';
import { analyzeAtsWithAI } from '../src/services/aiService.js';

const resume = { ...blankResume(), name: 'Asha Rao', skillGroups: [{ id: 'skills', name: 'Skills', skills: ['React.js', 'JavaScript', 'React Native'] }] };
afterEach(() => vi.restoreAllMocks());

describe('local job matching', () => {
  it('extracts distinct keywords from the screenshot-style posting without scoring sentence fragments', () => {
    const jd = `Responsibilities:
· Develop and maintain real-time web applications using React (or comparable modern framework)
· Build accessible, maintainable component architectures and consistent UX patterns
· Collaborate with backend/WebRTC teams on APIs, events, and session lifecycle
· Implement real-time features: video/audio rendering, screen share, chat, annotations, and remote interaction controls
Requirements:
· Strong React and JavaScript skills
· Experience with Canvas/WebGL for overlays/annotations
· Knowledge of observability tooling (client metrics, logging pipelines)`;
    const candidate = { ...resume, summary: 'Developed accessible React components with JavaScript.', skillGroups: [{ id: 's', name: 'Skills', skills: ['React.js', 'JavaScript', 'HTML', 'CSS'] }] };
    const report = analyzeAtsLocally(candidate, jd);
    expect(report.match.matched).toEqual(expect.arrayContaining(['react', 'javascript']));
    expect(report.score).toBeGreaterThan(0);
    expect(report.match.missing).toEqual(expect.arrayContaining(['webrtc', 'canvas', 'webgl', 'observability']));
    expect(report.match.uncertain).not.toContain('· develop');
    expect(report.requirements.filter(row => row.term === 'react')).toHaveLength(1);
    expect(report.requirements.some(row => row.term.startsWith('·'))).toBe(false);
  });
  it('keeps the same requirements and denominator after adding user evidence', () => {
    const jd = 'Requirements:\nReact and TypeScript\nPreferred:\nStorybook\nRequired qualifications:\nA professional engineering license is required for this role.';
    const before = analyzeAtsLocally(resume, jd);
    const after = analyzeAtsLocally({ ...resume, skillGroups: [...resume.skillGroups, { id: 'confirmed', name: 'Confirmed', skills: ['TypeScript', 'Storybook', 'A professional engineering license'] }] }, jd);
    expect(after.requirements.map(row => [row.term, row.priority])).toEqual(before.requirements.map(row => [row.term, row.priority]));
    expect(after.rubric.totalWeight).toBe(before.rubric.totalWeight);
    expect(after.score).toBeGreaterThan(before.score);
  });
  it('can reach the 80 percent target with supported skills without rewarding repetition', () => {
    const jd = 'Requirements:\nReact, JavaScript, HTML, CSS, TypeScript\nPreferred:\nDocker\nWe offer a collaborative environment.';
    const candidate = { ...resume, skillGroups: [{ id: 'all', name: 'Skills', skills: ['React', 'JavaScript', 'HTML', 'CSS', 'TypeScript', 'Docker'] }] };
    const once = analyzeAtsLocally(candidate, jd);
    expect(once.score).toBeGreaterThanOrEqual(80);
    expect(analyzeAtsLocally({ ...candidate, summary: 'React React React TypeScript Docker' }, jd).score).toBe(once.score);
  });
  it('matches aliases and keeps Java separate from JavaScript', () => {
    const report = analyzeAtsLocally(resume, 'Requirements:\nReact and JavaScript are required for our frontend engineering team.\nPreferred:\nJava');
    expect(report.match.matched).toEqual(expect.arrayContaining(['react', 'javascript']));
    expect(report.match.missing).toContain('java');
    expect(report.rubric).toMatchObject({ requiredWeight: 3, preferredWeight: 1 });
    expect(report.requirements.find((row) => row.term === 'java').priority).toBe('preferred');
  });

  it('does not infer years of React experience from a skill or unrelated duration', () => {
    const candidate = { ...resume, summary: '5 years of experience in sales.' };
    const report = analyzeAtsLocally(candidate, 'Requirements:\nWe require 3+ years of React experience for frontend interfaces and digital products.');
    expect(report.requirements.find((row) => row.term.includes('years')).status).toBe('uncertain');
    expect(report.match.matched).toContain('react');
    const supported = analyzeAtsLocally({ ...resume, summary: '4 years of React experience.' }, 'Requirements:\nWe require 3+ years of React experience for frontend interfaces and digital products.');
    expect(supported.requirements.find((row) => row.term.includes('years')).status).toBe('matched');
  });

  it('keeps unfamiliar qualifications for review and excludes benefits', () => {
    const report = analyzeAtsLocally(resume, 'Requirements:\nMust hold a professional engineering license in the state of employment.\nBenefits:\nFree Java training');
    expect(report.requirements.filter(row => row.status === 'uncertain')).toHaveLength(1);
    expect(report.match.keywords).toEqual([]);
    expect(report.score).toBe(0);
  });

  it('does not use negative evidence or React Native to prove React', () => {
    const candidate = { ...resume, skillGroups: [], summary: 'No experience with React. Uses React Native.' };
    const report = analyzeAtsLocally(candidate, 'Requirements:\nReact is required for building interfaces for our frontend engineering team.');
    expect(report.match.matched).not.toContain('react');
  });

  it('runs the app ATS entry point without calling the provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network disabled'));
    const report = await analyzeAtsWithAI(resume, 'Requirements:\nJavaScript and React are required for building our product user interfaces.');
    expect(report.match.matched).toContain('react');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('hybrid resume parsing', () => {
  it('parses recognizable sections without an AI call', async () => {
    const semantic = vi.fn();
    const result = await parseResumeHybrid('Asha Rao\nFrontend Developer\nasha@example.com\nSkills\nReact, JavaScript\nEducation\nBachelor of Science\nExample University', semantic);
    expect(result.name).toBe('Asha Rao');
    expect(result.skillGroups.flatMap((group) => group.skills)).toContain('React');
    expect(semantic).not.toHaveBeenCalled();
  });

  it('uses AI for ambiguous layout and retains local data if unavailable', async () => {
    const semantic = vi.fn().mockRejectedValue(new Error('Rate limited'));
    const result = await parseResumeHybrid('Asha Rao\nasha@example.com\nBuilds digital products and supports clients across several industries.', semantic);
    expect(semantic).toHaveBeenCalledOnce();
    expect(result.contact.email).toBe('asha@example.com');
    expect(result.ambiguities.join(' ')).toContain('clarification was unavailable');
  });
});
