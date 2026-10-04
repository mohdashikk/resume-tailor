import { describe, expect, it } from 'vitest';
import { didSkillOrderChange, prioritizeSkillsForJob } from '../src/services/skillTailoringService';

describe('JD skill prioritization', () => {
  it('moves matching existing skills forward without inventing JD skills', () => {
    const source = [
      { id: 'design', name: 'Design', skills: ['User research', 'Figma', 'Wireframing'] },
      { id: 'frontend', name: 'Front-End', skills: ['HTML5', 'React.js', 'CSS3'] },
    ];
    const tailored = prioritizeSkillsForJob(source, 'We need React, CSS, Figma, and Python experience.');

    expect(tailored.map((group) => group.id)).toEqual(['frontend', 'design']);
    expect(tailored[0].skills).toEqual(['React.js', 'CSS3', 'HTML5']);
    expect(tailored[1].skills[0]).toBe('Figma');
    expect(tailored.flatMap((group) => group.skills)).not.toContain('Python');
    expect(didSkillOrderChange(source, tailored)).toBe(true);
  });

  it('keeps the original order when the JD has no matching skills', () => {
    const source = [{ id: 'design', name: 'Design', skills: ['Figma', 'Wireframing'] }];
    expect(prioritizeSkillsForJob(source, 'Seeking payroll accounting expertise.')).toEqual(source);
    expect(didSkillOrderChange(source, source)).toBe(false);
  });
});
