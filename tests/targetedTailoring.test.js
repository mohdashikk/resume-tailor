import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankResume } from '../src/services/resumeValidation.js';
import { analyzeAtsLocally } from '../src/services/localAtsService.js';
import { alignBulletKeywords, applyTargetedEdits, isSafeBulletEdit, preservesProtectedFacts, selectTailoringBullets, resolveSkillPlacements, planKeywordDistribution, respectsKeywordPlacement, finishKeywordDistribution, isSupportedSummary, applyBulletMerges, sameResumeWording, isMeaningfulBulletRewrite, hasUnsupportedOutcomeClaims } from '../src/services/targetedTailoringService.js';
import { handleAIRequest } from '../api/ai.js';
const master = { ...blankResume(), name: 'Alex', title: 'Developer', summary: 'Web developer.', skillGroups: [{ id: 's', name: 'Skills', skills: ['Git', 'React.js'] }], experience: [{ id: 'work', role: 'Developer', company: 'Acme', location: '', startDate: '2022', endDate: 'Present', bullets: [{ id: 'b', text: 'Built React.js interfaces with 20% improvement.' }, { id: 'other', text: 'Supported clients.' }] }] };
const jd = 'Requirements:\nReact is required for our frontend product engineering team building web interfaces.';
const input = { action: 'tailor', payload: { masterResume: master, jobDescription: jd } };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('targeted tailoring', () => {
  it('allows equivalent usability wording but blocks newly claimed results', () => {
    expect(hasUnsupportedOutcomeClaims('Defined flows to improve usability.', 'Mapped flows to enhance usability.')).toBe(false);
    expect(hasUnsupportedOutcomeClaims('Defined user flows.', 'Mapped flows to enhance usability.')).toBe(true);
    expect(hasUnsupportedOutcomeClaims('Defined flows to improve usability.', 'Mapped flows to boost revenue.')).toBe(true);
  });
  it('retains source metrics and named tools even when a semantic reviewer approves new prose', () => {
    expect(preservesProtectedFacts('Built React interfaces in Figma and improved load time by 20%.', 'Crafted Figma interfaces with React, improving load time by 20%.')).toBe(true);
    expect(preservesProtectedFacts('Built React interfaces in Figma and improved load time by 20%.', 'Crafted React interfaces, improving load time by 20%.')).toBe(false);
    expect(preservesProtectedFacts('Built React interfaces in Figma and improved load time by 20%.', 'Crafted Figma interfaces with React, improving load time by 30%.')).toBe(false);
  });
  it('does not count punctuation or hyphen changes as experience rephrasing', () => {
    expect(sameResumeWording('Designed role-based UI experiences.', 'Designed role‑based UI experiences')).toBe(true);
    expect(sameResumeWording('Designed responsive interfaces.', 'Crafted responsive interfaces.')).toBe(false);
  });
  it('does not count a lone opening-verb substitution in a full experience bullet', () => {
    expect(isMeaningfulBulletRewrite('Conducted usability testing and design reviews.', 'Performed usability testing and design reviews.')).toBe(false);
    expect(isMeaningfulBulletRewrite('Designed role-based UI experiences and authentication flows.', 'Crafted authentication flows and role-based UI experiences.')).toBe(true);
    expect(isMeaningfulBulletRewrite('Built React interfaces.', 'Developed React interfaces.')).toBe(true);
    expect(isMeaningfulBulletRewrite('Defined user flows, interaction patterns, and information architecture to improve overall product usability.', 'Defined user flows, interaction patterns, and information architecture to enhance product usability.')).toBe(false);
    expect(isMeaningfulBulletRewrite('Defined user flows, interaction patterns, and information architecture to improve overall product usability.', 'Mapped information architecture, user flows, and interaction patterns to improve overall product usability.')).toBe(true);
  });
  it('retains user research as a distinct verified responsibility', () => {
    const original = 'Led UX design from discovery and user research to high-fidelity Figma prototypes.';
    expect(preservesProtectedFacts(original, 'Led UX design, delivering discovery research and high-fidelity Figma prototypes.')).toBe(false);
    expect(preservesProtectedFacts(original, 'Led UX design through user research, discovery, and high-fidelity Figma prototypes.')).toBe(true);
    expect(preservesProtectedFacts('Led end-to-end UX design through user research.', 'Led UX design through user research.')).toBe(false);
    expect(preservesProtectedFacts('Led end-to-end UX design through user research.', 'Led full-cycle UX design through user research.')).toBe(true);
  });
  it('shortens summaries without adding claims or changing tenure', () => {
    const summary = 'Frontend developer with 6+ years building React interfaces and backend tools.';
    expect(isSupportedSummary(summary, 'Frontend developer with 6+ years building React interfaces.')).toBe(true);
    expect(isSupportedSummary(summary, 'Lead frontend developer with 6+ years building React interfaces.')).toBe(false);
    expect(isSupportedSummary(summary, 'Frontend developer with 8+ years building React interfaces.')).toBe(false);
  });
  it('consolidates overlapping experience bullets while retaining their facts', async () => {
    const source = structuredClone(master);
    source.summary = 'Web developer building React interfaces and tools.';
    source.experience[0].bullets = [{ id: 'a', text: 'Built React interfaces.' }, { id: 'b', text: 'Built reusable React components.' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'Web developer building React interfaces.', edits: [], merges: [{ sourceIds: ['experience:0:0', 'experience:0:1'], text: 'Built reusable React interfaces and components.' }] }) } }] }) });
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: source, jobDescription: jd } }, { GROQ_API_KEY: 'consolidation-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.resume.summary).toBe('Web developer building React interfaces.');
    expect(result.body.data.resume.experience[0].bullets).toEqual([{ id: 'a', text: 'Built reusable React interfaces and components.' }]);
    expect(source.experience[0].bullets).toHaveLength(2);
  });
  it('rejects merges that lose metrics, introduce claims, or combine employers', () => {
    const source = structuredClone(master);
    source.experience.push({ ...source.experience[0], id: 'second', bullets: [{ id: 'c', text: 'Built React screens.' }] });
    const selected = selectTailoringBullets(source, analyzeAtsLocally(source, jd));
    expect(applyBulletMerges(source, selected, [{ sourceIds: ['experience:0:0', 'experience:1:0'], text: 'Built React interfaces and screens.' }])).toBe(0);
    source.experience[0].bullets.push({ id: 'x', text: 'Built reusable React components.' });
    const linked = selectTailoringBullets(source, analyzeAtsLocally(source, jd));
    expect(applyBulletMerges(source, linked, [{ sourceIds: ['experience:0:0', 'experience:0:2'], text: 'Led reusable React interfaces and components.' }])).toBe(0);
    expect(source.experience[0].bullets).toHaveLength(3);
  });
  it('injects newly selected keywords into relevant experience tasks through the AI rewrite', async () => {
    const source = structuredClone(master);
    source.experience[0].bullets[1].text = 'Maintained automated tests.';
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: source.summary, edits: [
      { sourceId: 'experience:0:0', text: 'Developed React.js interfaces with TypeScript and 20% improvement.' },
      { sourceId: 'experience:0:1', text: 'Maintained automated tests using Playwright.' },
    ] }) } }] }) });
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: source, jobDescription: jd + '\nTypeScript and Playwright are required.', confirmedSkills: [{ term: 'TypeScript', entryId: 'work' }, { term: 'Playwright', entryId: 'work' }] } }, { GROQ_API_KEY: 'experience-distribution-test' });
    expect(result.status).toBe(200);
    const resume = result.body.data.resume;
    expect(resume.experience[0].bullets[0].text).toContain('TypeScript');
    expect(resume.experience[0].bullets[1].text).toContain('Playwright');
    expect(resume.summary).toBe(source.summary);
    expect(result.body.data.matchComparison.changedBullets).toBe(2);
    const request = JSON.parse(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content);
    expect(request.bullets.find(row => row.sourceId === 'experience:0:1').confirmedKeywords).toEqual(['Playwright']);
  });
  it('asks AI to repair omitted keywords rather than injecting a With prefix', async () => {
    const response = data => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(data) } }] }) });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ summary: master.summary, edits: [], merges: [] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: 'Built React.js interfaces with TypeScript and 20% improvement.' }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: master, jobDescription: jd + '\nTypeScript is required.', confirmedSkills: [{ term: 'TypeScript', entryId: 'work' }] } }, { GROQ_API_KEY: 'omitted-keyword-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.resume.experience[0].bullets[0].text).toContain('TypeScript');
    expect(result.body.data.resume.experience[0].bullets[0].text).toContain('20%');
    expect(result.body.data.resume.summary).not.toContain('TypeScript');
    expect(result.body.data.resume.skillGroups.flatMap(group => group.skills)).not.toContain('TypeScript');
    expect(result.body.data.resume.experience[0].bullets[0].text).not.toMatch(/^With /);
    expect(JSON.parse(fetch.mock.calls[1][1].body).response_format.json_schema.name).toBe('experience_writing_repair');
  });
  it('repairs legacy keyword-prefixed experience without dropping education context', async () => {
    const source = structuredClone(master);
    source.experience[0].bullets[0].text = 'With redux saga, built React interfaces.';
    source.education = [{ id: 'education', qualification: 'Diploma, Web Technologies', institution: 'Creative Institute', location: 'Kerala', startDate: '2018', endDate: '2019', details: 'Studied web technologies and interface development with practical projects.' }];
    const response = data => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(data) } }] }) });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ summary: source.summary, edits: [], educationEdits: [{ sourceId: 'education', text: 'Web technologies and interface development.' }] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: 'Built React interfaces with Redux Saga.' }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: source, jobDescription: jd + '\nRedux Saga is required.' } }, { GROQ_API_KEY: 'legacy-polish-test' });
    expect(result.body.data.resume.experience[0].bullets[0].text).toBe('Built React interfaces with Redux Saga.');
    expect(result.body.data.resume.education[0]).toEqual(source.education[0]);
  });
  it('spreads role skills across bullets and leaves other tools in Skills', () => {
    const selected = [];
    const plan = planKeywordDistribution(master, [{ term: 'TypeScript', entryId: 'work' }, { term: 'testing', entryId: 'work' }, { term: 'Docker', entryId: '' }, { term: 'communication', entryId: '' }], selected);
    expect(selected.find(row => row.index === 0).confirmedKeywords).toEqual(['TypeScript']);
    expect(selected.find(row => row.index === 1).confirmedKeywords).toEqual(['testing']);
    expect(plan.summaryTerms).toEqual(['communication']);
    expect(plan.skillTerms).toEqual(['Docker']);
  });
  it('blocks repeated additions and additions outside the assigned destination', () => {
    expect(respectsKeywordPlacement('Built interfaces.', 'Built interfaces using TypeScript and TypeScript.', ['TypeScript'], ['TypeScript'])).toBe(false);
    expect(respectsKeywordPlacement('Web developer.', 'Web developer using TypeScript.', ['TypeScript'], [])).toBe(false);
    expect(respectsKeywordPlacement('Built interfaces.', 'Built TypeScript interfaces.', ['TypeScript'], ['TypeScript'])).toBe(true);
  });
  it('retains original skills but removes newly inserted narrative duplicates', () => {
    const resume = structuredClone(master);
    resume.experience[0].bullets[0].text += ' TypeScript.';
    resume.skillGroups[0].skills.push('TypeScript');
    finishKeywordDistribution(master, resume, ['TypeScript', 'Docker', 'React']);
    expect(resume.skillGroups.flatMap(group => group.skills)).toContain('React.js');
    expect(resume.skillGroups.flatMap(group => group.skills)).not.toContain('TypeScript');
    expect(resume.skillGroups.flatMap(group => group.skills)).toContain('Docker');
  });
  it('requires role evidence rather than treating compatible tasks as proof of a tool', () => {
    const result = resolveSkillPlacements(master, [{ term: 'React', entryId: '' }, { term: 'TypeScript', entryId: '' }, { term: 'Docker', entryId: '' }]);
    expect(result).toEqual([{ term: 'React', entryId: 'work' }, { term: 'TypeScript', entryId: '' }, { term: 'Docker', entryId: '' }]);
  });
  it('accepts a natural paraphrase only after separate evidence review', async () => {
    const response = data => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(data) } }] }) });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ summary: 'Web developer experienced in TypeScript.', edits: [{ sourceId: 'experience:0:0', text: 'Engineered React interfaces with a 20% improvement using TypeScript.' }] })).mockResolvedValueOnce(response({ approvedIds: ['experience:0:0'], summarySupported: true }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: master, jobDescription: jd + '\nTypeScript is preferred.', confirmedSkills: [{ term: 'typescript', entryId: 'work' }] } }, { GROQ_API_KEY: 'paraphrase-review-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.resume.summary).toBe(master.summary);
    expect(result.body.data.resume.experience[0].bullets[0].text).toContain('Engineered');
    expect(result.body.data.matchComparison).toMatchObject({ changedBullets: 1, rejectedBullets: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('cannot approve invented numerical outcomes during selected-skill rewriting', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'Web developer. Skills include TypeScript.', edits: [{ sourceId: 'experience:0:0', text: 'Built React interfaces with 90% improvement using TypeScript.' }] }) } }] }) });
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: master, jobDescription: jd + '\nTypeScript is preferred.', confirmedSkills: [{ term: 'typescript', entryId: 'work' }] } }, { GROQ_API_KEY: 'metric-protection-test' });
    expect(result.status).toBe(502);
    expect(result.body.data).toBeUndefined();
    expect(master.experience[0].bullets[0].text).toContain('20%');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('places the selected skill in its assigned role without repeating it in the summary', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'Web developer. Skills include TypeScript.', edits: [{ sourceId: 'experience:0:0', text: 'Built React.js interfaces with 20% improvement using TypeScript.' }] }) } }] }) });
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: master, jobDescription: jd + '\nTypeScript is preferred.', confirmedSkills: [{ term: 'typescript', entryId: 'work' }] } }, { GROQ_API_KEY: 'selected-rewrite-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.resume.summary).toBe(master.summary);
    expect(result.body.data.resume.experience[0].bullets[0].text).toContain('TypeScript');
    expect(result.body.data.resume.experience[0].bullets[1]).toEqual(master.experience[0].bullets[1]);
    expect(master.skillGroups.flatMap(group => group.skills)).not.toContain('typescript');
    expect(result.body.data.matchComparison.after).toBeGreaterThanOrEqual(result.body.data.matchComparison.before);
  });
  it('preserves source roles and keeps an unassigned user-confirmed skill in Skills when AI fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: master, jobDescription: jd + '\nTypeScript is preferred.', confirmedSkills: [{ term: 'typescript', entryId: '' }] } }, { GROQ_API_KEY: 'failed-selected-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.matchComparison.status).toBe('unavailable');
    expect(result.body.data.resume.experience[0]).toMatchObject({
      id: master.experience[0].id,
      role: master.experience[0].role,
      company: master.experience[0].company,
      startDate: master.experience[0].startDate,
      endDate: master.experience[0].endDate,
    });
    expect(result.body.data.resume.experience[0].bullets.map(bullet => bullet.text)).toEqual([
      'Built React interfaces with 20% improvement.',
      master.experience[0].bullets[1].text,
    ]);
    expect(result.body.data.resume.skillGroups.flatMap(group => group.skills).map(skill => skill.toLowerCase())).toContain('typescript');
  });
  it('rejects skills outside the JD and new role assignments', async () => {
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: master, jobDescription: jd, confirmedSkills: [{ term: 'Python', entryId: 'invented' }] } }, { GROQ_API_KEY: 'invalid-selection' });
    expect(result.status).toBe(400);
  });
  it('selects only relevant bullets and preserves source identifiers and untouched facts', () => {
    const selected = selectTailoringBullets(master, analyzeAtsLocally(master, jd));
    expect(selected).toHaveLength(1);
    const result = applyTargetedEdits(master, selected, { edits: [{ sourceId: selected[0].sourceId, text: 'Developed interfaces with React and 20% improvement.' }] }, jd);
    expect(result.changed).toBe(1);
    expect(result.resume.experience[0]).toMatchObject({ company: 'Acme', startDate: '2022', bullets: [{ id: 'b', text: 'Developed interfaces with React and 20% improvement.' }, master.experience[0].bullets[1]] });
    expect(result.resume.summary).toBe(master.summary);
    expect(master.experience[0].bullets[0].text).toContain('Built');
  });
  it.each(['Built React interfaces with 30% improvement.', 'Led React interfaces with 20% improvement.', 'Built accessible React interfaces with 20% improvement.', 'Built React interfaces.', 'Built React and Python interfaces with 20% improvement.'])('rejects factual vocabulary or metric changes: %s', proposed => {
    expect(isSafeBulletEdit(master.experience[0].bullets[0].text, proposed)).toBe(false);
  });
  it('rejects duplicate and invented source links', () => {
    const selected = selectTailoringBullets(master, analyzeAtsLocally(master, jd));
    const edit = { sourceId: selected[0].sourceId, text: selected[0].text };
    expect(() => applyTargetedEdits(master, selected, { edits: [edit, edit] }, jd)).toThrow(/uniquely/);
    expect(() => applyTargetedEdits(master, selected, { edits: [{ ...edit, sourceId: 'invented' }] }, jd)).toThrow(/uniquely/);
  });
  it('sends a compact request and rescores locally without increasing keyword credit', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ edits: [{ sourceId: 'experience:0:0', text: 'Developed interfaces with React and 20% improvement.' }] }) } }] }) });
    const result = await handleAIRequest(input, { GROQ_API_KEY: 'targeted-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.matchComparison).toMatchObject({ changedBullets: 1, rejectedBullets: 0, status: 'completed' });
    expect(result.body.data.matchComparison.after).toBe(result.body.data.matchComparison.before);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(4096);
    expect(JSON.parse(body.messages[1].content).roles[0]).toMatchObject({ role_id: 'experience:0', employer: 'Acme' });
    expect(body.response_format.json_schema.name).toBe('bullet_edits');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('retains original bullets when generation is truncated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }) });
    const result = await handleAIRequest(input, { GROQ_API_KEY: 'truncated-test' });
    expect(result.body.data.matchComparison.status).toBe('unavailable');
    expect(result.body.data.resume.experience).toEqual(applyTargetedEdits(master, [], { edits: [] }, jd).resume.experience);
  });
  it('returns local results after the 15 second AI deadline', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const pending = handleAIRequest(input, { GROQ_API_KEY: 'deadline-test' });
    await vi.advanceTimersByTimeAsync(15001);
    const result = await pending;
    expect(result.body.data.matchComparison.status).toBe('unavailable');
    expect(result.body.data.resume.experience).toEqual(applyTargetedEdits(master, [], { edits: [] }, jd).resume.experience);
  });
});

