import { z } from 'zod';

export const ANALYSIS_VERSION = 'requirements-v2';
export const normalizeText = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const aliases = { 'react.js': 'react', reactjs: 'react', js: 'javascript', ts: 'typescript', html5: 'html', css3: 'css', 'rest apis': 'rest api', 'restful apis': 'rest api', 'ci / cd': 'ci/cd', 'continuous integration and continuous delivery': 'ci/cd' };
export const canonicalTerm = (s) => aliases[normalizeText(s)] || normalizeText(s);
export function normalizeAliases(text) {
  let result = normalizeText(text);
  for (const [alias, canonical] of Object.entries(aliases).sort((a, b) => b[0].length - a[0].length)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(^|[^a-z0-9+#])${escaped}(?=$|[^a-z0-9+#])`, 'g'), (_, prefix) => prefix + canonical);
  }
  return result;
}
const literalSkills = new Set(['react', 'react native', 'java', 'javascript', 'typescript', 'html', 'css', 'git', 'rest api', 'jest', 'redux', 'ci/cd', 'python', 'node.js', 'sql', 'c', 'c++', 'c#']);
export function containsTerm(text, term) {
  if (term.toLowerCase() === 'react') text = text.replace(/\breact native\b/gi, '');
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`, 'i').test(text);
}
export function resumeEvidence(resume) {
  const walk = (v) => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(walk) : v && typeof v === 'object' ? Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).filter(([k]) => !['id', 'masterId', 'ambiguities'].includes(k)).flatMap(([, x]) => walk(x)) : [];
  return walk(resume).filter(Boolean).join('\n');
}
export function analysisKey(resume, jd) { return JSON.stringify([ANALYSIS_VERSION, normalizeText(resumeEvidence(resume)), normalizeText(jd)]); }
export function assertSupportedTechnologies(source, candidate, jd) {
  const original = normalizeAliases(resumeEvidence(source));
  const proposed = normalizeAliases(resumeEvidence(candidate));
  for (const term of literalSkills) {
    if (containsTerm(normalizeAliases(jd), term) && !containsTerm(original, term) && containsTerm(proposed, term)) {
      throw new Error(`The tailored resume introduced unsupported ${term}. Please retry.`);
    }
  }
}
const requirementSchema = z.object({
  term: z.string().trim().min(1).max(200), priority: z.enum(['required', 'preferred']),
  source: z.string().trim().min(2).max(2000), status: z.enum(['matched', 'missing', 'uncertain']),
  evidence: z.array(z.string().trim().min(2).max(2000)).max(10),
}).strict();
export const extractionSchema = z.object({ requirements: z.array(requirementSchema).min(1).max(150) }).strict();
export const extractionJsonSchema = z.toJSONSchema(extractionSchema);
export function buildAnalysis(raw, resume, jd) {
  const { requirements } = extractionSchema.parse(raw);
  const evidenceText = normalizeText(resumeEvidence(resume));
  const byTerm = new Map();
  for (const item of requirements) {
    const term = canonicalTerm(item.term);
    if (['experience', 'skills', 'developer', 'requirements'].includes(term) || !normalizeText(jd).includes(normalizeText(item.source))) throw new Error('Invalid extracted requirements. Please retry ATS analysis.');
    const evidence = item.evidence.filter((quote) => evidenceText.includes(normalizeText(quote)));
    // Literal technologies require that technology in the cited evidence, not an
    // unrelated quote (e.g. React cannot prove Jest or accessibility).
    const concept = /accessib/i.test(term) ? /accessib|wcag|screen reader|aria/i : /responsive/i.test(term) ? /responsive|mobile.first|breakpoint|media quer/i : null;
    const validLiteralEvidence = (!literalSkills.has(term) || evidence.some((quote) => containsTerm(normalizeAliases(quote), term))) && (!concept || evidence.some((quote) => concept.test(quote)));
    const status = item.status === 'matched' && (!evidence.length || !validLiteralEvidence) ? 'uncertain' : item.status;
    const previous = byTerm.get(term);
    if (!previous) byTerm.set(term, { ...item, term, status, evidence });
    else {
      if (previous.status !== status) throw new Error('Conflicting requirement assessments. Please retry ATS analysis.');
      if (item.priority === 'required') previous.priority = 'required';
    }
  }
  const rows = [...byTerm.values()].sort((a, b) => a.term.localeCompare(b.term));
  // Reject obviously incomplete extraction instead of presenting perfect coverage
  // when a named technology in the posting was silently omitted.
  for (const term of literalSkills) {
    if (containsTerm(normalizeAliases(jd), term) && !rows.some((row) => containsTerm(normalizeAliases(row.term), term))) {
      throw new Error(`The analysis omitted ${term}. Please retry ATS analysis.`);
    }
  }
  const matched = rows.filter((r) => r.status === 'matched').map((r) => r.term);
  const missing = rows.filter((r) => r.status === 'missing').map((r) => r.term);
  const uncertain = rows.filter((r) => r.status === 'uncertain').map((r) => r.term);
  const totalWeight = rows.reduce((n, r) => n + (r.priority === 'required' ? 2 : 1), 0);
  const earnedWeight = rows.reduce((n, r) => n + (r.status === 'matched' ? (r.priority === 'required' ? 2 : 1) : 0), 0);
  const score = Math.round(100 * earnedWeight / totalWeight);
  return { version: ANALYSIS_VERSION, key: analysisKey(resume, jd), requirements: rows, score,
    match: { keywords: rows.map((r) => r.term), matched, missing, uncertain, coverage: Math.round(100 * matched.length / rows.length) },
    summary: `${matched.length} of ${rows.length} requirements have resume evidence; ${missing.length} lack evidence and ${uncertain.length} need review. Required qualifications carry twice the weight of preferred qualifications.`,
    strengths: matched, gaps: [...missing, ...uncertain], nextSteps: [...missing, ...uncertain].map((term) => `Review evidence for ${term}. Add details only if truthful.`),
    rubric: { earnedWeight, totalWeight, requiredWeight: 2, preferredWeight: 1 },
  };
}
export function validateAnalysis(report, resume, jd) {
  if (report?.version !== ANALYSIS_VERSION || report.key !== analysisKey(resume, jd)) throw new Error('This ATS analysis is outdated. Please run the check again.');
  return buildAnalysis({ requirements: report.requirements }, resume, jd);
}
export function readCachedAnalysis(resume, jd, storage = globalThis.localStorage) {
  try { return validateAnalysis(JSON.parse(storage?.getItem('doitnext:ats:v1') || 'null')[analysisKey(resume, jd)], resume, jd); } catch { return null; }
}
export function cacheAnalysis(report, resume, jd, storage = globalThis.localStorage) {
  const validated = validateAnalysis(report, resume, jd);
  try {
    let entries; try { entries = JSON.parse(storage.getItem('doitnext:ats:v1') || '{}'); } catch { entries = {}; }
    const recent = Object.entries(entries || {}).slice(-9);
    storage.setItem('doitnext:ats:v1', JSON.stringify({ ...Object.fromEntries(recent), [validated.key]: validated }));
  } catch { /* cache storage is optional */ }
  return validated;
}
