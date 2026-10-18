import { parseResumeLocally } from './localResumeParser.js';
import { splitResumeSections } from './resumeSections.js';
import { resumeSchema } from './resumeValidation.js';
import { restoreProjectDescriptions } from './projectRecoveryService.js';
import { containsTerm, normalizeAliases } from './atsAnalysis.js';
import { groupSkillsByCategory } from './skillGroupingService.js';

export function prepareUploadedResume(candidate) {
  const parsed = resumeSchema.parse(candidate);
  const freshEntries = (entries) => entries.map((entry) => {
    const id = crypto.randomUUID();
    return { ...entry, id, masterId: id, bullets: entry.bullets.map((bullet) => ({ ...bullet, id: crypto.randomUUID() })) };
  });
  // Every import is a new document, even if the provider repeats opaque IDs.
  return { ...parsed, id: crypto.randomUUID(), skillGroups: groupSkillsByCategory(parsed.skillGroups), experience: freshEntries(parsed.experience), projects: freshEntries(parsed.projects) };
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
  if (sections.other?.length) warnings.push(`Additional source content needs manual placement: ${sections.other.join(' ').slice(0, 1800)}`);
  result.ambiguities = [...new Set(warnings)].slice(0, 50);
  if (!result.name && !result.summary && !result.experience.length && !result.skillGroups.length) throw new Error('The resume could not be identified reliably. Please retry with a clearer file or paste its text.');
  return resumeSchema.parse(result);
}
