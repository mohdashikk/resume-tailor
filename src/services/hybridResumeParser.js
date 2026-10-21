import { parseResumeLocally } from './localResumeParser.js';
import { reconcileParsedResume } from './resumeParsingService.js';
import { resumeSchema } from './resumeValidation.js';

export async function parseResumeHybrid(rawText, semanticParser) {
  if (String(rawText || '').trim().length < 40) throw new Error('Not enough resume text to parse.');
  const local = resumeSchema.parse(parseResumeLocally(rawText));
  // Recognizing headings does not prove that every entry or bullet was read.
  // Always run semantic parsing when available, then use the on-device parse as
  // a fallback if the provider is unavailable.
  if (semanticParser) {
    try {
      const candidate = resumeSchema.parse(await semanticParser(rawText));
      const bulletCount = (resume) => resume.experience.reduce((count, entry) => count + entry.bullets.length, 0);
      if (local.experience.length && local.experience.every((entry) => entry.role && entry.company)
        && (candidate.experience.length < local.experience.length || bulletCount(candidate) < bulletCount(local))) {
        local.ambiguities.push('AI omitted source experience entries or bullets. The complete on-device extraction was used instead; review it before rewriting.');
        return local;
      }
      // Reconcile in the browser too: an older or separately deployed API can
      // return a valid-looking object while silently omitting non-work entries.
      const semantic = reconcileParsedResume(candidate, rawText);
      return semantic;
    }
    catch { local.ambiguities.push('Automatic layout clarification was unavailable. Review the locally extracted content against the original document.'); }
  }
  return local;
}
