import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import TailorOverview from '../src/components/TailorOverview';
import { blankResume } from '../src/services/resumeValidation';

afterEach(() => vi.unstubAllGlobals());
it('keeps selection pending and rewrites without a placement dropdown', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const resume = { ...blankResume(), id: 'current', title: 'Frontend Developer', skillGroups: [{ id: 's', name: 'Skills', skills: ['React'] }], experience: [{ id: 'job', role: 'Developer', company: 'Example', bullets: [] }] };
  const onRetailor = vi.fn();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<TailorOverview resume={resume} jd="A React and TypeScript role" before={50} analysis={{ score: 50, match: { matched: ['React'], missing: ['TypeScript'], uncertain: [], keywords: ['React','TypeScript'] } }} onRetailor={onRetailor} />));
    await act(async () => host.querySelector('input[type="checkbox"]').click());
    expect(host.textContent).toContain('Rewrite Resume (1 selected)');
    expect(resume.skillGroups[0].skills).toEqual(['React']);
    expect(host.querySelector('[aria-label="Tailored ATS match"]').getAttribute('aria-valuenow')).toBe('50');
    expect(onRetailor).not.toHaveBeenCalled();
    expect(host.querySelector('select')).toBeNull();
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent.includes('Rewrite Resume (1 selected)')).click());
    expect(onRetailor).toHaveBeenCalledWith([{ term: 'TypeScript' }]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
