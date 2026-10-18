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
    { text: 'Integrated REST APIs into React interfaces and handled dynamic data rendering and API error states.', evidence_references: ['experience:0:0', 'experience:0:1', 'experience:0:2'] },
    { text: 'Improved load time by 20%.', evidence_references: ['experience:0:3'] },
  ] },
  { role_id: 'experience:1', tailored_bullets: [{ text: 'Developed reusable React components with TypeScript.', evidence_references: ['experience:1:0'] }] },
] });
afterEach(() => vi.restoreAllMocks());

describe('role evidence tailoring pipeline', () => {
  it('rewrites each relevant employer from its own evidence and exports a valid PDF', async () => {
    const original = resume();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(validOutput()));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'role-regression' });
    expect(result.status).toBe(200);
    const data = result.body.data;
    expect(data.resume.experience[0].bullets).toHaveLength(2);
    expect(data.resume.experience[0].bullets[0].text).toContain('REST APIs into React interfaces');
    expect(data.resume.experience[1].bullets[0].text).toContain('TypeScript');
    expect(data.resume.experience[0].bullets.map(bullet => bullet.text).join(' ')).not.toContain('TypeScript');
    expect(data.resume.experience[2]).toEqual(original.experience[2]);
    for (const [index, entry] of data.resume.experience.entries()) for (const field of ['role', 'company', 'startDate', 'endDate']) expect(entry[field]).toBe(original.experience[index][field]);
    expect(data.tailoringReport.roles.map(role => role.status)).toEqual(['tailored', 'tailored', 'not_relevant']);
    expect(data.tailoringReport.roles[0].original_bullets).toEqual(original.experience[0].bullets.map(bullet => bullet.text));
    expect(data.tailoringReport.roles[0].tailored_bullet_evidence[0].evidence_references).toEqual(['experience:0:0', 'experience:0:1', 'experience:0:2']);
    expect(fetch).toHaveBeenCalledOnce();
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
  it('retains original achievements and required verified skills when condensing a role', () => {
    const original = resume(), evidence = buildCandidateEvidence(original, analyzeAtsLocally(original, jd));
    const rewrite = validOutput().roleRewrites[0];
    rewrite.tailored_bullets.pop();
    expect(validateRoleRewrite(evidence.roles[0], rewrite)).toContain('role:changed_or_dropped_metric');
    expect(validateRoleRewrite(evidence.roles[1], { role_id: 'experience:1', tailored_bullets: [{ text: 'Built reusable React components.', evidence_references: ['experience:1:0'] }] })).toContain('role:omitted_verified_requirement');
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
    expect(fetch).toHaveBeenCalledOnce();
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
    const fetch = vi.spyOn(globalThis, 'fetch');
    const unrelated = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: 'Required: payroll reconciliation, tax compliance and financial audit preparation for an accounting role.' } }, { GROQ_API_KEY: 'unrelated-role' });
    expect(unrelated.body.data.resume.experience).toEqual(original.experience);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('handles omitted role output atomically with a visible unavailable status', async () => {
    const original = resume(), output = validOutput();
    output.roleRewrites.pop();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(output));
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: original, jobDescription: jd } }, { GROQ_API_KEY: 'incomplete-role-output' });
    expect(result.body.data.matchComparison.status).toBe('unavailable');
    expect(result.body.data.resume.experience).toEqual(original.experience);
    expect(result.body.data.tailoringReport.roles[0].validation_failures).toContain('generation:unavailable_or_invalid');
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
