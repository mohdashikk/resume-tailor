import { blankResume, normalizeResume } from './resumeValidation';
import { extractProjectDescriptions, extractProjectSectionTitle } from './projectRecoveryService';

const SECTION_NAMES = /^(professional\s+summary|summary|profile|skills|core\s+skills|technical\s+skills|experience|professional\s+experience|work\s+experience|work\s+history|employment|projects|selected\s+projects|selected\s+freelance\s+projects|education|academic\s+background|certifications?|licenses?)\s*:?$/i;
const DATE_TOKEN = /\b(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?(?:19|20)\d{2}\b|\bpresent\b|\bcurrent\b/gi;
const BULLET_START = /^(?:[•●▪◦+«*-]\s*)+/;

function parseDateRange(line) {
  const matches = [...String(line || '').matchAll(DATE_TOKEN)];
  if (!matches.length) return null;
  return {
    index: matches[0].index,
    startDate: matches[0][0],
    endDate: matches[1]?.[0] || '',
  };
}

function parseCompanyLocation(value) {
  const parts = String(value || '').split(/\s+[~–—-]\s+|\s+\|\s+/).map((part) => part.trim()).filter(Boolean);
  return { company: parts[0] || '', location: parts.slice(1).join(' — ') };
}

function parseExperienceLines(lines) {
  const entries = [];
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const next = lines[index + 1]?.trim() || '';
    const nextDates = parseDateRange(next);
    if (!BULLET_START.test(line) && nextDates) {
      const id = crypto.randomUUID();
      const employer = parseCompanyLocation(next.slice(0, nextDates.index).trim());
      current = {
        id, masterId: id, role: line, company: employer.company, location: employer.location,
        startDate: nextDates.startDate, endDate: nextDates.endDate, bullets: [],
      };
      entries.push(current);
      index += 1;
      continue;
    }
    if (!current) continue;
    if (BULLET_START.test(line)) {
      current.bullets.push({ id: crypto.randomUUID(), text: line.replace(BULLET_START, '').trim() });
    } else if (current.bullets.length) {
      const bullet = current.bullets.at(-1);
      bullet.text = `${bullet.text} ${line}`.replace(/\s+/g, ' ').trim();
    }
  }
  return entries;
}

function parseEducationLines(lines) {
  const entries = [];
  let current = null;
  const qualificationStart = /^(bachelor|master|diploma|doctor|phd|b\.?a\.?\b|bsc\b|msc\b|mba\b|certificate)/i;
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (qualificationStart.test(line)) {
      const dates = parseDateRange(line);
      const id = crypto.randomUUID();
      const expected = /expected/i.test(line);
      const qualification = (dates ? line.slice(0, dates.index) : line)
        .replace(/expected\s*:?\s*$/i, '')
        .replace(/\s+[-–—|]\s*$/, '')
        .trim();
      current = {
        id, institution: '', qualification, location: '',
        startDate: expected ? '' : (dates?.startDate || ''),
        endDate: expected ? (dates?.startDate || '') : (dates?.endDate || ''),
        details: '',
      };
      entries.push(current);
      return;
    }
    if (!current) return;
    if (/student|year|grade|gpa|expected/i.test(line)) {
      current.details = [current.details, line].filter(Boolean).join(' ');
    } else if (!current.institution) {
      const parts = line.split(/,\s*/);
      current.institution = parts.shift() || '';
      current.location = parts.join(', ');
    } else {
      current.details = [current.details, line].filter(Boolean).join(' ');
    }
  });
  return entries;
}

function parseSkillLines(lines) {
  const groups = [];
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const colonIndex = line.indexOf(':');
    const hasGroup = colonIndex > 0 && colonIndex < 45;
    if (hasGroup || !groups.length) {
      const value = hasGroup ? line.slice(colonIndex + 1) : line;
      groups.push({
        id: crypto.randomUUID(),
        name: hasGroup ? line.slice(0, colonIndex).trim() : 'Skills',
        skills: value.split(/[,|•/]/).map((item) => item.trim()).filter(Boolean),
      });
    } else {
      groups.at(-1).skills.push(...line.split(/[,|•/]/).map((item) => item.trim()).filter(Boolean));
    }
  });
  return groups;
}

