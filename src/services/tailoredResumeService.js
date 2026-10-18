import { normalizeResume } from './resumeValidation.js';
import { canonicalTerm, normalizeAliases } from './atsAnalysis.js';
import { prioritizeSkillsForJob } from './skillTailoringService.js';
import { groupSkillsByCategory } from './skillGroupingService.js';

// Rewrite presentation, while anchoring historical facts to their source entry.
export function reconcileTailoredResume(master, candidate, jobDescription) {
  const result = normalizeResume(candidate);
  const restoreEntries = (field) => {
    const originals = new Map(master[field].map((entry) => [entry.id, entry]));
    const seen = new Set();
    const entries = result[field].map((entry) => {
      const source = originals.get(entry.masterId || entry.id);
      if (!source || seen.has(source.id)) throw new Error(`The tailored ${field} could not be linked to the source resume. Please retry.`);
      seen.add(source.id);
      return { ...structuredClone(source), id: entry.id, masterId: source.id,
        bullets: entry.bullets.length ? entry.bullets : structuredClone(source.bullets) };
    });
    for (const source of master[field]) {
      if (!seen.has(source.id)) entries.push({ ...structuredClone(source), masterId: source.id });
    }
    return entries;
  };
  const key = (skill) => canonicalTerm(normalizeAliases(skill));
  const proposedSkills = new Map(result.skillGroups.flatMap((group) => group.skills).map((skill) => [key(skill), skill]));
  // Accept JD wording only when it is an alias of a source skill; preserve every
  // original skill before deriving categories from the supported skill values.
  const skillGroups = master.skillGroups.map((group) => ({ ...structuredClone(group),
    skills: group.skills.map((skill) => proposedSkills.get(key(skill)) || skill),
  }));
  return { ...result, id: crypto.randomUUID(),
    name: master.name, contact: structuredClone(master.contact), links: structuredClone(master.links),
    education: structuredClone(master.education), certifications: structuredClone(master.certifications),
    languages: structuredClone(master.languages), ambiguities: structuredClone(master.ambiguities),
    projectSectionTitle: master.projectSectionTitle,
    skillGroups: prioritizeSkillsForJob(groupSkillsByCategory(skillGroups), jobDescription),
    experience: restoreEntries('experience'), projects: restoreEntries('projects'),
  };
}
