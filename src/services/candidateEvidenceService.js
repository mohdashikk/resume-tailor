import { containsTerm, normalizeAliases, normalizeText } from './atsAnalysis.js';
import { placementScore, isSafeBulletEdit, metricClaims, preservesMetrics, preservesProtectedFacts, hasUnsupportedNamedClaims, hasUnsupportedOutcomeClaims, hasKeywordPreface } from './targetedTailoringService.js';
import { cleanKeywordTerms } from './jobKeywords.js';

const positive = text => !/\b(?:no|not|without|never|lack\w*)\b/i.test(text);
const contains = (text, term) => positive(text) && containsTerm(normalizeAliases(text), normalizeAliases(term));
const fields = ['company', 'role', 'startDate', 'endDate'];
const sameJob = (a, b) => fields.every(field => normalizeText(a[field]) === normalizeText(b[field])) && a.company && a.role;
const sameCandidate = (a, b) => normalizeText(a.name) && normalizeText(a.name) === normalizeText(b?.name)
  && !(a.contact?.email && b.contact?.email && normalizeText(a.contact.email) !== normalizeText(b.contact.email));

export function requirementCategory(term) {
  if (/\b(?:years?|senior|leadership|ownership|degree|bachelor|master)\b/i.test(term)) return 'seniority_qualification';
  if (/\b(?:healthcare|regulated|medical|finance|banking)\b/i.test(term)) return 'domain';
  if (/\b(?:testing|tests?|jest|cypress|playwright|vitest)\b/i.test(term)) return 'testing';
  if (/\b(?:architecture|components?|patterns?|microservices)\b/i.test(term)) return 'architecture';
  if (/\b(?:typescript|javascript|python|java|html|css|sql)\b/i.test(term)) return 'language';
  if (/\b(?:react|angular|vue|next|express|django)\b/i.test(term)) return 'framework';
  return 'practice_tool_responsibility';
}

export function buildCandidateEvidence(resume, analysis, { verifiedCareerProfile, confirmations = [] } = {}) {
  const profile = verifiedCareerProfile && sameCandidate(resume, verifiedCareerProfile) ? verifiedCareerProfile : null;
  const requirements = analysis.requirements.map((row, index) => ({ id: `requirement:${index}`, term: row.term, priority: row.priority, category: requirementCategory(row.term), source: row.source }));
  const roles = ['experience', 'projects'].flatMap(section => resume[section].map((entry, entryIndex) => {
    const role_id = `${section}:${entryIndex}`;
    const sources = entry.bullets.map((bullet, index) => ({ id: `${role_id}:${index}`, text: bullet.text, bullet_id: bullet.id, origin: 'resume' }));
    // A master ID alone is not sufficient to move claims between employers.
    const historical = section === 'experience' ? profile?.experience.find(item => sameJob(entry, item)) : null;
    if (historical) for (const [index, bullet] of historical.bullets.entries()) {
      if (!sources.some(source => normalizeText(source.text) === normalizeText(bullet.text))) sources.push({ id: `profile:${role_id}:${index}`, text: bullet.text, bullet_id: bullet.id, origin: 'verified_profile' });
    }
    for (const [index, item] of confirmations.entries()) if (section === 'experience' && item.entryId === entry.id && !sources.some(source => contains(source.text, item.term))) {
      sources.push({ id: `confirmation:${role_id}:${index}`, text: item.term, term: item.term, origin: 'user_role_confirmation' });
    }
    const matches = requirements.map(requirement => {
      const direct = sources.filter(source => contains(source.text, requirement.term));
      const transferable = direct.length ? [] : sources.filter(source => placementScore(source.text, requirement.term) === 1);
      return { requirement_id: requirement.id, term: requirement.term, priority: requirement.priority, classification: direct.length ? 'direct' : transferable.length ? 'transferable' : 'unverified', evidence_references: (direct.length ? direct : transferable).map(source => source.id) };
    });
    const relevant = matches.some(match => match.classification !== 'unverified') || sources.some(source => hasKeywordPreface(source.text));
    return { role_id, entry_id: entry.id, section, entryIndex, employer: entry.company || entry.name || '', title: entry.role || entry.name || '',
      startDate: entry.startDate, endDate: entry.endDate, original_bullets: entry.bullets.map(bullet => bullet.text), sources, matches, relevant };
  }));
  const profileGlobal = profile ? [profile.summary, ...profile.skillGroups.flatMap(group => group.skills)] : [];
  const globalSources = [resume.summary, ...resume.skillGroups.flatMap(group => group.skills), ...profileGlobal];
  const mapping = requirements.map(requirement => {
    const direct = roles.flatMap(role => role.matches.filter(match => match.requirement_id === requirement.id && match.classification === 'direct').map(match => ({ role_id: role.role_id, evidence_references: match.evidence_references })));
    const transferable = roles.flatMap(role => role.matches.filter(match => match.requirement_id === requirement.id && match.classification === 'transferable').map(match => ({ role_id: role.role_id, evidence_references: match.evidence_references })));
    const listed = globalSources.some(text => contains(text, requirement.term));
    return { ...requirement, classification: direct.length || listed ? 'direct' : transferable.length ? 'transferable' : 'unverified',
      role_evidence: direct.length ? direct : transferable, listed_outside_experience: listed,
      known_from_profile: direct.some(item => item.evidence_references.some(id => id.startsWith('profile:'))) || profileGlobal.some(text => contains(text, requirement.term)) };
  });
  const claims_requiring_verification = mapping.filter(item => item.classification !== 'direct').map(item => ({ term: item.term,
    reason: item.classification === 'transferable' ? 'Related responsibilities exist, but this requirement is not verified.' : 'No supporting evidence in the supplied resume or matching career profile.' }));
  for (const item of confirmations.filter(item => !item.entryId)) if (!roles.some(role => role.sources.some(source => contains(source.text, item.term)))) claims_requiring_verification.push({ term: item.term, reason: 'Candidate confirmed this skill, but no employer or role association was verified. Kept out of experience.' });
  return { version: 'role-evidence-v1', requirements: mapping, roles, claims_requiring_verification };
}

