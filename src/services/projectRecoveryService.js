import { splitResumeSections } from './resumeSections.js';
const PROJECT_HEADING = /^(projects|selected\s+projects|freelance\s+projects|selected\s+freelance\s+projects|personal\s+projects|academic\s+projects)\s*:?$/i;
const DESCRIPTION_START = /^(designed|built|created|developed|delivered|implemented|led|managed|redesigned|supported|enabled|produced|worked|collaborated|improved|translated)\b/i;

function clean(value) {
  return String(value || '').replace(/^[-•]\s*/, '').replace(/\s+/g, ' ').trim();
}

function comparable(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function repeatsDescription(left, right) {
  const leftText = comparable(left);
  const rightText = comparable(right);
  if (!leftText || !rightText || Math.min(leftText.length, rightText.length) < 12) return false;
  return leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText);
}

export function projectDisplaySubtitle(project) {
  const subtitle = clean(project?.subtitle);
  const repeatsBullet = (project?.bullets || []).some((bullet) => repeatsDescription(subtitle, bullet?.text));
  return repeatsBullet ? '' : subtitle;
}

export function projectDisplayName(project) {
  const name = clean(project?.name);
  const separated = name.match(/^(.+?)(?:\s*:\s+|\s+[-–—]\s+)(.+)$/);
  if (!separated) return name;
  const [, projectName, possibleDescription] = separated;
  const repeatsBullet = (project?.bullets || []).some((bullet) => repeatsDescription(possibleDescription, bullet?.text));
  return repeatsBullet ? clean(projectName) : name;
}

export function normalizeProjectPresentation(resume) {
  if (!resume) return resume;
  return {
    ...resume,
    projects: (resume.projects || []).map((project) => ({
      ...project,
      name: projectDisplayName(project),
      subtitle: projectDisplaySubtitle(project),
    })),
  };
}

function prepareProjectText(rawText) {
  return String(rawText || '').replace(
    /\s+(SELECTED FREELANCE PROJECTS|FREELANCE PROJECTS|SELECTED PROJECTS|PROJECTS|EDUCATION|CERTIFICATIONS?|LICENSES?|AWARDS?|PUBLICATIONS?|LANGUAGES?|INTERESTS?|REFERENCES?)\s+/gi,
    '\n$1\n',
  );
}

export function extractProjectDescriptions(rawText) {
  const projectLines = splitResumeSections(rawText).projects || [];

  const projects = [];
  projectLines.forEach((rawLine) => {
    const line = clean(rawLine);
    const previous = projects.at(-1);
    if (previous && /^\s*[•●▪◦+*-]\s*/.test(rawLine)) {
      previous.description = clean(`${previous.description} ${line}`);
      return;
    }
    const separator = line.match(/(?:\s+[-–—]\s+|\s*:\s+)/);
    if (separator) {
      const index = separator.index;
      const name = clean(line.slice(0, index));
      const description = clean(line.slice(index + separator[0].length));
      if (name) projects.push({ name, description });
      return;
    }
    if (previous && (DESCRIPTION_START.test(line) || (previous.description && (/^[a-z]/.test(line) || line.length > 180)))) {
      previous.description = clean(`${previous.description} ${line}`);
    } else if (line.length <= 180) {
      projects.push({ name: line, description: '' });
    }
  });
  return projects.filter((project) => project.name);
}

export function extractProjectSectionTitle(rawText) {
  const heading = prepareProjectText(rawText)
    .split(/\r?\n/)
    .map(clean)
    .find((line) => PROJECT_HEADING.test(line));
  if (/selected\s+freelance/i.test(heading || '')) return 'Selected Freelance Projects';
  if (/freelance/i.test(heading || '')) return 'Freelance Projects';
  if (/selected/i.test(heading || '')) return 'Selected Projects';
  return 'Projects';
}

function words(value) {
  return new Set(clean(value).toLowerCase().match(/[a-z0-9]+/g) || []);
}

function matchScore(left, right) {
  const leftText = clean(left).toLowerCase();
  const rightText = clean(right).toLowerCase();
  if (!leftText || !rightText) return 0;
  if (leftText.startsWith(rightText) || rightText.startsWith(leftText)) return 1;
  const leftWords = words(leftText); const rightWords = words(rightText);
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return overlap / Math.max(1, Math.min(leftWords.size, rightWords.size));
}

export function restoreProjectDescriptions(resume, rawText, createId = () => crypto.randomUUID()) {
  const extracted = extractProjectDescriptions(rawText);
  const result = structuredClone(resume);
  result.projectSectionTitle = extractProjectSectionTitle(rawText);
  if (!extracted.length) return normalizeProjectPresentation(result);
  const used = new Set();

  result.projects = (result.projects || []).map((project) => {
    let bestIndex = -1; let bestScore = 0;
    extracted.forEach((candidate, index) => {
      if (used.has(index)) return;
      const score = matchScore(project.name, candidate.name);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestIndex < 0 || bestScore < 0.6) return project;
    used.add(bestIndex);
    const candidate = extracted[bestIndex];
    const existingText = (project.bullets || []).map((bullet) => bullet.text).join(' ').toLowerCase();
    const shouldRestoreDescription = candidate.description && !existingText.includes(candidate.description.toLowerCase());
    return {
      ...project,
      name: candidate.name.length > clean(project.name).length ? candidate.name : project.name,
      bullets: shouldRestoreDescription
        ? [...(project.bullets || []), { id: createId(), text: candidate.description }]
        : (project.bullets || []),
    };
  });
  return normalizeProjectPresentation(result);
}
