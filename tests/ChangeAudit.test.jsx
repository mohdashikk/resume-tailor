// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import ChangeAudit from '../src/components/ChangeAudit';
import { blankResume } from '../src/services/resumeValidation';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;

afterEach(() => {
  if (root) act(() => root.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

describe('ChangeAudit review controls', () => {
  it('advances after accepting and closes after accepting the final change', () => {
    const master = {
      ...blankResume(),
      summary: 'Original summary',
      skillGroups: [{ name: 'Design', skills: ['Research'] }],
    };
    const tailored = {
      ...structuredClone(master),
      summary: 'Tailored summary',
      skillGroups: [{ name: 'Design', skills: ['Research', 'Prototyping'] }],
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root.render(<ChangeAudit master={master} tailored={tailored} jdKeywords={[]} />));
    expect(document.body.textContent).toContain('1 of 2');

    const acceptButton = () => [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Accept'));
    act(() => acceptButton().click());
    expect(document.body.textContent).toContain('2 of 2');

    act(() => acceptButton().click());

    expect(document.body.textContent).toContain('AI edits reviewed');
    expect(document.body.textContent).toContain('2/2');
    expect(document.body.textContent).not.toContain('Why this change?');
  });
});