function roleTechnologies(role) {
  // Never treat an arbitrary short responsibility/achievement as a tool name:
  // stripping it from metric checks could hide a dropped quantified outcome.
  return role.matches.filter(match => match.classification === 'direct').map(match => match.term)
    .filter(term => term.split(' ').length <= 5 && !/\d|years?|degree|qualification/i.test(normalizeAliases(term)));
}

export function validateRoleRewrite(role, rewrite) {
  const sources = new Map(role.sources.map(source => [source.id, source]));
  const issues = [], seen = new Set();
  for (const [index, bullet] of rewrite.tailored_bullets.entries()) {
    const refs = [...new Set(bullet.evidence_references)];
    if (refs.some(ref => !sources.has(ref))) { issues.push(`bullet:${index}:invalid_evidence_reference`); continue; }
    const evidence = refs.map(ref => sources.get(ref)).filter(source => positive(source.text));
    if (!evidence.length || evidence.every(source => source.origin === 'user_role_confirmation')) { issues.push(`bullet:${index}:missing_task_evidence`); continue; }
    // Exact source references + source-supported vocabulary and metrics are
    // independent of any model claim that its own rewrite is factual.
    const original = evidence.map(source => source.text).join(' ');
    const technologies = roleTechnologies(role);
    const supportedTerms = technologies.filter(term => evidence.some(source => contains(source.text, term)));
    // A proposed bullet must retain its cited source details, not merely avoid
    // inventing new ones. A subset of the source words can silently drop the
    // candidate's actual work while still looking like a safe summary.
    if (!preservesProtectedFacts(original, bullet.text)) issues.push(`bullet:${index}:dropped_source_tool_or_metric`);
    if (!isSafeBulletEdit(original, bullet.text, supportedTerms)) {
      // Named tools, ownership claims and metrics are deterministic hard stops.
      // More natural professional paraphrases receive a separate evidence-only
      // review instead of being discarded merely for using different wording.
      if (!preservesMetrics(original, bullet.text, supportedTerms) || hasUnsupportedNamedClaims(original, bullet.text, supportedTerms)) issues.push(`bullet:${index}:unsupported_claim_or_metric`);
      else if (hasUnsupportedOutcomeClaims(original, bullet.text)) issues.push(`bullet:${index}:unsupported_outcome_claim`);
      else issues.push(`bullet:${index}:needs_semantic_review`);
    }
    const key = normalizeAliases(bullet.text).replace(/[^a-z0-9 ]/g, '');
    if (seen.has(key)) issues.push(`bullet:${index}:duplicate`);
    seen.add(key);
    if (hasKeywordPreface(bullet.text) || bullet.text.split(/\s+/).length > 65) issues.push(`bullet:${index}:writing_quality`);
  }
  // Qualifications and history cannot be changed by this output schema. Also
  // preserve all original numerical achievements when condensing a role.
  for (const source of role.sources.filter(source => source.origin === 'resume' && source.text.trim())) {
    if (!rewrite.tailored_bullets.some(bullet => bullet.evidence_references.includes(source.id))) {
      issues.push('role:omitted_source_bullet');
      break;
    }
  }
  const proposed = rewrite.tailored_bullets.map(bullet => bullet.text).join(' ');
  const originalMetrics = metricClaims(role.original_bullets.join(' '), roleTechnologies(role));
  const proposedMetrics = metricClaims(proposed, roleTechnologies(role));
  if (originalMetrics.some(metric => proposedMetrics.filter(value => value === metric).length < originalMetrics.filter(value => value === metric).length)) issues.push('role:changed_or_dropped_metric');
  for (const match of role.matches.filter(match => match.classification === 'direct' && match.priority === 'required' && cleanKeywordTerms(match.term).some(term => normalizeAliases(term) === normalizeAliases(match.term)))) {
    if (!rewrite.tailored_bullets.some(bullet => contains(bullet.text, match.term))) issues.push('role:omitted_verified_requirement');
  }
  if (role.matches.some(match => match.classification === 'direct') && !role.matches.some(match => match.classification === 'direct' && rewrite.tailored_bullets.some(bullet => contains(bullet.text, match.term)))) issues.push('role:no_supported_jd_relevance');
  return [...new Set(issues)];
}

