import { blankResume, normalizeResume } from './resumeValidation.js';
import { extractProjectDescriptions, extractProjectSectionTitle } from './projectRecoveryService.js';
import { identifyHeading, splitResumeSections } from './resumeSections.js';

const DATE_TOKEN = /\b(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?(?:19|20)\d{2}\b|\bpresent\b|\bcurrent\b/gi;
const BULLET_START = /^(?:[•●▪◦+«*-]\s*)+/;
const ROLE_NAME = /\b(developer|engineer|designer|manager|analyst|consultant|intern|lead|director|specialist|officer|associate|architect|coordinator|administrator|accountant|executive|researcher)\b/i;

function parseDateRange(line) {
  const matches = [...String(line || '').matchAll(DATE_TOKEN)];
  if (!matches.length) return null;
  return {
    index: matches[0].index,
    endIndex: matches.at(-1).index + matches.at(-1)[0].length,
    startDate: matches[0][0],
    endDate: matches[1]?.[0] || '',
  };
}

function parseExperienceLines(lines, warnings) {
  const entries = [];
  let current = null;
  let pending = [];
  const roleLike = (value) => ROLE_NAME.test(value);
  const createEntry = (header, dates) => {
    const parts = header.flatMap((line) => line.split(/\s+\|\s+|\s+[-–—]\s+|\s+at\s+/i)).flatMap((part) => {
      const comma = part.indexOf(',');
      return comma > 0 && roleLike(part.slice(0, comma)) ? [part.slice(0, comma), part.slice(comma + 1)] : [part];
    }).map((part) => part.trim()).filter(Boolean);
    const roleIndex = parts.findIndex(roleLike);
    const role = roleIndex >= 0 ? parts.splice(roleIndex, 1)[0] : '';
    const id = crypto.randomUUID();
    const headingField = (value, field, maximum) => {
      if (value.length <= maximum) return value;
      // Extraction can flatten paragraphs into a heading. Do not turn that
      // prose into metadata, truncate it, or reject the entire document.
      for (let offset = 0; offset < value.length; offset += 10000) {
        warnings.push(`Experience entry ${entries.length + 1}: source text could not be identified as ${field}. Review and place this content: ${value.slice(offset, offset + 10000)}`);
      }
      return '';
    };
    return { id, masterId: id, role: headingField(role, 'role', 500), company: headingField(parts.shift() || '', 'company', 500), location: headingField(parts.join(' — '), 'location', 120), startDate: dates?.startDate || '', endDate: dates?.endDate || '', bullets: [] };
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const dates = parseDateRange(line);
    if (!BULLET_START.test(line) && dates && (dates.endDate || pending.length || roleLike(line))) {
      const prefix = line.slice(0, dates.index).replace(/[\s|~–—-]+$/, '');
      current = createEntry([...pending, prefix.replace(/\s+~\s+/g, ' | ')], dates);
      const suffix = line.slice(dates.endIndex);
      const dateLocation = suffix.replace(/^[\s|\u00b7\u2022\ufffd-]+/, '').trim();
      if (/^\s*[|\u00b7\u2022\ufffd]/.test(suffix) && dateLocation.length <= 120 && !current.location) current.location = dateLocation;
      entries.push(current); pending = [];
      continue;
    }
    if (BULLET_START.test(line)) {
      if (pending.length) { current = createEntry(pending); entries.push(current); pending = []; }
      if (!current) { current = createEntry([]); entries.push(current); }
      current.bullets.push({ id: crypto.randomUUID(), text: line.replace(BULLET_START, '').trim() });
    } else if (current?.bullets.length && !roleLike(line) && (/^[a-z]/.test(line) || (!parseDateRange(lines[index + 1] || '') && !parseDateRange(lines[index + 2] || '')))) {
      const bullet = current.bullets.at(-1);
      bullet.text = `${bullet.text} ${line}`.replace(/\s+/g, ' ').trim();
    } else pending.push(line);
  }
  if (pending.length) {
    // Keep unclassified source text visible instead of silently dropping it.
    if (!current || pending.some(roleLike)) entries.push(createEntry(pending));
    else current.bullets.push({ id: crypto.randomUUID(), text: pending.join(' ') });
  }
  return entries;
}

function parseEducationLines(lines) {
  const entries = [];
  let current = null;
  const qualificationStart = /^(bachelor|master|diploma|doctor|ph\.?d|b\.?a\.?\b|b\.?\s?sc\b|m\.?\s?sc\b|m\.?\s?tech\b|b\.?\s?tech\b|b\.?e\.?\b|m\.?e\.?\b|bca\b|mca\b|mba\b|associate|certificate|higher secondary|secondary school)/i;
  let pendingInstitution = '';
  lines.forEach((rawLine, index) => {
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
        id, institution: pendingInstitution, qualification, location: '',
        startDate: expected ? '' : (dates?.startDate || ''),
        endDate: expected ? (dates?.startDate || '') : (dates?.endDate || ''),
        details: '',
      };
      entries.push(current);
      pendingInstitution = '';
      return;
    }
    if (current && /student|grade|gpa|expected/i.test(line)) { current.details = [current.details, line].filter(Boolean).join(' '); return; }
    if (!current || qualificationStart.test(lines[index + 1] || '')) { pendingInstitution = [pendingInstitution, line].filter(Boolean).join(' '); return; }
    const dates = parseDateRange(line);
    if (dates && dates.index === 0) { current.startDate = dates.startDate; current.endDate = dates.endDate; return; }
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
    const line = rawLine.replace(BULLET_START, '').trim();
    if (!line) return;
    // Category headings are labels, not individual skills. Some PDFs place
    // the label and its values on separate lines without a colon.
    if (/^(?:front[ -]?end|back[ -]?end|devops|frameworks|tools|databases|programming languages|design tools|cloud|platforms)(?:\s*[&/]\s*(?:tools|devops|cloud|platforms|frameworks))?\s*:?$/i.test(line)) {
      groups.push({ id: crypto.randomUUID(), name: line.replace(/:$/, '').trim(), skills: [] });
      return;
    }
    const colonIndex = line.indexOf(':');
    const hasGroup = colonIndex > 0 && colonIndex < 45;
    if (hasGroup || !groups.length) {
      const value = hasGroup ? line.slice(colonIndex + 1) : line;
      groups.push({
        id: crypto.randomUUID(),
        name: hasGroup ? line.slice(0, colonIndex).trim() : 'Skills',
        skills: value.replace(BULLET_START, '').split(/[,;|•]/).map((item) => item.trim()).filter(Boolean),
      });
    } else {
      groups.at(-1).skills.push(...line.replace(BULLET_START, '').split(/[,;|•]/).map((item) => item.trim()).filter(Boolean));
    }
  });
  return groups;
}

