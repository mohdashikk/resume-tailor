import { expect, it } from 'vitest';
import { educationDetails, resumeLink } from '../src/services/resumePresentation.js';
import { groupSkillsForResume } from '../src/services/skillGroupingService.js';
import { blankResume } from '../src/services/resumeValidation.js';

it('removes repeated education metadata but preserves incomplete-degree status', () => {
  expect(educationDetails({ qualification: 'Diploma, Web Technologies', institution: 'Creative Institute', location: 'Kerala', details: 'Kerala | Diploma, Web Technologies Kerala | Practical projects | Practical projects' })).toBe('Practical projects');
  expect(educationDetails({ qualification: 'Bachelor of Arts', details: 'Final year — in progress' })).toBe('Final year — in progress');
});

it('displays actual URLs and normalizes clickable links without inventing missing addresses', () => {
  expect(resumeLink({ label: 'GitHub', url: 'github.com/alex' })).toMatchObject({ label: 'github.com/alex', url: 'https://github.com/alex' });
  expect(resumeLink({ label: 'Personal Website', url: 'https://alex.example/' }).label).toBe('alex.example');
  expect(resumeLink({ label: 'GitHub', url: '' }).url).toBe('');
  expect(resumeLink({ label: 'Website', url: 'javascript:alert(1)' }).url).toBe('');
});

it('formats and deduplicates technologies and removes vague heading-like skills', () => {
  const resume = { ...blankResume(), title: 'Frontend Developer', skillGroups: [{ id: 's', name: 'Skills', skills: ['typescript', 'redux saga', 'react testing library', 'storybook', 'React.js', 'react', 'regulated-product'] }] };
  const skills = groupSkillsForResume(resume).flatMap(group => group.skills);
  expect(skills).toEqual(expect.arrayContaining(['TypeScript', 'Redux Saga', 'React Testing Library', 'Storybook', 'React.js']));
  expect(skills).toHaveLength(5);
});