export function assertSourceHistory(original, candidate) {
  for (const section of ['experience', 'projects']) {
    if (original[section].length !== candidate[section].length) throw new Error('The generated resume changed historical entries.');
    original[section].forEach((entry, index) => {
      for (const field of ['id', 'masterId', 'role', 'company', 'name', 'subtitle', 'link', 'startDate', 'endDate', 'location']) {
        if (entry[field] !== candidate[section][index][field]) throw new Error('The generated resume changed a historical fact.');
      }
    });
  }
  for (const field of ['name', 'title', 'contact', 'links', 'certifications', 'languages', 'projectSectionTitle']) if (JSON.stringify(original[field]) !== JSON.stringify(candidate[field])) throw new Error('The generated resume changed identity or credentials.');
  if (original.education.length !== candidate.education.length) throw new Error('The generated resume changed qualifications.');
  original.education.forEach((entry, index) => {
    for (const field of ['id', 'qualification', 'institution', 'location', 'startDate', 'endDate']) if (entry[field] !== candidate.education[index][field]) throw new Error('The generated resume changed a qualification.');
  });
}

export function applyRoleRewrites(resume, evidence, rewrites, approvedParaphrases = new Set()) {
  const seen = new Set(), decisions = new Map();
  for (const rewrite of rewrites) {
    const role = evidence.roles.find(role => role.role_id === rewrite.role_id);
    if (!role || seen.has(rewrite.role_id)) throw new Error('Role output could not be linked uniquely to the evidence profile.');
    seen.add(rewrite.role_id);
    const issues = validateRoleRewrite(role, rewrite).filter(issue => {
      const index = Number.parseInt(issue.match(/^bullet:(\d+):needs_semantic_review$/)?.[1] || '-1', 10);
      return index < 0 || !approvedParaphrases.has(`${role.role_id}:${index}`);
    });
    decisions.set(role.role_id, issues);
    if (issues.length) continue;
    const entry = resume[role.section][role.entryIndex];
    entry.bullets = rewrite.tailored_bullets.map((bullet, index) => ({ id: entry.bullets[index]?.id || crypto.randomUUID(), text: bullet.text }));
  }
  return decisions;
}

export function experienceReport(original, candidate, evidence, decisions = new Map(), roleRewrites = []) {
  return { version: evidence.version, requirements: evidence.requirements, claims_requiring_verification: evidence.claims_requiring_verification,
    roles: evidence.roles.map(role => {
      const entry = candidate[role.section][role.entryIndex];
      const tailored_bullets = entry.bullets.map(bullet => bullet.text);
      const changed = JSON.stringify(role.original_bullets) !== JSON.stringify(tailored_bullets);
      const accepted = !decisions.get(role.role_id)?.length && roleRewrites.find(rewrite => rewrite.role_id === role.role_id);
      return { role_id: role.role_id, entry_id: role.entry_id, section: role.section, original_bullets: role.original_bullets, tailored_bullets,
        tailored_bullet_evidence: tailored_bullets.map((_, index) => ({ bullet_index: index, evidence_references: accepted
          ? accepted.tailored_bullets[index].evidence_references
          : role.sources.filter(source => source.origin === 'resume' && source.bullet_id === entry.bullets[index].id).map(source => source.id) })),
        matched_jd_requirements: role.matches.filter(match => match.classification !== 'unverified'), evidence_references: role.sources,
        changes_made: changed ? ['Rewrote or consolidated source-supported responsibilities for the target role.'] : [],
        status: changed ? 'tailored' : role.relevant ? 'retained' : 'not_relevant', validation_failures: decisions.get(role.role_id) || [],
        claims_requiring_verification: role.matches.filter(match => match.classification === 'transferable').map(match => match.term) };
    }) };
}
