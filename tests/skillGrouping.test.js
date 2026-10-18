import { expect, it } from 'vitest';
import { groupSkillsByCategory, groupSkillsForResume } from '../src/services/skillGroupingService.js';
import { prepareUploadedResume } from '../src/services/resumeParsingService.js';
import { blankResume } from '../src/services/resumeValidation.js';

it('puts developer categories into resume subheadings without adding skills', () => {
  const resume = { ...blankResume(), title: 'Frontend Developer', skillGroups: [{ id: 's', name: 'Skills', skills: ['React.js','CSS','Node.js','SQL','Docker','Git','Research strategy'] }] };
  expect(Object.fromEntries(groupSkillsForResume(resume).map(group => [group.name, group.skills]))).toEqual({ Frontend: ['React.js','CSS'], Backend: ['Node.js','SQL'], 'Other skills': ['Docker','Git','Research strategy'] });
  expect(resume.skillGroups).toHaveLength(1);
  expect(groupSkillsForResume({ ...resume, skillGroups: [{ id: 's', name: 'Skills', skills: ['React'] }] }).map(group => group.name)).toEqual(['Frontend']);
});

it('separates a mixed skill list into populated categories without inventing skills', () => {
  const skills = ['React.js', 'HTML5', 'Tailwind CSS', 'Sass', 'Node.js', 'SQL', 'Docker', 'Git', 'Jest', 'Figma'];
  const result = groupSkillsByCategory([{ id: 's', name: 'Skills', skills }]);
  expect(Object.fromEntries(result.map((group) => [group.name, group.skills]))).toEqual({
    Frontend: ['React.js', 'HTML5'], 'Styling & UI': ['Tailwind CSS', 'Sass'], Backend: ['Node.js'],
    Databases: ['SQL'], 'DevOps & Cloud': ['Docker'], 'Tools & Collaboration': ['Git'], Testing: ['Jest'], 'Design & UX': ['Figma'],
  });
  expect(result.flatMap((group) => group.skills)).toEqual(skills);
});

it('does not show backend or devops without supporting skills and preserves unknown skills', () => {
  const resume = prepareUploadedResume({ ...blankResume(), skillGroups: [{ id: 's', name: 'Skills', skills: ['React', 'CSS', 'Research strategy', ' React '] }] });
  expect(resume.skillGroups.map((group) => group.name)).toEqual(['Frontend', 'Styling & UI', 'Skills']);
  expect(resume.skillGroups.flatMap((group) => group.skills)).toEqual(['React', 'CSS', 'Research strategy']);
  expect(new Set(resume.skillGroups.map((group) => group.id)).size).toBe(3);
});