it('aligns JD spelling within experience without borrowing unsupported skills', () => {
  expect(alignBulletKeywords('Built React.js pages integrating RESTful APIs with HTML5 and CSS3.', 'React, REST APIs, HTML, CSS, TypeScript')).toBe('Built React pages integrating REST APIs with HTML and CSS.');
  expect(alignBulletKeywords('Built React Native apps.', 'React, Java, TypeScript')).toBe('Built React Native apps.');
  expect(isSafeBulletEdit('Built HTML5 pages with 20% improvement.', 'Developed HTML pages with 20% improvement.')).toBe(true);
});

it('accepts safe action-verb and common resume noun equivalents', () => {
  expect(isSafeBulletEdit('Made components for a task app using React.', 'Developed React components for a task application.')).toBe(true);
  expect(isSafeBulletEdit('Fixed frontend issues.', 'Resolved frontend issues.')).toBe(true);
  expect(isSafeBulletEdit('Wrote support notes.', 'Authored support documentation.')).toBe(true);
  expect(isSafeBulletEdit('Worked with developers to fix usability issues.', 'Collaborated with developers to resolve usability issues.')).toBe(true);
  expect(isSafeBulletEdit('Completed a capstone project on accessible web interfaces.', 'Completed a capstone project focused on accessible web interfaces.')).toBe(true);
});


