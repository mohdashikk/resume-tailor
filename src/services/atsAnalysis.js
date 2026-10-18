import { z } from 'zod';
import { cleanKeywordTerms } from './jobKeywords.js';

export const ANALYSIS_VERSION = 'requirements-v11-concise-keywords';
export const isRequirementHeading = text => /^(?:(?:essential|key|core|main|job|primary)\s+responsibilities|responsibilities|(?:minimum|required|preferred|basic)\s+qualifications|(?:required|preferred|technical|key)\s+skills|(?:job|role|professional)\s+(?:summary|requirements|overview|description)|must.have\s+skills\s*&?\s*experience|summary)\s*:?$/i.test(String(text).trim());
export function requirementText(jd) {
  let excluded = false;
  return String(jd || '').split(/\r?\n/).filter((line) => {
    const clean = line.trim();
    if (/^(?:benefits|perks|compensation|about us|about the company)\s*:?$/i.test(clean)) { excluded = true; return false; }
    if (/^(?:requirements|qualifications|responsibilities|what you.ll do|must.have|required(?: skills| qualifications)?|preferred(?: skills| qualifications)?|nice.to.have)\s*:?$/i.test(clean)) excluded = false;
    return !excluded;
  }).join('\n').split(/(?<=[!?;])\s+|(?<=\.)\s+(?=[A-Z])/)
    .filter((sentence) => !/\b(?:not required|no .{0,50} required|no experience necessary)\b/i.test(sentence)).join('\n');
}
export const normalizeText = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export const aliases = { 'react.js': 'react', reactjs: 'react', js: 'javascript', ts: 'typescript', html5: 'html', css3: 'css', 'rest apis': 'rest api', 'restful apis': 'rest api', 'restful api': 'rest api', 'nodejs': 'node.js', 'node js': 'node.js', 'nextjs': 'next.js', 'next js': 'next.js', 'a11y': 'accessibility', 'responsive web design': 'responsive design', 'unit tests': 'unit testing', 'automated unit testing': 'unit testing', 'ci / cd': 'ci/cd', 'continuous integration and continuous delivery': 'ci/cd' };
export const canonicalTerm = (s) => aliases[normalizeText(s)] || normalizeText(s);
export function normalizeAliases(text) {
  let result = normalizeText(text);
  for (const [alias, canonical] of Object.entries(aliases).sort((a, b) => b[0].length - a[0].length)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(^|[^a-z0-9+#])${escaped}(?=$|[^a-z0-9+#])`, 'g'), (_, prefix) => prefix + (alias === 'js' && prefix === '.' ? alias : canonical));
  }
  result = result.replace(/\baccessible\b/g, 'accessibility').replace(/\buser experience\b/g, 'ux')
    .replace(/\bcollaborat(?:ed|ing|e)\b/g, 'collaboration')
    .replace(/\bcross[- ]browser compatib(?:le|ility)\b/g, 'cross-browser compatibility')
    .replace(/\bcomponent[- ]based architectur(?:e|es)\b/g, 'component architecture');
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
    if (isRequirementHeading(item.term)) continue;
    const term = canonicalTerm(item.term.replace(/^(?:use of|experience (?:with|in|using)|knowledge of|familiarity with|understanding of|ability to use|working knowledge of)\s+/i, '').replace(/[.;]+$/, ''));
    if (['experience', 'skills', 'developer', 'requirements'].includes(term) || !normalizeText(jd).includes(normalizeText(item.source))) throw new Error('Invalid extracted requirements. Please retry ATS analysis.');
    const evidence = item.evidence.filter((quote) => evidenceText.includes(normalizeText(quote)));
    // Direct, positive evidence must not be lost just because AI labeled an
    // explicitly listed skill as missing. Never infer qualified tenure/ability.
    const simpleSkill = term.split(/\s+/).length <= 5 && !/\b(?:years?|expert|advanced|strong|proficien\w*|degree|bachelor|master|certif\w*|license)\b/i.test(term);
    if (simpleSkill) {
      for (const quote of resumeEvidence(resume).split('\n')) {
        if (evidence.length < 10 && !/\b(?:no|not|without|never|lack\w*)\b/i.test(quote) && containsTerm(normalizeAliases(quote), normalizeAliases(term)) && !evidence.some(existing => normalizeText(existing) === normalizeText(quote))) evidence.push(quote.slice(0, 2000));
      }
    }
    // Literal technologies require that technology in the cited evidence, not an
    // unrelated quote (e.g. React cannot prove Jest or accessibility).
    const concept = /accessib/i.test(term) ? /accessib|wcag|screen reader|aria/i : /responsive/i.test(term) ? /responsive|mobile.first|breakpoint|media quer/i : null;
    const validLiteralEvidence = (!literalSkills.has(term) || evidence.some((quote) => containsTerm(normalizeAliases(quote), term))) && (!concept || evidence.some((quote) => concept.test(quote)));
    const direct = simpleSkill && evidence.some(quote => !/\b(?:no|not|without|never|lack\w*)\b/i.test(quote) && containsTerm(normalizeAliases(quote), normalizeAliases(term)));
    const status = direct && validLiteralEvidence ? 'matched' : item.status === 'matched' && (!evidence.length || !validLiteralEvidence) ? 'uncertain' : item.status;
    const previous = byTerm.get(term);
    if (!previous) byTerm.set(term, { ...item, term, status, evidence });
    else {
      if (previous.status !== status) throw new Error('Conflicting requirement assessments. Please retry ATS analysis.');
      if (item.priority === 'required') previous.priority = 'required';
    }
  }
  const rows = [...byTerm.values()].sort((a, b) => a.term.localeCompare(b.term));
  if (!rows.length) throw new Error('No job requirements were identified beyond section headings. Paste the full job description.');
  // Reject obviously incomplete extraction instead of presenting perfect coverage
  // when a named technology in the posting was silently omitted.
  for (const term of literalSkills) {
    if (containsTerm(normalizeAliases(requirementText(jd)), term) && !rows.some((row) => containsTerm(normalizeAliases(row.term), term))) {
      throw new Error(`The analysis omitted ${term}. Please retry ATS analysis.`);
    }
  }
  const matched = rows.filter((r) => r.status === 'matched').map((r) => r.term);
  const missing = rows.filter((r) => r.status === 'missing').map((r) => r.term);
  const uncertain = rows.filter((r) => r.status === 'uncertain').map((r) => r.term);
  const totalWeight = rows.reduce((n, r) => n + (r.priority === 'required' ? 3 : 1), 0);
  const earnedWeight = rows.reduce((n, r) => n + (r.status === 'matched' ? (r.priority === 'required' ? 3 : 1) : 0), 0);
  const score = Math.round(100 * earnedWeight / totalWeight);
  const keywords = new Map();
  const resumeQuotes = resumeEvidence(resume).split('\n').filter(quote => !/\b(?:no|not|without|never|lack\w*)\b/i.test(quote));
  for (const row of rows) for (const value of cleanKeywordTerms(row.term)) {
    const term = canonicalTerm(value);
    // The canonical keyword must actually occur in the posting, not be a
    // suggestion hallucinated by the extractor.
    if (!containsTerm(normalizeAliases(jd), normalizeAliases(term)) && !cleanKeywordTerms(row.source).some(item => canonicalTerm(item) === term)) continue;
    const direct = resumeQuotes.some(quote => containsTerm(normalizeAliases(quote), normalizeAliases(term)));
    const status = direct ? 'matched' : canonicalTerm(row.term) === term ? row.status : 'missing';
    const old = keywords.get(term);
    if (!old || status === 'matched' || (old === 'missing' && status === 'uncertain')) keywords.set(term, status);
  }
  const keywordRows = [...keywords].sort(([a], [b]) => a.localeCompare(b));
  const keywordMatched = keywordRows.filter(([, status]) => status === 'matched').map(([term]) => term);
  return { version: ANALYSIS_VERSION, key: analysisKey(resume, jd), requirements: rows, score,
    match: { keywords: keywordRows.map(([term]) => term), matched: keywordMatched, missing: keywordRows.filter(([, status]) => status === 'missing').map(([term]) => term), uncertain: keywordRows.filter(([, status]) => status === 'uncertain').map(([term]) => term), coverage: keywordRows.length ? Math.round(100 * keywordMatched.length / keywordRows.length) : 0 },
    summary: `${matched.length} of ${rows.length} requirements have resume evidence; ${missing.length} lack evidence and ${uncertain.length} need review. Required qualifications carry three times the weight of preferred qualifications. This is an app match estimate; review unfamiliar requirements manually.`,
    strengths: matched, gaps: [...missing, ...uncertain], nextSteps: [...missing, ...uncertain].map((term) => `Review evidence for ${term}. Add details only if truthful.`),
    rubric: { earnedWeight, totalWeight, requiredWeight: 3, preferredWeight: 1 },
  };
}
export function validateAnalysis(report, resume, jd) {
  if (report?.version !== ANALYSIS_VERSION || report.key !== analysisKey(resume, jd)) throw new Error('This ATS analysis is outdated. Please run the check again.');
  return { ...buildAnalysis({ requirements: report.requirements }, resume, jd), ...(report.method === 'ai' ? { method: 'ai' } : {}) };
}
// Reuse one JD rubric when comparing documents. Never extract a different set of
// requirements for the tailored copy or silently reuse its source's score.
export function rescoreAnalysis(report, resume, jd) {
  const quotes = resumeEvidence(resume).split('\n').filter(Boolean);
  const requirements = report.requirements.map(row => {
    const retained = quotes.filter(quote => !/\b(?:no|not|without|never|lack\w*)\b/i.test(quote) && row.evidence.some(old => normalizeText(quote).includes(normalizeText(old))));
    const direct = quotes.filter(quote => !/\b(?:no|not|without|never|lack\w*)\b/i.test(quote) && containsTerm(normalizeAliases(quote), normalizeAliases(row.term)));
    const evidence = [...new Set([...retained, ...direct])].slice(0, 10);
    return { ...row, status: evidence.length ? (row.status === 'uncertain' && !direct.length ? 'uncertain' : 'matched') : row.status === 'uncertain' ? 'uncertain' : 'missing', evidence };
  });
  return buildAnalysis({ requirements }, resume, jd);
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
