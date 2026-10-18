import { parseResumeLocally } from './localResumeParser.js';
import { splitResumeSections } from './resumeSections.js';
import { resumeSchema } from './resumeValidation.js';

export async function parseResumeHybrid(rawText, semanticParser) {
  if (String(rawText || '').trim().length < 40) throw new Error('Not enough resume text to parse.');
  const local = resumeSchema.parse(parseResumeLocally(rawText));
  const sections = splitResumeSections(rawText);
  const ambiguous = !local.name || sections.other?.length
    || !Object.keys(sections).some((section) => ['skills', 'experience', 'education', 'projects'].includes(section))
    || ['experience', 'education', 'projects'].some((section) => sections[section]?.length && !local[section].length)
    || local.experience.some((entry) => !entry.role || !entry.company)
    || local.ambiguities.length > 1;
  if (ambiguous && semanticParser) {
    try { return resumeSchema.parse(await semanticParser(rawText)); }
    catch { local.ambiguities.push('Automatic layout clarification was unavailable. Review the locally extracted content against the original document.'); }
  }
  return local;
}
