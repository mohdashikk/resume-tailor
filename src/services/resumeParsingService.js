import { parseResumeLocally } from './localResumeParser.js';
import { splitResumeSections } from './resumeSections.js';
import { resumeSchema } from './resumeValidation.js';
import { restoreProjectDescriptions } from './projectRecoveryService.js';
import { containsTerm, normalizeAliases } from './atsAnalysis.js';
import { groupSkillsByCategory } from './skillGroupingService.js';

const comparable = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const similar = (left, right) => {
  const a = comparable(left); const b = comparable(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const shorter = new Set((a.length < b.length ? a : b).split(' ').filter((word) => word.length > 2));
  const longer = new Set((a.length < b.length ? b : a).split(' ').filter((word) => word.length > 2));
  return shorter.size >= 4 && [...shorter].filter((word) => longer.has(word)).length / shorter.size >= 0.8;
};

function restorePartialExperience(result, local, warnings) {
  const used = new Set();
  for (const source of local.experience) {
    if (!source.role || !source.company) continue;
    const index = result.experience.findIndex((entry, position) => !used.has(position)
      && similar(entry.company, source.company)
      && (similar(entry.role, source.role) || (entry.startDate && comparable(entry.startDate) === comparable(source.startDate))));
    if (index < 0) {
      if (result.experience.length < 50) {
        result.experience.push(source);
        warnings.push(`Recovered an omitted experience entry from the uploaded text: ${source.role} at ${source.company}.`);
      }
      continue;
    }
    used.add(index);
    const entry = result.experience[index];
    for (const field of ['role', 'company', 'location', 'startDate', 'endDate']) {
      if (!entry[field] && source[field]) entry[field] = source[field];
    }
    let restored = 0;
    const ordered = [];
    const matched = new Set();
    for (const bullet of source.bullets) {
      if (!bullet.text) continue;
      const match = entry.bullets.find((existing) => !matched.has(existing) && similar(existing.text, bullet.text));
      if (match) {
        matched.add(match);
        // A model can return the opening clause but omit a wrapped line or
        // the end of a bullet. The extracted source wording is authoritative.
        if (comparable(bullet.text).length > comparable(match.text).length) {
          match.text = bullet.text;
          restored += 1;
        }
        ordered.push(match);
        continue;
      }
      if (ordered.length >= 20) break;
      ordered.push(bullet);
      restored += 1;
    }
    entry.bullets = [...ordered, ...entry.bullets.filter((bullet) => !matched.has(bullet))].slice(0, 20);
    if (restored) warnings.push(`Recovered ${restored} omitted bullet${restored === 1 ? '' : 's'} for ${source.role} at ${source.company}.`);
  }
}

function restorePartialEntries(result, local, field, matches, limit, warnings) {
  const used = new Set();
  const ordered = [];
  for (const source of local[field]) {
    if (!matches.some((key) => source[key])) continue;
    const entry = result[field].find((candidate) => !used.has(candidate) && (
      field === 'education' && candidate.qualification && source.qualification
        ? similar(candidate.qualification, source.qualification)
        : matches.some((key) => similar(candidate[key], source[key]))
    ));
    if (entry) {
      used.add(entry);
      for (const key of Object.keys(source)) if (key !== 'id' && !entry[key] && source[key]) entry[key] = source[key];
      ordered.push(entry);
    } else if (result[field].length < limit) {
      result[field].push(source);
      used.add(source);
      ordered.push(source);
      warnings.push(`Recovered an omitted ${field} entry from the uploaded text.`);
    }
  }
  // Keep the source document's order when an AI response skipped an entry.
  if (field === 'education' && ordered.length) result[field] = [...ordered, ...result[field].filter((entry) => !used.has(entry))];
}

export function prepareUploadedResume(candidate) {
  const parsed = resumeSchema.parse(candidate);
  const freshEntries = (entries) => entries.map((entry) => {
    const id = crypto.randomUUID();
    return { ...entry, id, masterId: id, bullets: entry.bullets.map((bullet) => ({ ...bullet, id: crypto.randomUUID() })) };
  });
  // Every import is a new document, even if the provider repeats opaque IDs.
  return { ...parsed, id: crypto.randomUUID(), skillGroups: groupSkillsByCategory(parsed.skillGroups), experience: freshEntries(parsed.experience), projects: freshEntries(parsed.projects) };
}

export function assertParsedResumeCoverage(parsed, rawText) {
  const sections = splitResumeSections(rawText);
  const lines = sections.experience || [];
  const datedRole = /^(?=.{1,180}$)(?=.*\b(?:(?:19|20)\d{2}|present|current)\b)(?:[\w/&+.-]+\s+){0,7}(?:developer|engineer|designer|manager|analyst|consultant|intern|lead|director|specialist|officer|associate|architect|coordinator|administrator|accountant|executive|researcher)\b/i;
  const sourceJobs = lines.filter((line) => datedRole.test(line)).length;
  const parsedBullets = parsed.experience.reduce((count, entry) => count + entry.bullets.length, 0);
  const sourceDescriptions = lines.filter((line) => line.length >= 45 && !datedRole.test(line)).length;
  if (sourceJobs >= 2 && parsed.experience.length < sourceJobs) {
    throw new Error(`The PDF contains at least ${sourceJobs} dated experience headings, but only ${parsed.experience.length} job${parsed.experience.length === 1 ? '' : 's'} could be structured. No partial resume was saved. Try re-uploading the original PDF or paste its extracted text.`);
  }
  if (sourceDescriptions >= 2 && parsedBullets === 0) {
    throw new Error('The PDF contains experience descriptions, but none could be placed into job bullets. No partial resume was saved. Try re-uploading the original PDF or paste its extracted text.');
  }
  return parsed;
}

export function reconcileParsedResume(candidate, rawText) {
  // Validate before normalization: turning malformed entries into empty objects
  // would hide dropped experience and education behind a successful parse.
  const parsed = resumeSchema.parse(candidate);
  const local = parseResumeLocally(rawText);
  const sections = splitResumeSections(rawText);
  const result = restoreProjectDescriptions(parsed, rawText);
  const warnings = [...result.ambiguities];
  const sourceText = normalizeAliases(rawText);
  result.skillGroups = result.skillGroups.map((group) => {
    const skills = group.skills.filter((skill) => containsTerm(sourceText, normalizeAliases(skill)));
    if (skills.length !== group.skills.length) warnings.push('Removed skills that could not be found in the uploaded text. Review the Skills section.');
    const name = containsTerm(sourceText, normalizeAliases(group.name)) ? group.name : 'Skills';
    return { ...group, name, skills };
  }).filter((group) => group.skills.length);
  for (const field of ['email', 'phone', 'location']) {
    if (!result.contact[field] && local.contact[field]) result.contact[field] = local.contact[field];
  }
  for (const field of ['name', 'title']) if (!result[field] && local[field]) result[field] = local[field];
  if (!result.links.length) result.links = local.links;
  if (!result.languages.length) result.languages = local.languages;
  for (const [section, field] of [['summary', 'summary'], ['skills', 'skillGroups'], ['experience', 'experience'], ['education', 'education'], ['projects', 'projects'], ['certifications', 'certifications']]) {
    if (!sections[section]?.length || result[field]?.length) continue;
    const recovered = local[field];
    const reliable = section !== 'experience' || recovered.every((entry) => entry.role && entry.company);
    if (recovered?.length && reliable) {
      result[field] = recovered;
      warnings.push(`Recovered ${section} from the uploaded text because it was omitted during parsing. Review its placement.`);
    } else warnings.push(`The uploaded ${section} section could not be structured reliably. Check the original upload and complete this section.`);
  }
  // A non-empty section can still be incomplete. Restore only source-backed
  // entries that the local parser can identify, without replacing AI mappings.
  restorePartialExperience(result, local, warnings);
  restorePartialEntries(result, local, 'projects', ['name'], 50, warnings);
  restorePartialEntries(result, local, 'education', ['institution', 'qualification'], 30, warnings);
  restorePartialEntries(result, local, 'certifications', ['name'], 30, warnings);
  for (const language of local.languages) {
    if (!result.languages.some((value) => comparable(value) === comparable(language)) && result.languages.length < 50) {
      result.languages.push(language);
      warnings.push(`Recovered an omitted language from the uploaded text.`);
    }
  }
  for (const sourceGroup of local.skillGroups) {
    const missing = sourceGroup.skills.filter((skill) => !result.skillGroups.some((group) => group.skills.some((value) => similar(value, skill))));
    if (!missing.length) continue;
    let target = result.skillGroups.find((group) => similar(group.name, sourceGroup.name));
    if (!target && result.skillGroups.length < 20) {
      target = { ...sourceGroup, skills: [] };
      result.skillGroups.push(target);
    }
    if (target) {
      target.skills.push(...missing.slice(0, 100 - target.skills.length));
      warnings.push(`Recovered ${missing.length} omitted skill${missing.length === 1 ? '' : 's'} from the uploaded text.`);
    }
  }
  if (sections.other?.length) warnings.push(`Additional source content needs manual placement: ${sections.other.join(' ').slice(0, 1800)}`);
  result.ambiguities = [...new Set(warnings)].slice(0, 50);
  if (!result.name && !result.summary && !result.experience.length && !result.skillGroups.length) throw new Error('The resume could not be identified reliably. Please retry with a clearer file or paste its text.');
  return resumeSchema.parse(result);
}
