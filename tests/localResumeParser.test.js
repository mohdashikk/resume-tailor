import { describe, expect, it } from 'vitest';
import { parseResumeLocally } from '../src/services/localResumeParser';

describe('conservative fallback parsing', () => {
  it('does not turn a flattened document into an oversized name', () => {
    const flattened = `MUHAMMED ASHIK A mail4ashh@gmail.com +91 8089911973 PROFESSIONAL SUMMARY UI/UX Designer with 6+ years of experience creating responsive products. CORE SKILLS Figma, user flows, design systems, React PROFESSIONAL EXPERIENCE Example Company UI/UX Designer Jul 2023 - Present ${'Designed accessible interfaces. '.repeat(30)}`;
    const result = parseResumeLocally(flattened);
    expect(result.name.length).toBeLessThanOrEqual(120);
    expect(result.contact.email).toBe('mail4ashh@gmail.com');
    expect(result.summary).toContain('UI/UX Designer');
  });
});
