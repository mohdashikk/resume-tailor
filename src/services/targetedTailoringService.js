import { z } from 'zod';
import { aliases, containsTerm, normalizeAliases } from './atsAnalysis.js';
import { detectDeveloperProfile, keywordCategory } from './profileKeywords.js';
import { prioritizeSkillsForJob } from './skillTailoringService.js';
import { groupSkillsByCategory } from './skillGroupingService.js';
import { namedKeywordTerms } from './jobKeywords.js';

export const bulletEditsSchema = z.object({ edits: z.array(z.object({
  sourceId: z.string(), text: z.string().trim().min(1).max(1200),
}).strict()).max(16) }).strict();

export const contentRewriteSchema = bulletEditsSchema.extend({
  edits: bulletEditsSchema.shape.edits.default([]),
  roleRewrites: z.array(z.object({
    role_id: z.string(),
    tailored_bullets: z.array(z.object({ text: z.string().trim().min(1).max(600), evidence_references: z.array(z.string()).min(1).max(8) }).strict()).min(1).max(12),
  }).strict()).max(50).default([]),
  summary: z.string().max(2000).default(''),
  educationEdits: z.array(z.object({ sourceId: z.string(), text: z.string().max(350) }).strict()).max(30).default([]),
  merges: z.array(z.object({ sourceIds: z.array(z.string()).min(2).max(4), text: z.string().trim().min(1).max(1200) }).strict()).max(8).default([]),
}).strict();

// Selected skills are user-confirmed. Match them to an existing task, rather
// than requiring that the bullet already contain the keyword being added.
const taskContexts = [
  [/\b(?:react|redux|typescript|javascript|html|css|vite|webpack|angular|vue|next\.js)\b/i, /\b(?:react|frontend|front.end|interfaces?|components?|web applications?|ui|screens?)\b/i],
  [/\b(?:testing|tests?|jest|cypress|playwright|sonarqube|eslint)\b/i, /\b(?:tests?|testing|quality|regressions?|defects?|code reviews?|lint\w*)\b/i],
  [/\b(?:accessibility|wcag|responsive design|storybook)\b/i, /\b(?:accessib\w*|responsive|components?|design systems?|interfaces?)\b/i],
  [/\b(?:node\.js|express|sql|postgresql|mongodb|rest api|graphql)\b/i, /\b(?:backend|back.end|apis?|databases?|queries|server)\b/i],
  [/\b(?:docker|nginx|ci\/cd|cloud.hosted applications)\b/i, /\b(?:deploy\w*|containers?|pipelines?|hosting|infrastructure|cloud)\b/i],
  [/\b(?:websocket|real.time|asynchronous flows)\b/i, /\b(?:real.time|stream\w*|socket\w*|asynchronous|live updates?|events?)\b/i],
  [/\b(?:agile|communication|collaboration)\b/i, /\b(?:collaborat\w*|teams?|sprints?|stakeholders?|planning|reviews?)\b/i],
];

export function placementScore(text, term) {
  if (/\b(?:no|not|without|never|lack\w*)\b/i.test(text)) return 0;
  if (containsTerm(normalizeAliases(text), normalizeAliases(term))) return 3;
  return taskContexts.some(([skill, context]) => skill.test(normalizeAliases(term)) && context.test(normalizeAliases(text))) ? 1 : 0;
}

export function resolveSkillPlacements(resume, confirmations) {
  return confirmations.map(item => {
    if (item.entryId) return item;
    // A related task is transferable evidence, not proof that a technology was
    // used at this employer. Unassigned confirmations establish Skills only.
    const entry = resume.experience.find(role => role.bullets.some(bullet => placementScore(bullet.text, item.term) === 3));
    return { ...item, entryId: entry?.id || '' };
  });
}

