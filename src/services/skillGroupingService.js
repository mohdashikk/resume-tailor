import { detectDeveloperProfile, keywordCategory } from './profileKeywords.js';
import { normalizeAliases } from './atsAnalysis.js';
import { formatSkillName, isVagueSkill } from './jobKeywords.js';

const categories = [
  ['styling', 'Styling & UI', /\b(?:css3?|sass|scss|less|tailwind(?: css)?|bootstrap|material ui|mui|styled components|chakra(?: ui)?|bulma)\b/i],
  ['frontend', 'Frontend', /\b(?:html5?|javascript|typescript|react(?:\.js|js| native)?|redux|next(?:\.js|js)?|vue(?:\.js|js)?|angular|svelte|jquery|frontend|front.end|responsive|accessibility|cross.browser)\b/i],
  ['backend', 'Backend', /\b(?:node(?:\.js|js)?|express(?:\.js|js)?|nestjs|django|flask|fastapi|spring(?: boot)?|php|laravel|ruby|rails|asp\.net|\.net|graphql|rest(?:ful)? api(?:s)?|backend|back.end)\b/i],
  ['database', 'Databases', /\b(?:sql|mysql|postgresql|postgres|mongodb|redis|sqlite|dynamodb|firebase|supabase|oracle)\b/i],
  ['devops', 'DevOps & Cloud', /\b(?:docker|kubernetes|jenkins|terraform|ansible|aws|azure|gcp|google cloud|ci\s*\/\s*cd|github actions|gitlab ci|devops)\b/i],
  ['testing', 'Testing', /\b(?:jest|vitest|cypress|playwright|selenium|mocha|testing library|unit testing|integration testing)\b/i],
  ['design', 'Design & UX', /\b(?:figma|sketch|adobe|wirefram\w*|prototyp\w*|user research|user flows|usability|design systems?|ui\/ux|ux\/ui)\b/i],
  ['tools', 'Tools & Collaboration', /\b(?:git|github|gitlab|bitbucket|jira|confluence|postman|webpack|vite|npm|yarn|agile|scrum|vs code)\b/i],
];

export function groupSkillsByCategory(groups = []) {
  const buckets = new Map();
  const seen = new Set();
  for (const group of groups) {
    for (const raw of group.skills || []) {
      const skill = formatSkillName(raw);
      const key = normalizeAliases(skill);
      if (!key || isVagueSkill(skill) || seen.has(key)) continue;
      seen.add(key);
      const category = categories.find(([, , pattern]) => pattern.test(skill));
      // Unknown skills retain their source category, without guessing expertise.
      const [id, name] = category || [`other-${group.id}`, group.name || 'Additional skills'];
      if (!buckets.has(id)) buckets.set(id, { id: `skills-${id}`, name, skills: [] });
      buckets.get(id).skills.push(skill);
    }
  }
  return [...buckets.values()];
}

// Developer-facing categories belong in the resume, not in application filters.
export function groupSkillsForResume(resume) {
  if (!detectDeveloperProfile(resume).developer) return groupSkillsByCategory(resume.skillGroups);
  const buckets = { frontend: [], backend: [], other: [] }, seen = new Set();
  for (const raw of resume.skillGroups.flatMap(group => group.skills)) {
    const skill = formatSkillName(raw);
    const key = normalizeAliases(skill);
    if (!key || isVagueSkill(skill) || seen.has(key)) continue;
    seen.add(key); buckets[keywordCategory(skill)].push(skill);
  }
  const order = detectDeveloperProfile(resume).id === 'backend' ? ['backend','frontend','other'] : ['frontend','backend','other'];
  const names = { frontend: 'Frontend', backend: 'Backend', other: 'Other skills' };
  return order.filter(id => buckets[id].length).map(id => ({ id: `resume-${id}`, name: names[id], skills: buckets[id] }));
}