export function parseResumeLocally(rawText) {
  const prepared = rawText
    .replace(/\s+(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|CORE SKILLS|TECHNICAL SKILLS|PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EMPLOYMENT|SELECTED FREELANCE PROJECTS|FREELANCE PROJECTS|SELECTED PROJECTS|PROJECTS|EDUCATION|CERTIFICATIONS?|LICENSES?)\s+/g, '\n$1\n');
  const lines = prepared.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const resume = blankResume();
  resume.projectSectionTitle = extractProjectSectionTitle(rawText);
  const firstLine = lines[0] || '';
  resume.name = (firstLine.length <= 120 ? firstLine : firstLine.split(/\s+/).slice(0, 6).join(' ')).slice(0, 120);
  const possibleTitle = lines[1] || '';
  if (possibleTitle.length <= 120 && !possibleTitle.includes('@') && !/^professional summary$/i.test(possibleTitle)) resume.title = possibleTitle;
  const email = rawText.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || '';
  const phone = rawText.match(/(?:\+?\d[\d ()-]{7,}\d)/)?.[0] || '';
  resume.contact.email = email; resume.contact.phone = phone;
  const urls = [...new Set(rawText.match(/https?:\/\/[^\s)]+|(?:linkedin\.com|github\.com)\/[^\s)]+/gi) || [])];
  resume.links = urls.map((url) => ({ id: crypto.randomUUID(), label: url.includes('linkedin') ? 'LinkedIn' : url.includes('github') ? 'GitHub' : 'Portfolio', url: url.startsWith('http') ? url : `https://${url}` }));
  const sections = {}; let active = 'header';
  lines.forEach((line) => {
    const match = line.match(SECTION_NAMES);
    if (match) { active = match[1].toLowerCase(); sections[active] ||= []; }
    else { sections[active] ||= []; sections[active].push(line); }
  });
  const headerLines = sections.header || [];
  const contactParts = headerLines.flatMap((line) => line.split('|')).map((part) => part.trim());
  resume.contact.location = contactParts.find((part) => part && !part.includes('@') && !/linkedin|github|https?:|\d{7}/i.test(part) && part !== resume.name && part !== resume.title) || '';
  const summaryKey = Object.keys(sections).find((key) => /summary|profile/.test(key));
  if (summaryKey) resume.summary = sections[summaryKey].join(' ');
  const skillsKey = Object.keys(sections).find((key) => key.includes('skills'));
  if (skillsKey) resume.skillGroups = parseSkillLines(sections[skillsKey]);
  const certKey = Object.keys(sections).find((key) => /certification|license/.test(key));
  if (certKey) resume.certifications = sections[certKey].map((name) => ({ id: crypto.randomUUID(), name: name.replace(/^[-•]\s*/, ''), issuer: '', date: '' }));
  const experienceKey = Object.keys(sections).find((key) => /experience|work\s+history|employment/.test(key));
  if (experienceKey) resume.experience = parseExperienceLines(sections[experienceKey]);
  const educationKey = Object.keys(sections).find((key) => /education|academic/.test(key));
  if (educationKey) resume.education = parseEducationLines(sections[educationKey]);
  resume.projects = extractProjectDescriptions(rawText).map((project) => ({
    id: crypto.randomUUID(), masterId: undefined, name: project.name, subtitle: '', link: '', startDate: '', endDate: '',
    bullets: project.description ? [{ id: crypto.randomUUID(), text: project.description }] : [],
  }));
  resume.ambiguities = ['Basic on-device parsing was used. Review all fields, dates, and OCR text carefully before saving the master resume.'];
  return normalizeResume(resume);
}