// Give each confirmed skill one narrative destination, rather than sending the
// same list to every bullet and the summary.
export function planKeywordDistribution(resume, confirmations, selected) {
  const summaryTerms = [], skillTerms = [];
  const unique = [...new Map(confirmations.map(item => [normalizeAliases(item.term), item])).values()];
  for (const item of unique) {
    const entryIndex = resume.experience.findIndex(entry => entry.id === item.entryId);
    const entry = resume.experience[entryIndex];
    if (entry?.bullets.length) {
      const candidates = entry.bullets.map((bullet, index) => ({ bullet, index,
        source: selected.find(row => row.sourceId === `experience:${entryIndex}:${index}`) }));
      candidates.sort((a, b) =>
        Number(placementScore(b.bullet.text, item.term) > 0) - Number(placementScore(a.bullet.text, item.term) > 0)
        || (a.source?.confirmedKeywords?.length || 0) - (b.source?.confirmedKeywords?.length || 0)
        || placementScore(b.bullet.text, item.term) - placementScore(a.bullet.text, item.term));
      const { bullet, index } = candidates[0];
      const sourceId = `experience:${entryIndex}:${index}`;
      let source = selected.find(row => row.sourceId === sourceId);
      if (!source) {
        source = { sourceId, section: 'experience', entryIndex, index, bulletId: bullet.id, text: bullet.text, keywords: [] };
        selected.unshift(source);
      }
      source.confirmedKeywords = [...(source.confirmedKeywords || []), item.term];
    } else {
      // Technical/tool skills belong in Skills; a short summary can highlight
      // at most two broader capabilities without becoming a keyword list.
      if (/\b(?:collaboration|communication|agile|problem solving|leadership)\b/i.test(item.term) && summaryTerms.length < 2) summaryTerms.push(item.term);
      else skillTerms.push(item.term);
    }
  }
  selected.sort((a, b) => Number(Boolean(b.confirmedKeywords?.length)) - Number(Boolean(a.confirmedKeywords?.length)));
  return { summaryTerms, skillTerms, terms: unique.map(item => item.term) };
}

export function respectsKeywordPlacement(original, proposed, terms, allowed = []) {
  const count = (text, term) => {
    const escaped = normalizeAliases(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...normalizeAliases(text).matchAll(new RegExp(`(^|[^a-z0-9+#])${escaped}(?=$|[^a-z0-9+#])`, 'g'))].length;
  };
  return terms.every(term => count(proposed, term) <= Math.max(count(original, term), allowed.some(value => normalizeAliases(value) === normalizeAliases(term)) ? 1 : 0));
}

export function finishKeywordDistribution(original, resume, terms) {
  const narrative = [resume.summary, ...['experience', 'projects'].flatMap(section => resume[section].flatMap(entry => entry.bullets.map(bullet => bullet.text)))];
  const originalSkills = original.skillGroups.flatMap(group => group.skills);
  const contains = (text, term) => containsTerm(normalizeAliases(text), normalizeAliases(term));
  // Keep original skills intact; remove only newly inserted duplicates.
  resume.skillGroups = resume.skillGroups.map(group => ({ ...group, skills: group.skills.filter(skill =>
    !terms.some(term => normalizeAliases(term) === normalizeAliases(skill) && narrative.some(text => contains(text, term)) && !originalSkills.some(text => contains(text, term)))) })).filter(group => group.skills.length);
  const allText = [...narrative, ...resume.skillGroups.flatMap(group => group.skills)];
  const missing = terms.filter(term => !allText.some(text => contains(text, term)));
  if (missing.length) resume.skillGroups.push({ id: 'confirmed-unplaced-skills', name: 'Relevant skills', skills: missing });
  return resume;
}

export const hasKeywordPreface = text => /^\s*(?:with|using)\s+[^,.;]{1,180},\s*/i.test(text);

export function needsExperienceRepair(source, text) {
  return hasKeywordPreface(text) || (source.confirmedKeywords || []).some(term => !containsTerm(normalizeAliases(text), normalizeAliases(term)));
}

export function selectTailoringBullets(resume, analysis) {
  return ['experience', 'projects'].flatMap(section => resume[section].flatMap((entry, entryIndex) =>
    entry.bullets.map((bullet, index) => {
      const keywords = analysis.requirements.filter(row => containsTerm(normalizeAliases(bullet.text), normalizeAliases(row.term)))
        .map(row => row.term);
      const relatedTask = (analysis.match?.keywords || []).some(term => placementScore(bullet.text, term) > 0);
      return { sourceId: `${section}:${entryIndex}:${index}`, section, entryIndex, index, entryId: entry.id, bulletId: bullet.id,
        text: bullet.text, keywords, relatedTask };
    })))
    .filter(row => (row.keywords.length || row.relatedTask || hasKeywordPreface(row.text)) && row.text.length <= 1000)
    .sort((a, b) => b.keywords.length - a.keywords.length);
}

