import { normalizeAliases } from './atsAnalysis.js';

const frontend = /\b(?:front[ -]?end|html|css|sass|less|tailwind|bootstrap|react|redux|next\.js|vue|angular|svelte|javascript|typescript|accessibility|wcag|responsive|cross.browser|webgl|canvas|storybook|vite|webpack|cypress|playwright|jest)\b/i;
const backend = /\b(?:back[ -]?end|node\.js|node|express|nestjs|django|flask|fastapi|spring|php|laravel|ruby|rails|python|java|c#|\.net|graphql|sql|mysql|postgres\w*|mongodb|redis|database|rest api|microservices)\b/i;

export function keywordCategory(term) {
  const text = normalizeAliases(term);
  const front = frontend.test(text), back = backend.test(text);
  return front && !back ? 'frontend' : back && !front ? 'backend' : 'other';
}

export function detectDeveloperProfile(resume) {
  const title = String(resume?.title || '').toLowerCase();
  if (/full[ -]?stack/.test(title)) return { id: 'all', label: 'Full-stack developer', developer: true };
  if (/designer|ui\s*\/\s*ux|product design/.test(title) && !/developer|engineer/.test(title)) return { id: 'other', label: 'Design / other profile', developer: false };
  if (/front[ -]?end/.test(title)) return { id: 'frontend', label: 'Frontend developer', developer: true };
  if (/back[ -]?end/.test(title)) return { id: 'backend', label: 'Backend developer', developer: true };
  const skills = (resume?.skillGroups || []).flatMap(group => group.skills);
  const front = skills.filter(skill => keywordCategory(skill) === 'frontend').length;
  const back = skills.filter(skill => keywordCategory(skill) === 'backend').length;
  if (front >= 2 && back >= 2) return { id: 'all', label: 'Full-stack skills', developer: true };
  if (front >= 2) return { id: 'frontend', label: 'Frontend skills', developer: true };
  if (back >= 2) return { id: 'backend', label: 'Backend skills', developer: true };
  return { id: 'all', label: /developer|engineer/.test(title) ? 'Developer profile' : 'Other profile', developer: /developer|engineer/.test(title) };
}

export function keywordCoverageTarget(match) {
  const total = (match?.keywords || []).length || new Set([...(match?.matched || []), ...(match?.missing || []), ...(match?.uncertain || [])]).size;
  const matched = (match?.matched || []).length;
  return { total, matched, target: Math.ceil(total * .6), coverage: total ? Math.round(100 * matched / total) : null };
}
