import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankResume } from '../src/services/resumeValidation.js';
import { analyzeAtsLocally } from '../src/services/localAtsService.js';
import { buildCandidateEvidence, validateRoleRewrite, assertSourceHistory } from '../src/services/candidateEvidenceService.js';
import { handleAIRequest } from '../api/ai.js';
import { createResumePdfDocument } from '../src/services/pdfService.js';

const job = (id, company, texts) => ({ id, role: 'Frontend Developer', company, startDate: '2022', endDate: '2024', location: '', bullets: texts.map((text, index) => ({ id: `${id}-${index}`, text })) });
const resume = () => ({ ...blankResume(), name: 'Alex Example', title: 'Frontend Developer', contact: { email: 'alex@example.com', phone: '', location: '' }, summary: 'Frontend developer building React interfaces.', skillGroups: [{ id: 'skills', name: 'Skills', skills: ['React'] }], experience: [
  job('recent', 'First Company', ['Built React interfaces.', 'Integrated REST APIs and handled dynamic data rendering.', 'Handled API error states.', 'Improved load time by 20%.']),
  job('earlier', 'Second Company', ['Built reusable React components with TypeScript.']),
  { ...job('other', 'Third Company', ['Processed invoices.']), role: 'Accountant' },
] });
const jd = 'Required: React, TypeScript and REST APIs for frontend interfaces and API error handling.\nPreferred: Playwright testing.';
const response = data => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(data) } }] }) });
const validOutput = () => ({ edits: [], summary: 'Frontend developer building React interfaces.', roleRewrites: [
  { role_id: 'experience:0', tailored_bullets: [
    { text: 'Built React interfaces, integrated REST APIs, handled dynamic data rendering, and handled API error states.', evidence_references: ['experience:0:0', 'experience:0:1', 'experience:0:2'] },
    { text: 'Improved load time by 20%.', evidence_references: ['experience:0:3'] },
  ] },
  { role_id: 'experience:1', tailored_bullets: [{ text: 'Developed reusable React components with TypeScript.', evidence_references: ['experience:1:0'] }] },
  { role_id: 'experience:2', tailored_bullets: [{ text: 'Processed invoices.', evidence_references: ['experience:2:0'] }] },
] });
afterEach(() => vi.restoreAllMocks());