export function parseResumeLocally(rawText) {
  const parsingWarnings = [];
  const sections = splitResumeSections(rawText);
  const lines = (sections.header || []).filter((line) => !/^(resume|curriculum vitae|contact(?: details)?)\s*:?$/i.test(line));
  const resume = blankResume();
  resume.projectSectionTitle = extractProjectSectionTitle(rawText);
  const firstLine = lines[0] || '';
  const headerName = firstLine.split(/\s*[|]\s*|\s+(?=[\w.+-]+@)|\s+(?=\+?\d[\d ()-]{7,})/)[0];
  resume.name = (headerName.length <= 120 ? headerName : '').slice(0, 120);
  if (/@|https?:|linkedin|github|^[+()\d -]+$/i.test(resume.name)) resume.name = '';
  const possibleTitle = lines[1] || '';
  if (ROLE_NAME.test(possibleTitle) && possibleTitle.length <= 120 && !possibleTitle.includes('@') && !identifyHeading(possibleTitle) && !/https?:|linkedin|github|\+?\d[\d ()-]{7,}/i.test(possibleTitle) && !possibleTitle.includes('|')) resume.title = possibleTitle;
  const email = rawText.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || '';
  const phone = (lines.join('\n').match(/(?:\+?\d[\d ()-]{7,}\d)/g) || []).find((value) => {
    const count = value.replace(/\D/g, '').length;
    return count >= 10 && count <= 15;
  }) || '';
  resume.contact.email = email; resume.contact.phone = phone;
  const explicitUrls = rawText.match(/https?:\/\/[^\s)]+|(?:linkedin\.com|github\.com)\/[^\s)]+/gi) || [];
  const headerUrls = lines.join('\n').match(/(?<![\w@.-])(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|org|net|in|io|dev|me|app|co|uk)(?:\/[^\s|)]*)?(?![\w.])/gi) || [];
  const urls = [...new Map([...explicitUrls, ...headerUrls].map((url) => [url.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase(), url])).values()];
  resume.links = urls.map((url) => ({ id: crypto.randomUUID(), label: url.includes('linkedin') ? 'LinkedIn' : url.includes('github') ? 'GitHub' : 'Portfolio', url: url.startsWith('http') ? url : `https://${url}` }));
  const headerLines = sections.header || [];
  const contactParts = headerLines.flatMap((line) => line.split('|')).map((part) => part.trim());
  resume.contact.location = contactParts.find((part) => part && !part.includes('@') && !/linkedin|github|https?:|\+?\d[\d ()-]{7,}/i.test(part) && !headerUrls.includes(part) && part !== resume.name && part !== resume.title && part !== firstLine) || '';
  const summaryKey = Object.keys(sections).find((key) => /summary|profile/.test(key));
  if (summaryKey) resume.summary = sections[summaryKey].join(' ');
  const skillsKey = Object.keys(sections).find((key) => key.includes('skills'));
  if (skillsKey) resume.skillGroups = parseSkillLines(sections[skillsKey]);
  const certKey = Object.keys(sections).find((key) => /certification|license/.test(key));
  if (certKey) resume.certifications = sections[certKey].map((name) => ({ id: crypto.randomUUID(), name: name.replace(/^[-•]\s*/, ''), issuer: '', date: '' }));
  resume.languages = (sections.languages || []).flatMap((line) => line.replace(BULLET_START, '').split(/[,;|•]/)).map((value) => value.trim()).filter(Boolean);
  const experienceKey = Object.keys(sections).find((key) => /experience|work\s+history|employment/.test(key));
  if (experienceKey) resume.experience = parseExperienceLines(sections[experienceKey], parsingWarnings);
  const educationKey = Object.keys(sections).find((key) => /education|academic/.test(key));
  if (educationKey) resume.education = parseEducationLines(sections[educationKey]);
  resume.projects = extractProjectDescriptions(rawText).map((project) => ({
    id: crypto.randomUUID(), masterId: undefined, name: project.name, subtitle: '', link: '', startDate: '', endDate: '',
    bullets: project.description ? [{ id: crypto.randomUUID(), text: project.description }] : [],
  }));
  resume.ambiguities = ['Basic on-device parsing was used. Review all fields, dates, and OCR text carefully before saving the master resume.', ...parsingWarnings];
  if (resume.experience.some((entry) => !entry.role || !entry.company)) resume.ambiguities.push('Some work headings could not be separated into a role and employer. Review the Experience section against your upload.');
  if (sections.other?.length) resume.ambiguities.push(`Additional source content needs manual placement: ${sections.other.join(' ').slice(0, 1800)}`);
  return normalizeResume(resume);
}