// Conservative first-pass vocabulary guard. The API separately reviews natural
// paraphrases this guard cannot verify. Neither step proves real-world claims.
const connective = new Set('a an the and or of to for in on at by with using through that which as into across within while'.split(' '));
const verbs = { made: 'build', built: 'build', developed: 'build', created: 'build', delivered: 'build', developing: 'build', building: 'build', creating: 'build', build: 'build', used: 'use', utilized: 'use', using: 'use', implemented: 'implement', implementing: 'implement', optimized: 'optimize', optimizing: 'optimize', integrated: 'integrate', integrating: 'integrate', connected: 'integrate', connecting: 'integrate', maintained: 'maintain', maintaining: 'maintain', sustained: 'maintain', collaborating: 'collaborate', collaborated: 'collaborate', designed: 'design', designing: 'design', improved: 'improve', strengthened: 'improve', wrote: 'write', written: 'write', authored: 'write', writing: 'write', fix: 'resolve', fixed: 'resolve', resolved: 'resolve', resolving: 'resolve', handled: 'handle', handling: 'handle', rendered: 'render', rendering: 'render', documented: 'document', documenting: 'document' };

// Formatting, punctuation and JD-preferred spelling do not constitute a
// rephrase. Use the same test in generation and the visible progress report.
export function sameResumeWording(left, right) {
  const normalized = value => normalizeAliases(value).replace(/[^a-z0-9+#%]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized(left) === normalized(right);
}

// A long experience bullet is not rephrased merely because its opening verb
// changed. Short bullets have too little structure to reorder safely.
export function isMeaningfulBulletRewrite(original, proposed) {
  if (sameResumeWording(original, proposed)) return false;
  const words = value => normalizeAliases(value).match(/[a-z0-9+#%]+/g) || [];
  const source = words(original);
  if (source.length <= 5) return true;
  const result = words(proposed);
  if (sameResumeWording(source.slice(1).join(' '), result.slice(1).join(' '))) return false;
  // A long bullet with the same ordered wording and one substituted adjective
  // is still the source sentence, not a complete rephrase.
  if (source.length >= 10 && result.length >= 10 && Math.abs(source.length - result.length) <= 2) {
    const row = new Uint16Array(result.length + 1);
    for (const word of source) {
      let diagonal = 0;
      for (let index = 1; index <= result.length; index += 1) {
        const previous = row[index];
        row[index] = word === result[index - 1] ? diagonal + 1 : Math.max(row[index], row[index - 1]);
        diagonal = previous;
      }
    }
    if (row[result.length] / Math.min(source.length, result.length) >= 0.85) return false;
  }
  return true;
}

// Equivalent JD spellings are safe to use only where the original bullet already
// contains that concept. A skill listed elsewhere never establishes role evidence.
export function alignBulletKeywords(text, jd) {
  let result = text;
  const variants = new Map();
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!variants.has(canonical)) variants.set(canonical, new Set([canonical]));
    variants.get(canonical).add(alias);
  }
  for (const [canonical, terms] of variants) {
    if (!containsTerm(normalizeAliases(text), canonical)) continue;
    const escaped = [...terms].sort((a, b) => b.length - a.length).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const pattern = new RegExp(`(^|[^a-z0-9+#])(${escaped})(?=$|[^a-z0-9+#])`, 'gi');
    const spelling = [...jd.matchAll(pattern)][0]?.[2];
    if (spelling) result = result.replace(pattern, (_, prefix) => prefix + spelling);
  }
  return result;
}
function contentWords(text) {
  return new Set((normalizeAliases(text).replace(/\bworked (?:closely )?with\b/g, 'collaboration with').replace(/\bfocused on\b/g, 'on').match(/[a-z][a-z0-9.+#/-]*|\d+(?:\.\d+)?%?/g) || [])
    .map(word => word.replace(/[.,/]+$/, ''))
    .filter(word => !connective.has(word)).map(word => verbs[word] || ({ collaboration: 'collaborate', experienced: 'experience', partnered: 'collaborate', partnering: 'collaborate', translated: 'translate', converted: 'translate', conducted: 'conduct', performed: 'conduct', led: 'lead', directed: 'lead', owned: 'lead', applied: 'use', defined: 'define', outlined: 'define', crafted: 'design', produced: 'build', recorded: 'document', app: 'application', apps: 'application', components: 'component', interfaces: 'interface', architectures: 'architecture', applications: 'application', patterns: 'pattern', screens: 'screen', tools: 'tool', workflows: 'workflow', designs: 'design', note: 'document', notes: 'document', documentation: 'document' }[word]) || word));
}
export function metricClaims(text, allowedTerms = []) {
  const removeAllowed = text => {
    let value = normalizeAliases(text);
    for (const term of allowedTerms) value = value.replace(new RegExp(`(^|[^a-z0-9+#])${normalizeAliases(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9+#])`, 'gi'), '$1');
    return value;
  };
  return (removeAllowed(text).match(/(?:[$€£]\s*)?\d[\d,.]*(?:\s*(?:%|\+|percent\b|ms\b|milliseconds?\b|seconds?\b|minutes?\b|hours?\b|days?\b|weeks?\b|months?\b|years?\b|users?\b|requests?\b))?/g) || []).map(value => value.replace(/\s+/g, '')).sort();
}
export function preservesMetrics(original, proposed, allowedTerms = []) {
  return metricClaims(original, allowedTerms).join('|') === metricClaims(proposed, allowedTerms).join('|');
}
export function isSafeBulletEdit(original, proposed, allowedTerms = []) {
  if (!preservesMetrics(original, proposed, allowedTerms)) return false;
  const before = contentWords(original), after = contentWords(proposed);
  const permitted = contentWords(allowedTerms.join(' '));
  return [...before].every(word => after.has(word)) && [...after].every(word => before.has(word) || permitted.has(word));
}

export function hasUnsupportedNamedClaims(original, proposed, allowedTerms = []) {
  const source = normalizeAliases([original, ...allowedTerms].join(' ')), candidate = normalizeAliases(proposed);
  if (namedKeywordTerms(proposed).some(term => containsTerm(candidate, normalizeAliases(term)) && !containsTerm(source, normalizeAliases(term)))) return true;
  const ownership = /\b(?:led|lead|leading|leadership|spearheaded|owned|architected|managed (?:a |the )?team)\b/i;
  return ownership.test(proposed) && !ownership.test(original);
}

// A semantic reviewer may approve different prose, but it cannot waive named
// tools and technologies explicitly present in the source bullet.
const protectedToolTerms = new Set(['react native', 'react.js', 'javascript', 'typescript', 'html', 'css', 'redux toolkit', 'redux saga', 'redux', 'rest apis', 'graphql', 'node.js', 'express', 'next.js', 'vue', 'angular', 'svelte', 'python', 'java', 'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'git', 'github', 'ci/cd', 'eslint', 'sonarqube', 'storybook', 'playwright', 'cypress', 'react testing library', 'jest', 'vitest', 'vite', 'nginx', 'websocket', 'webrtc', 'canvas', 'webgl', 'wcag', 'figma', 'adobe xd']);
export function preservesProtectedFacts(original, proposed) {
  if (!preservesMetrics(original, proposed)) return false;
  const source = namedKeywordTerms(original).filter(term => protectedToolTerms.has(term.toLowerCase()));
  if (!source.every(term => containsTerm(normalizeAliases(proposed), normalizeAliases(term)))) return false;
  // Keep distinct UX research work explicit; "discovery research" is not a
  // faithful substitute for both discovery and research with users.
  if (/\buser research\b/i.test(original) && !/\b(?:user research|research (?:with|among|of) users)\b/i.test(proposed)) return false;
  if (/\bend[- ]to[- ]end\b/i.test(original) && !/\b(?:end[- ]to[- ]end|full[- ]cycle|complete lifecycle)\b/i.test(proposed)) return false;
  return true;
}

// Outcome and scale language can sound like harmless resume polish while
// creating a new achievement. Require the same claim family to be present in
// the cited source instead of allowing a reviewer to infer the benefit.
const outcomeClaimPatterns = [
  /\b(?:improv|enhanc)\w*\b/i, /\boptimiz\w*\b/i, /\bstreamlin\w*\b/i,
  /\baccelerat\w*\b/i, /\bboost\w*\b/i, /\bincreas\w*\b/i, /\breduc\w*\b/i,
  /\bensur\w*\b/i, /\benabl\w*\b/i, /\befficien\w*\b/i, /\breliab\w*\b/i,
  /\bconsisten\w*\b/i, /\bscalab\w*\b/i, /\bmaintainab\w*\b/i, /\bperformance\b/i,
  /\bproductiv\w*\b/i, /\bengagement\b/i, /\bsatisfaction\b/i, /\bconversion\b/i,
  /\brevenue\b/i, /\bcost(?:s| saving\w*)?\b/i, /\buser[ -]?friendly\b/i, /\bseamless\b/i,
  /\brobust\b/i, /\bfaster\b/i, /\baccuracy\b/i,
];
export function hasUnsupportedOutcomeClaims(original, proposed) {
  return outcomeClaimPatterns.some(pattern => pattern.test(proposed) && !pattern.test(original));
}

// A summary can omit less relevant detail, but every remaining claim must come
// from its source. Experience edits retain all source concepts instead.
export function isSupportedSummary(original, proposed, allowedTerms = []) {
  if (!proposed.trim() || !preservesMetrics(original, proposed, allowedTerms)) return false;
  const supported = contentWords([original, ...allowedTerms].join(' '));
  return [...contentWords(proposed)].every(word => supported.has(word));
}

export function applyBulletMerges(resume, selected, merges, terms = []) {
  const sources = new Map(selected.map(row => [row.sourceId, row]));
  const consumed = new Set();
  let merged = 0;
  for (const merge of merges) {
    const rows = merge.sourceIds.map(id => sources.get(id));
    if (new Set(merge.sourceIds).size !== rows.length || rows.some(row => !row || consumed.has(row.sourceId))) continue;
    const first = rows[0];
    if (!first || rows.some(row => row.section !== first.section || row.entryIndex !== first.entryIndex)) continue;
    const entry = resume[first.section][first.entryIndex];
    const bullets = rows.map(row => entry.bullets.find(bullet => bullet.id === row.bulletId));
    if (bullets.some(bullet => !bullet)) continue;
    const original = bullets.map(bullet => bullet.text).join(' ');
    if (merge.text.length >= original.length || !isSafeBulletEdit(original, merge.text)
      || !respectsKeywordPlacement(original, merge.text, terms)) continue;
    const indexes = bullets.map(bullet => entry.bullets.indexOf(bullet)).sort((a, b) => a - b);
    entry.bullets[indexes[0]].text = merge.text;
    const removedIds = new Set(indexes.slice(1).map(index => entry.bullets[index].id));
    entry.bullets = entry.bullets.filter(bullet => !removedIds.has(bullet.id));
    rows.forEach(row => consumed.add(row.sourceId));
    merged += rows.length - 1;
  }
  return merged;
}

export function applyTargetedEdits(master, selected, raw, jd) {
  const { edits } = bulletEditsSchema.parse(raw);
  const candidate = structuredClone(master);
  candidate.id = crypto.randomUUID();
  candidate.skillGroups = prioritizeSkillsForJob(groupSkillsByCategory(candidate.skillGroups), jd);
  let changed = 0, rejected = 0;
  for (const section of ['experience', 'projects']) {
    for (const entry of candidate[section]) for (const bullet of entry.bullets) {
      bullet.text = alignBulletKeywords(bullet.text, jd);
    }
  }
  const sources = new Map(selected.map(row => [row.sourceId, row]));
  const seen = new Set();
  for (const edit of edits) {
    const source = sources.get(edit.sourceId);
    if (!source || seen.has(edit.sourceId)) throw new Error('The AI edit could not be linked uniquely to a selected source bullet.');
    seen.add(edit.sourceId);
    if (!isSafeBulletEdit(source.text, edit.text, source.confirmedKeywords || [])) { rejected += 1; continue; }
    const bullet = candidate[source.section][source.entryIndex].bullets[source.index];
    bullet.text = alignBulletKeywords(edit.text, jd);
  }
  for (const section of ['experience', 'projects']) candidate[section].forEach((entry, i) => entry.bullets.forEach((bullet, j) => { if (bullet.text !== master[section][i].bullets[j].text) changed += 1; }));
  return { resume: candidate, changed, rejected };
}

export function includeSupportedJobKeywords(resume, analysis) {
  const result = structuredClone(resume);
  const evidence = [resume.summary, ...resume.skillGroups.flatMap(group => group.skills), ...['experience', 'projects'].flatMap(section => resume[section].flatMap(entry => entry.bullets.map(b => b.text)))].filter(text => text && !/\b(?:no|not|without|never|lack\w*)\b/i.test(text));
  const seen = new Set(result.skillGroups.flatMap(group => group.skills).map(normalizeAliases));
  const profile = detectDeveloperProfile(resume);
  const eligible = analysis.requirements.filter(row => row.status === 'matched' && row.term.split(/\s+/).length <= 5 && !/\b(?:years?|degree|bachelor|master|certif\w*|license|expert|proficien\w*|strong)\b/i.test(row.term) && evidence.some(quote => containsTerm(normalizeAliases(quote), normalizeAliases(row.term))))
    .sort((a, b) => Number(keywordCategory(b.term) === profile.id) - Number(keywordCategory(a.term) === profile.id) || Number(b.priority === 'required') - Number(a.priority === 'required'));
  const target = Math.ceil(analysis.requirements.length * .6);
  let represented = eligible.filter(row => seen.has(normalizeAliases(row.term))).length;
  const added = [];
  for (const row of eligible) {
    const key = normalizeAliases(row.term);
    if (represented >= target) break;
    if (!seen.has(key)) { added.push(row.term); seen.add(key); represented += 1; }
  }
  if (added.length) result.skillGroups.push({ id: 'supported-jd-keywords', name: 'Relevant skills', skills: added });
  result.skillGroups = groupSkillsByCategory(result.skillGroups);
  return result;
}