describe('role evidence tailoring pipeline', () => {
  it('reports a provider failure instead of showing a misleading retry result', async () => {
    const original = resume();
    original.summary = 'Designer with experience in Figma and accessible web interfaces.';
    original.experience = [job('recent', 'First Company', ['Conducted usability testing and design reviews.'])];
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Provider unavailable'));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd, rewriteEntireResume: true } }, { GROQ_API_KEY: 'unavailable-provider' });
    expect(result.status).toBe(502);
    expect(result.body.code).toBe('EXPERIENCE_REWRITE_FAILED');
    expect(result.body.error).toContain('draft was not changed');
  });

  it('shows Groq rate limits explicitly instead of returning unchanged Experience as success', async () => {
    const original = resume();
    original.experience = [job('recent', 'First Company', ['Built React interfaces.'])];
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 429, headers: { get: () => '60' },
      json: async () => ({ error: { message: 'Rate limit reached.' } }),
    });
    const result = await handleAIRequest({ action: 'tailor', payload: {
      masterResume: original, jobDescription: jd, rewriteEntireResume: true,
    } }, { GROQ_API_KEY: 'explicit-rate-limit-test' });
    expect(result.status).toBe(429);
    expect(result.body.code).toBe('AI_RATE_LIMITED');
    expect(result.body.error).toContain('Groq is rate-limited');
    expect(result.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(2); // One attempt per model; no narrative or repeated bullet calls.
  });

  it('uses only checked, selected JD keywords as Experience rewrite priorities', async () => {
    const original = resume();
    original.summary = '';
    original.experience = [job('recent', 'First Company', ['Built React and TypeScript interfaces.'])];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, request) => {
      const name = JSON.parse(request.body).response_format.json_schema.name;
      if (name === 'full_resume_bullets') return response({ edits: [{ sourceId: 'experience:0:0', text: 'Developed interfaces using React and TypeScript.' }] });
      return response({ summary: '', educationEdits: [] });
    });
    const result = await handleAIRequest({ action: 'tailor', payload: {
      masterResume: original, jobDescription: jd, rewriteEntireResume: true, selectedKeywords: ['react'],
    } }, { GROQ_API_KEY: 'selected-priority-test' });
    expect(result.status).toBe(200);
    const input = JSON.parse(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content);
    expect(input.bullets[0].supportedJdTerms.map(term => term.toLowerCase())).toContain('react');
    expect(input.bullets[0].supportedJdTerms.map(term => term.toLowerCase())).not.toContain('typescript');
    const invalid = await handleAIRequest({ action: 'tailor', payload: {
      masterResume: original, jobDescription: jd, rewriteEntireResume: true, selectedKeywords: ['Invented Tool'],
    } }, { GROQ_API_KEY: 'selected-priority-test' });
    expect(invalid.status).toBe(400);
  });

  it('uses AI to rephrase the summary, experience, projects and education details without changing facts', async () => {
    const original = resume();
    original.summary = 'Built React interfaces.';
    original.experience = [job('recent', 'First Company', ['Built React interfaces.'])];
    original.projects = [{ id: 'portfolio', name: 'Portfolio', subtitle: '', link: '', startDate: '', endDate: '',
      bullets: [{ id: 'portfolio-0', text: 'Built React components.' }] }];
    original.education = [{ id: 'degree', institution: 'Example University', qualification: 'BSc Design', location: '', startDate: '2018', endDate: '2022',
      details: 'Completed a React capstone project.' }];
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ edits: [
        { sourceId: 'experience:0:0', text: 'Developed React interfaces.' },
        { sourceId: 'projects:0:0', text: 'Developed React components.' },
      ] }))
      .mockResolvedValueOnce(response({ summary: 'Developed React interfaces.', educationEdits: [
        { sourceId: 'degree', text: 'Completed a capstone project with React.' },
      ] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd, rewriteEntireResume: true } }, { GROQ_API_KEY: 'full-rewrite' });
    expect(result.status).toBe(200);
    expect(result.body.data.matchComparison.status).toBe('completed');
    expect(result.body.data.resume.summary).toBe('Developed React interfaces.');
    expect(result.body.data.resume.experience[0].bullets[0].text).toBe('Developed React interfaces.');
    expect(result.body.data.resume.projects[0].bullets[0].text).toBe('Developed React components.');
    expect(result.body.data.resume.education[0].details).toBe('Completed a capstone project with React.');
    expect(result.body.data.resume.education[0].qualification).toBe('BSc Design');
    expect(result.body.data.resume.education[0].institution).toBe('Example University');
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).response_format.json_schema.name)).toEqual([
      'full_resume_bullets', 'full_resume_narrative',
    ]);
  });

  it('retries unchanged summary and education prose without changing qualifications', async () => {
    const original = resume();
    original.summary = 'Built React interfaces.';
    original.experience = [];
    original.education = [{ id: 'degree', institution: 'Example University', qualification: 'BSc Design', location: '', startDate: '2018', endDate: '2022',
      details: 'Completed a React capstone project.' }];
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ summary: original.summary, educationEdits: [{ sourceId: 'degree', text: original.education[0].details }] }))
      .mockResolvedValueOnce(response({ summary: 'Developed React interfaces.', educationEdits: [{ sourceId: 'degree', text: 'Completed a capstone project with React.' }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd, rewriteEntireResume: true } }, { GROQ_API_KEY: 'narrative-retry' });
    expect(result.body.data.matchComparison.status).toBe('completed');
    expect(result.body.data.resume.summary).toBe('Developed React interfaces.');
    expect(result.body.data.resume.education[0]).toMatchObject({ qualification: 'BSc Design', institution: 'Example University',
      details: 'Completed a capstone project with React.' });
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).response_format.json_schema.name)).toEqual([
      'full_resume_narrative', 'full_resume_narrative_rephrase',
    ]);
  });

  it('does not claim a long copied bullet was rewritten by changing only its opening verb', async () => {
    const original = resume();
    original.summary = 'Built React interfaces.';
    original.experience = [job('recent', 'First Company', ['Conducted usability testing and design reviews.'])];
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: original.experience[0].bullets[0].text }] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: original.experience[0].bullets[0].text }] }))
      .mockResolvedValueOnce(response({ summary: 'Developed React interfaces.', educationEdits: [] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: original.experience[0].bullets[0].text }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd, rewriteEntireResume: true } }, { GROQ_API_KEY: 'safe-polish' });
    expect(result.body.data.resume.experience[0].bullets[0].text).toBe(original.experience[0].bullets[0].text);
    expect(result.body.data.matchComparison).toMatchObject({ status: 'unavailable', changedBullets: 0 });
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).response_format.json_schema.name)).toEqual([
      'full_resume_bullets', 'full_resume_constrained_rephrase', 'full_resume_narrative', 'full_resume_final_bullets',
    ]);
  });

  it('sends second-pass paraphrases to evidence review instead of silently discarding them', async () => {
    const original = resume();
    original.summary = 'Built React interfaces.';
    original.experience = [job('recent', 'First Company', ['Translated business requirements into web and mobile interface designs.'])];
    const proposed = 'Converted business requirements into designs for both web and mobile interfaces.';
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: original.experience[0].bullets[0].text }] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: proposed }] }))
      .mockResolvedValueOnce(response({ summary: 'Developed React interfaces.', educationEdits: [] }))
      .mockResolvedValueOnce(response({ approvedIds: ['experience:0:0'] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd, rewriteEntireResume: true } }, { GROQ_API_KEY: 'second-pass-review-test' });
    expect(result.body.data.resume.experience[0].bullets[0].text).toBe(proposed);
    expect(result.body.data.matchComparison).toMatchObject({ status: 'completed', changedBullets: 1 });
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).response_format.json_schema.name)).toEqual([
      'full_resume_bullets', 'full_resume_constrained_rephrase', 'full_resume_narrative', 'full_resume_evidence_review',
    ]);
  });

  it('reviews a first-pass paraphrase before retrying an unchanged bullet', async () => {
    const original = resume();
    original.summary = 'Built React interfaces.';
    original.experience = [job('recent', 'First Company', ['Translated business requirements into web and mobile interface designs.'])];
    const proposed = 'Converted business requirements into designs for both web and mobile interfaces.';
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: proposed }] }))
      .mockResolvedValueOnce(response({ summary: 'Developed React interfaces.', educationEdits: [] }))
      .mockResolvedValueOnce(response({ approvedIds: ['experience:0:0'] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd, rewriteEntireResume: true } }, { GROQ_API_KEY: 'first-pass-review-test' });
    expect(result.body.data.resume.experience[0].bullets[0].text).toBe(proposed);
    expect(result.body.data.matchComparison.status).toBe('completed');
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).response_format.json_schema.name)).toEqual([
      'full_resume_bullets', 'full_resume_narrative', 'full_resume_evidence_review',
    ]);
  });

  it('uses a focused final AI pass for a still-verbatim experience bullet', async () => {
    const original = resume();
    original.summary = 'Built React interfaces.';
    original.experience = [job('recent', 'First Company', ['Conducted usability testing and design reviews.'])];
    const source = original.experience[0].bullets[0].text;
    const rewritten = 'Performed design reviews and usability testing.';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: source }] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: source }] }))
      .mockResolvedValueOnce(response({ summary: 'Developed React interfaces.', educationEdits: [] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: rewritten }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd, rewriteEntireResume: true } }, { GROQ_API_KEY: 'final-bullet-test' });
    expect(result.body.data.resume.experience[0].bullets[0].text).toBe(rewritten);
    expect(result.body.data.matchComparison).toMatchObject({ status: 'completed', changedBullets: 1 });
  });

  it('reviews a substantive final paraphrase instead of discarding it for new vocabulary', async () => {
    const original = resume();
    original.summary = 'Built React interfaces.';
    original.experience = [job('recent', 'First Company', ['Built React interfaces using Figma.'])];
    const source = original.experience[0].bullets[0].text;
    const rewritten = 'Crafted interfaces in React with Figma.';
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: source }] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: source }] }))
      .mockResolvedValueOnce(response({ summary: 'Developed React interfaces.', educationEdits: [] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: rewritten }] }))
      .mockResolvedValueOnce(response({ approvedIds: ['experience:0:0'] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd, rewriteEntireResume: true } }, { GROQ_API_KEY: 'final-paraphrase-review' });
    expect(result.body.data.resume.experience[0].bullets[0].text).toBe(rewritten);
    expect(result.body.data.matchComparison).toMatchObject({ status: 'completed', changedBullets: 1 });
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).response_format.json_schema.name)).toEqual([
      'full_resume_bullets', 'full_resume_constrained_rephrase', 'full_resume_narrative', 'full_resume_final_bullets', 'full_resume_final_evidence_review',
    ]);
    const finalInput = JSON.parse(JSON.parse(fetch.mock.calls[3][1].body).messages[1].content);
    expect(finalInput.bullets[0].supportedJdTerms).toContain('react');
  });

  it('rephrases a summary sentence after whole-summary attempts repeated it', async () => {
    const original = resume();
    original.summary = 'Designed accessible web interfaces with Figma and user research.';
    original.experience = [];
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ summary: original.summary, educationEdits: [] }))
      .mockResolvedValueOnce(response({ summary: original.summary, educationEdits: [] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: '0', text: 'Accessible web interfaces designed with Figma and user research.' }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd, rewriteEntireResume: true } }, { GROQ_API_KEY: 'sentence-summary-test' });
    expect(result.body.data.resume.summary).toBe('Accessible web interfaces designed with Figma and user research.');
    expect(result.body.data.matchComparison.status).toBe('completed');
  });

  it('carries a four-role, twenty-bullet parsed resume through full rephrasing', async () => {
    const original = resume();
    original.title = 'UI/UX Designer';
    original.summary = 'Designed accessible interfaces.';
    const verbs = ['Led', 'Translated', 'Built', 'Conducted', 'Defined', 'Collaborated', 'Designed'];
    original.experience = [7, 6, 5, 2].map((count, index) => ({
      ...job(`design-${index}`, `Studio ${index + 1}`, verbs.slice(0, count).map((verb) => `${verb} accessible product interfaces with design teams.`)),
      role: 'UI/UX Designer',
    }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, request) => {
      const body = JSON.parse(request.body);
      const schemaName = body.response_format.json_schema.name;
      if (schemaName.startsWith('full_resume_narrative')) return response({ summary: 'Crafted accessible interfaces.', educationEdits: [] });
      const input = JSON.parse(body.messages[1].content);
      return response({ edits: input.bullets.map(({ sourceId, original: text }) => ({ sourceId, text })) });
    });
    const result = await handleAIRequest({ action: 'tailor', payload: {
      masterResume: original,
      jobDescription: 'We need a UI/UX designer to create accessible product interfaces and collaborate with design and engineering teams.',
      rewriteEntireResume: true,
    } }, { GROQ_API_KEY: 'twenty-bullet-rewrite-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.resume.experience.map((entry) => entry.bullets.length)).toEqual([7, 6, 5, 2]);
    expect(result.body.data.matchComparison.changedBullets).toBe(0);
    assertSourceHistory(original, result.body.data.resume);
  });

  it('uses Groq only for unchanged Experience bullets while retaining prior verified rewrites', async () => {
    const original = resume();
    original.summary = 'Built React interfaces.';
    original.experience = [job('recent', 'First Company', [
      'Built React interfaces.',
      'Conducted usability testing and design reviews.',
      'Integrated REST APIs and handled dynamic data rendering.',
    ])];
    const existing = structuredClone(original);
    existing.id = 'existing-tailored-copy';
    existing.summary = 'Developed React interfaces.';
    existing.experience[0].bullets[0].text = 'Developed React interfaces.';
    existing.experience[0].bullets[2].text = 'Handled dynamic data rendering by integrating REST APIs.';
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, request) => {
      const body = JSON.parse(request.body);
      expect(body.response_format.json_schema.name).toBe('full_resume_bullets');
      const input = JSON.parse(body.messages[1].content);
      expect(input.bullets.map(bullet => bullet.sourceId)).toEqual(['experience:0:1']);
      return response({ edits: [{ sourceId: 'experience:0:1', text: 'Performed design reviews and usability testing.' }] });
    });
    const result = await handleAIRequest({ action: 'tailor', payload: {
      masterResume: original, existingTailoredResume: existing, jobDescription: jd, rewriteEntireResume: true,
    } }, { GROQ_API_KEY: 'retry-only-unchanged-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.matchComparison).toMatchObject({ changedBullets: 3, status: 'completed' });
    expect(result.body.data.resume.experience[0].bullets.map(bullet => bullet.text)).toEqual([
      'Developed React interfaces.', 'Performed design reviews and usability testing.', 'Handled dynamic data rendering by integrating REST APIs.',
    ]);
    expect(result.body.data.resume.summary).toBe(existing.summary);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries unchanged source bullets while preserving edited identity and added Experience bullets', async () => {
    const original = resume();
    original.experience = [job('recent', 'First Company', ['Built React interfaces.'])];
    const existing = structuredClone(original);
    existing.title = 'Senior Frontend Developer';
    existing.experience[0].bullets.push({ id: 'extra', text: 'Coordinated design reviews with product stakeholders.' });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ edits: [{ sourceId: 'experience:0:0', text: 'Developed React interfaces.' }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: {
      masterResume: original, existingTailoredResume: existing, jobDescription: jd, rewriteEntireResume: true,
    } }, { GROQ_API_KEY: 'retry-structure-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.resume.title).toBe(existing.title);
    expect(result.body.data.resume.experience[0].bullets).toEqual([
      { id: 'recent-0', text: 'Developed React interfaces.' },
      { id: 'extra', text: 'Coordinated design reviews with product stakeholders.' },
    ]);
    expect(fetch).toHaveBeenCalled();
  });

  it('polishes a repeated summary safely after AI has reviewed the full resume', async () => {
    const original = resume();
    original.summary = 'Designer with experience in Figma and accessible web interfaces.';
    original.experience = [];
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ summary: original.summary, educationEdits: [] }))
      .mockResolvedValueOnce(response({ summary: original.summary, educationEdits: [] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd, rewriteEntireResume: true } }, { GROQ_API_KEY: 'summary-polish' });
    expect(result.body.data.resume.summary).toBe('Designer experienced in Figma and accessible web interfaces.');
    expect(result.body.data.matchComparison.status).toBe('unavailable');
    expect(result.body.data.changeSummary.join(' ')).toContain('AI did not produce an accepted rewrite');
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).response_format.json_schema.name)).toEqual([
      'full_resume_narrative', 'full_resume_narrative_rephrase', 'full_resume_summary_sentences',
    ]);
  });

  it('passes the full JD and retries an unchanged job even when another job was rewritten', async () => {
    const original = resume();
    original.experience = original.experience.slice(0, 2);
    const output = validOutput();
    output.roleRewrites = output.roleRewrites.slice(0, 2);
    output.roleRewrites[1].tailored_bullets[0].text = original.experience[1].bullets[0].text;
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(output))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:1:0', text: 'Developed reusable React components with TypeScript.' }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'each-job-rewrite' });
    expect(result.body.data.resume.experience[1].bullets[0].text).toBe('Developed reusable React components with TypeScript.');
    expect(result.body.data.resume.experience[0].bullets[0].text).toContain('integrated REST APIs');
    const requests = fetch.mock.calls.map(([, options]) => JSON.parse(JSON.parse(options.body).messages[1].content));
    expect(requests[0].jobDescription).toBe(jd);
    expect(requests[1].jobDescription).toBe(jd);
    expect(requests[1].bullets.map(bullet => bullet.sourceId)).toEqual(['experience:1:0']);
  });

  it('retries experience separately when the full rewrite only returns skill or summary changes', async () => {
    const original = resume();
    original.experience = [job('recent', 'First Company', ['Built React interfaces.'])];
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ summary: original.summary, edits: [] }))
      .mockResolvedValueOnce(response({ edits: [{ sourceId: 'experience:0:0', text: 'Developed React interfaces.' }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'experience-only-retry' });
    expect(result.body.data.resume.experience[0].bullets[0].text).toBe('Developed React interfaces.');
    expect(result.body.data.matchComparison).toMatchObject({ status: 'completed', changedBullets: 1 });
    const request = JSON.parse(JSON.parse(fetch.mock.calls[1][1].body).messages[1].content);
    expect(request.jobDescription).toBe(jd);
    expect(request.bullets[0].keywords).toContain('react');
  });

  it('rewrites each relevant employer from its own evidence and exports a valid PDF', async () => {
    const original = resume();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(validOutput()));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'role-regression' });
    expect(result.status).toBe(200);
    const data = result.body.data;
    expect(data.resume.experience[0].bullets).toHaveLength(2);
    expect(data.resume.experience[0].bullets[0].text).toContain('Built React interfaces, integrated REST APIs');
    expect(data.resume.experience[1].bullets[0].text).toContain('TypeScript');
    expect(data.resume.experience[0].bullets.map(bullet => bullet.text).join(' ')).not.toContain('TypeScript');
    expect(data.resume.experience[2]).toEqual(original.experience[2]);
    for (const [index, entry] of data.resume.experience.entries()) for (const field of ['role', 'company', 'startDate', 'endDate']) expect(entry[field]).toBe(original.experience[index][field]);
    expect(data.tailoringReport.roles.map(role => role.status)).toEqual(['tailored', 'tailored', 'not_relevant']);
    expect(data.tailoringReport.roles[0].original_bullets).toEqual(original.experience[0].bullets.map(bullet => bullet.text));
    expect(data.tailoringReport.roles[0].tailored_bullet_evidence[0].evidence_references).toEqual(['experience:0:0', 'experience:0:1', 'experience:0:2']);
    expect(fetch).toHaveBeenCalledTimes(2);
    const request = JSON.parse(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content);
    expect(request.roles.map(role => role.role_id)).toEqual(['experience:0', 'experience:1', 'experience:2']);
    expect(request.candidateSkills).toEqual(['React']);
    expect((await createResumePdfDocument(data.resume)).output('arraybuffer').byteLength).toBeGreaterThan(5000);
  }, 15000);

  it('classifies absent testing tools as transferable/unverified and refuses to invent them', async () => {
    const original = resume(), evidence = buildCandidateEvidence(original, analyzeAtsLocally(original, jd));
    expect(evidence.requirements.find(row => row.term === 'playwright').classification).not.toBe('direct');
    const output = validOutput();
    output.roleRewrites[0].tailored_bullets[0].text = 'Built React interfaces and wrote Playwright tests.';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(output));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'no-testing-invention' });
    expect(result.body.data.resume.experience[0].bullets).toEqual(original.experience[0].bullets);
    expect(result.body.data.tailoringReport.roles[0].validation_failures).toContain('bullet:0:unsupported_claim_or_metric');
    expect(result.body.data.tailoringReport.claims_requiring_verification.some(item => item.term === 'playwright')).toBe(true);
  });

  it('accepts a substantive professional paraphrase only after a separate evidence review', async () => {
    const original = resume(), output = validOutput();
    output.roleRewrites[1].tailored_bullets[0].text = 'Engineered reusable components with React and TypeScript.';
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(output))
      .mockResolvedValueOnce(response({ approved: [{ role_id: 'experience:1', bullet_index: 0 }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'semantic-paraphrase' });
    expect(result.status).toBe(200);
    expect(result.body.data.resume.experience[1].bullets[0].text).toContain('Engineered reusable components');
    expect(result.body.data.tailoringReport.roles[1].validation_failures).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('rewrites a generic summary from the verified title and existing skills', async () => {
    const original = resume(), output = validOutput();
    original.summary = 'Developer looking for a good opportunity.';
    output.summary = 'Frontend Developer with React and TypeScript.';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(output));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'summary-rewrite' });
    expect(result.body.data.resume.summary).toBe('Frontend Developer with React and TypeScript.');
  });

  it('replaces generic summary filler deterministically when the provider repeats it', async () => {
    const original = resume(), output = validOutput();
    original.summary = 'Developer looking for a good opportunity.';
    output.summary = original.summary;
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(output))
      .mockResolvedValueOnce(response({ summary: original.summary }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'summary-fallback' });
    expect(result.body.data.resume.summary).toBe('Frontend Developer with React.');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('repairs invented qualitative outcomes instead of accepting or silently keeping them', async () => {
    const original = resume(), output = validOutput();
    output.roleRewrites[0].tailored_bullets[0] = { text: 'Built React interfaces, enhancing customer engagement and consistency.', evidence_references: ['experience:0:0'] };
    const repaired = { edits: [], summary: '', merges: [], educationEdits: [], roleRewrites: [{ role_id: 'experience:0', tailored_bullets: [
      { text: 'Developed React interfaces.', evidence_references: ['experience:0:0'] },
      { text: 'Integrated REST APIs and handled dynamic data rendering.', evidence_references: ['experience:0:1'] },
      { text: 'Handled API error states.', evidence_references: ['experience:0:2'] },
      { text: 'Improved load time by 20%.', evidence_references: ['experience:0:3'] },
    ] }] };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(output)).mockResolvedValueOnce(response(repaired));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'outcome-protection' });
    expect(result.body.data.resume.experience[0].bullets[0].text).toBe('Developed React interfaces.');
    expect(result.body.data.resume.experience[0].bullets.map(bullet => bullet.text).join(' ')).not.toContain('customer engagement');
    expect(result.body.data.tailoringReport.roles[0].validation_failures).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('uses verified master evidence only for matching candidate, employer, title and dates', () => {
    const original = resume(), master = structuredClone(original);
    master.experience[0].bullets.push({ id: 'verified-ts', text: 'Built React interfaces with TypeScript.' });
    master.experience[1].bullets.push({ id: 'verified-testing', text: 'Maintained Playwright tests.' });
    const evidence = buildCandidateEvidence(original, analyzeAtsLocally(original, jd), { verifiedCareerProfile: master });
    const first = evidence.roles[0];
    expect(first.sources.some(source => source.origin === 'verified_profile' && source.text.includes('TypeScript'))).toBe(true);
    expect(first.sources.some(source => source.text.includes('Playwright'))).toBe(false);
    expect(first.matches.find(match => match.term === 'typescript').classification).toBe('direct');
    master.experience[0].startDate = '2020';
    expect(buildCandidateEvidence(original, analyzeAtsLocally(original, jd), { verifiedCareerProfile: master }).roles[0].sources.some(source => source.origin === 'verified_profile')).toBe(false);
    master.name = 'Different Candidate';
    expect(buildCandidateEvidence(original, analyzeAtsLocally(original, jd), { verifiedCareerProfile: master }).roles[1].sources.some(source => source.origin === 'verified_profile')).toBe(false);
  });
  it('recovers verified master skills without inventing their employer association', async () => {
    const original = resume(), master = structuredClone(original);
    master.skillGroups[0].skills.push('Playwright');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(validOutput()));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, verifiedCareerProfile: master, jobDescription: jd } }, { GROQ_API_KEY: 'verified-global-skill' });
    expect(result.body.data.resume.skillGroups.flatMap(group => group.skills)).toContain('Playwright');
    expect(result.body.data.resume.experience.flatMap(entry => entry.bullets).map(bullet => bullet.text).join(' ')).not.toContain('Playwright');
    expect(result.body.data.tailoringReport.requirements.find(row => row.term === 'playwright')).toMatchObject({ known_from_profile: true, classification: 'direct', listed_outside_experience: true });
  });

  it('rejects cross-employer citations and new metrics without asking AI to approve them', () => {
    const original = resume(), evidence = buildCandidateEvidence(original, analyzeAtsLocally(original, jd));
    const rewrite = validOutput().roleRewrites[0];
    rewrite.tailored_bullets[0].evidence_references = ['experience:1:0'];
    expect(validateRoleRewrite(evidence.roles[0], rewrite)).toContain('bullet:0:invalid_evidence_reference');
    rewrite.tailored_bullets[0] = { text: 'Improved load time by 90%.', evidence_references: ['experience:0:3'] };
    expect(validateRoleRewrite(evidence.roles[0], rewrite)).toContain('bullet:0:unsupported_claim_or_metric');
  });
  it('rejects a consolidated role bullet that cites but drops a named source tool', () => {
    const original = resume(), evidence = buildCandidateEvidence(original, analyzeAtsLocally(original, jd));
    const rewrite = validOutput().roleRewrites[1];
    rewrite.tailored_bullets[0].text = 'Developed reusable components.';
    expect(validateRoleRewrite(evidence.roles[1], rewrite)).toContain('bullet:0:dropped_source_tool_or_metric');
  });
  it('retains original achievements and required verified skills when condensing a role', () => {
    const original = resume(), evidence = buildCandidateEvidence(original, analyzeAtsLocally(original, jd));
    const rewrite = validOutput().roleRewrites[0];
    rewrite.tailored_bullets.pop();
    expect(validateRoleRewrite(evidence.roles[0], rewrite)).toContain('role:changed_or_dropped_metric');
    expect(validateRoleRewrite(evidence.roles[1], { role_id: 'experience:1', tailored_bullets: [{ text: 'Built reusable React components.', evidence_references: ['experience:1:0'] }] })).toContain('role:omitted_verified_requirement');
  });

  it('rejects a polished bullet that drops a source responsibility or an entire unquantified bullet', () => {
    const original = resume(), evidence = buildCandidateEvidence(original, analyzeAtsLocally(original, jd));
    const rewrite = validOutput().roleRewrites[0];
    rewrite.tailored_bullets[0].text = 'Integrated REST APIs and handled API error states.';
    expect(validateRoleRewrite(evidence.roles[0], rewrite)).toContain('bullet:0:needs_semantic_review');
    rewrite.tailored_bullets[0].text = 'Built React interfaces, integrated REST APIs, handled dynamic data rendering, and handled API error states.';
    rewrite.tailored_bullets[0].evidence_references = ['experience:0:0', 'experience:0:1'];
    expect(validateRoleRewrite(evidence.roles[0], rewrite)).toContain('role:omitted_source_bullet');
  });

  it('checks historical fields and credentials independently of AI output', () => {
    const original = resume(), candidate = structuredClone(original);
    candidate.experience[0].company = 'Invented Company';
    expect(() => assertSourceHistory(original, candidate)).toThrow(/historical/);
    candidate.experience = structuredClone(original.experience);
    candidate.certifications.push({ id: 'new', name: 'Invented certification' });
    expect(() => assertSourceHistory(original, candidate)).toThrow(/credentials/);
  });
  it('rejects changed measurement units as well as changed numbers', () => {
    const original = resume();
    original.experience[0].bullets[3].text = 'Improved load time by 20 milliseconds.';
    const evidence = buildCandidateEvidence(original, analyzeAtsLocally(original, jd));
    const rewrite = validOutput().roleRewrites[0];
    rewrite.tailored_bullets[1].text = 'Improved load time by 20 seconds.';
    expect(validateRoleRewrite(evidence.roles[0], rewrite)).toContain('bullet:1:unsupported_claim_or_metric');
  });

  it('never lets a secondary model approve an unsupported technology in legacy responses', async () => {
    const original = resume();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ edits: [{ sourceId: 'experience:0:0', text: 'Built React interfaces with TypeScript and Playwright.' }] }));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'legacy-unsupported-tool' });
    expect(result.body.data.resume.experience[0].bullets[0].text).not.toContain('Playwright');
    expect(result.body.data.tailoringReport.roles[0].validation_failures).toContain('generation:unsupported_or_unverified_claim');
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).response_format.json_schema.name)).toEqual(['bullet_edits', 'experience_only_rephrase']);
  });

  it('preserves additional quantified achievements when backed by matching master evidence', () => {
    const original = resume(), master = structuredClone(original);
    master.experience[0].bullets.push({ id: 'new-metric', text: 'Reduced API failures by 10%.' });
    const evidence = buildCandidateEvidence(original, analyzeAtsLocally(original, jd), { verifiedCareerProfile: master });
    const rewrite = validOutput().roleRewrites[0];
    rewrite.tailored_bullets.push({ text: 'Reduced API failures by 10%.', evidence_references: ['profile:experience:0:4'] });
    expect(validateRoleRewrite(evidence.roles[0], rewrite)).toEqual([]);
  });

  it.each(['{', { roleRewrites: [] }, { roleRewrites: [{ role_id: 'experience:0', tailored_bullets: [{ text: 'Built React interfaces.' }] }] }])('retains source on malformed or empty role output: %j', async output => {
    const original = resume();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(typeof output === 'string' ? { ok: true, json: async () => ({ choices: [{ message: { content: output } }] }) } : response(output));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'bad-role-output' });
    expect(result.body.data.matchComparison.status).toBe('unavailable');
    expect(result.body.data.resume.experience).toEqual(original.experience);
  });

  it('handles Groq rate limits without accepting generated resume claims', async () => {
    const original = resume();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 429, headers: { get: () => '60' }, json: async () => ({}) });
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'role-rate-limit' });
    expect(result.body.data.matchComparison.status).toBe('unavailable');
    expect(result.body.data.resume.experience).toEqual(original.experience);
  });

  it('keeps unrelated history and missing-configuration results explicit', async () => {
    const original = resume();
    const noConfig = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, {});
    expect(noConfig.body.data.matchComparison.status).toBe('unavailable');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, request) => {
      const input = JSON.parse(JSON.parse(request.body).messages[1].content);
      return response({ edits: [], roleRewrites: input.roles.map(role => ({ role_id: role.role_id, tailored_bullets: role.sources.filter(source => source.origin === 'resume').map(source => ({ text: source.text, evidence_references: [source.id] })) })) });
    });
    const unrelated = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: 'Required: payroll reconciliation, tax compliance and financial audit preparation for an accounting role.' } }, { GROQ_API_KEY: 'unrelated-role' });
    expect(unrelated.body.data.resume.experience).toEqual(original.experience);
    expect(unrelated.body.data.tailoringReport.roles.every(role => role.status === 'not_relevant')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps accepted roles when another role is omitted', async () => {
    const original = resume(), output = validOutput();
    output.roleRewrites.pop();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(output));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'incomplete-role-output' });
    expect(result.body.data.matchComparison.status).toBe('completed');
    expect(result.body.data.resume.experience[0].bullets[0].text).toContain('Built React interfaces, integrated REST APIs');
    expect(result.body.data.resume.experience[2]).toEqual(original.experience[2]);
  });

  it('processes more than sixteen relevant source bullets in bounded role batches', async () => {
    const original = resume();
    original.experience = Array.from({ length: 7 }, (_, index) => job(`role-${index}`, `Employer ${index}`, ['Built React interfaces.', 'Built reusable React components.', 'Maintained React applications.']));
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, request) => {
      const input = JSON.parse(JSON.parse(request.body).messages[1].content);
      return response({ edits: [], roleRewrites: input.roles.map(role => ({ role_id: role.role_id, tailored_bullets: role.sources.map(source => ({ text: source.text.replace(/^Built /, 'Developed '), evidence_references: [source.id] })) })) });
    });
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'batch-roles' });
    expect(result.body.data.tailoringReport.roles).toHaveLength(7);
    expect(result.body.data.tailoringReport.roles.every(role => role.status === 'tailored')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not turn an unassigned skill confirmation into employer evidence', () => {
    const original = resume(), evidence = buildCandidateEvidence(original, analyzeAtsLocally(original, jd), { confirmations: [{ term: 'Playwright', entryId: '' }] });
    expect(evidence.roles.flatMap(role => role.sources).some(source => source.origin === 'user_role_confirmation')).toBe(false);
    expect(evidence.claims_requiring_verification.some(item => item.reason.includes('no employer'))).toBe(true);
  });

  it('logs stages and counts without private text, API keys or provider bodies', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(validOutput()));
    await handleAIRequest({ action: 'tailor', payload: { masterResume: resume(), jobDescription: jd } }, { GROQ_API_KEY: 'never-log-this-secret', AI_DEBUG: 'true' });
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain('evidence_matching'); expect(output).toContain('experience_validation');
    for (const value of ['never-log-this-secret', 'Alex Example', 'First Company', 'alex@example.com', 'Built React interfaces']) expect(output).not.toContain(value);
  });
});
