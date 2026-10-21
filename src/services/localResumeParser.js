import { blankResume, normalizeResume } from './resumeValidation.js';
import { extractProjectDescriptions, extractProjectSectionTitle } from './projectRecoveryService.js';
import { identifyHeading, splitResumeSections } from './resumeSections.js';

const DATE_TOKEN = /\b(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?(?:19|20)\d{2}\b|\bpresent\b|\bcurrent\b/gi;
const BULLET_START = /^(?:[•●▪◦+«»*=-]\s*)+/;
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
  const standaloneRole = (value) => roleLike(value) && value.length <= 80
    && !/[.!?]/.test(value) && value.split(/\s+/).length <= 7;
  const locationLine = (value) => value.length <= 80 && /^[\p{L}][\p{L}\s.'-]+,\s*[\p{L}\s.'-]+$/u.test(value);
  const createEntry = (header, dates) => {
    const headerDates = dates || header.map(parseDateRange).find(Boolean);
    const earlierDates = header.slice(0, -1).map(parseDateRange).find(Boolean);
    const heading = header.map((line) => {
      const found = parseDateRange(line);
      return found ? `${line.slice(0, found.index)} ${line.slice(found.endIndex)}`.trim() : line;
    });
    const parts = heading.flatMap((line) => line.split(/\s+\|\s+|\s+[-–—]\s+|\s+at\s+/i)).flatMap((part) => {
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
    const company = parts.shift() || '';
    let location = parts.join(' — ');
    const ocrTail = location.match(/\s+([a-z]{1,2}\s*-\s*[a-z]{1,2})$/);
    if (ocrTail && location.includes(',')) {
      warnings.push(`Unclear OCR text after the location for ${role || 'an experience entry'} at ${company}: ${ocrTail[1]}. Verify it against the upload.`);
      location = location.slice(0, ocrTail.index).trim();
    }
    return { id, masterId: id, role: headingField(role, 'role', 500), company: headingField(company, 'company', 500), location: headingField(location, 'location', 120), startDate: headerDates?.startDate || earlierDates?.startDate || '', endDate: headerDates?.endDate || earlierDates?.endDate || '', bullets: [] };
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const dates = parseDateRange(line);
    const prefix = dates ? line.slice(0, dates.index).replace(/[\s|~–—-]+$/, '') : '';
    const nextLine = lines[index + 1]?.trim() || '';
    const roleThenCompany = dates && roleLike(prefix) && prefix.length <= 80
      && !/\s(?:at|\|)\s|\s[-–—]\s/i.test(prefix) && nextLine && !BULLET_START.test(nextLine)
      && !roleLike(nextLine);
    if (roleThenCompany) { pending.push(line); continue; }
    if (!BULLET_START.test(line) && dates && prefix.length <= 180
      && (roleLike(prefix) || pending.some(standaloneRole))) {
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
      current.bullets.push({ id: crypto.randomUUID(), text: line.replace(BULLET_START, '').replace(/^[.:]\s*/, '').trim() });
      continue;
    }
    if (standaloneRole(line)) { pending.push(line); continue; }
    if (current && !pending.length) {
      if (!current.bullets.length && !current.location && locationLine(line)) { current.location = line; continue; }
      // Text-based PDF exports often omit the visible bullet glyph. Preserve
      // each sentence as a point and join only obvious wrapped continuations.
      if (current.bullets.length && /^[a-z]/.test(line)) {
        const bullet = current.bullets.at(-1);
        bullet.text = `${bullet.text} ${line}`.replace(/\s+/g, ' ').trim();
      } else current.bullets.push({ id: crypto.randomUUID(), text: line });
      continue;
    }
    pending.push(line);
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
      let qualification = (dates ? line.slice(0, dates.index) : line)
        .replace(/expected\s*:?\s*$/i, '')
        .replace(/\s*[-–—]?\s*CONTINUED\s*$/i, '')
        .replace(/\s+[-–—|]\s*$/, '')
        .trim();
      let institution = pendingInstitution;
      let location = '';
      const institutionPart = qualification.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (institutionPart && !/^distance education$/i.test(institutionPart[2])
        && /\b(education|college|university|school|institute|academy|polytechnic)\b/i.test(institutionPart[2])) {
        qualification = institutionPart[1];
        const parts = institutionPart[2].split(/,\s*/);
        institution = parts.shift() || institution;
        location = parts.join(', ');
      }
      current = {
        id, institution, qualification, location,
        startDate: dates?.endDate && !expected ? dates.startDate : '',
        endDate: dates?.endDate || dates?.startDate || '',
        details: '',
      };
      entries.push(current);
      pendingInstitution = '';
      return;
    }
    if (current && /student|grade|gpa|expected/i.test(line)) { current.details = [current.details, line].filter(Boolean).join(' '); return; }
    if (current && /^distance education$/i.test(line) && !current.institution) { current.qualification = `${current.qualification} — ${line}`; return; }
    if (!current || qualificationStart.test(lines[index + 1] || '')) { pendingInstitution = [pendingInstitution, line].filter(Boolean).join(' '); return; }
    const dates = parseDateRange(line);
    if (dates && dates.index === 0) { current.startDate = dates.startDate; current.endDate = dates.endDate; return; }
    if (current.location && current.location.toLowerCase() === line.toLowerCase()) return;
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

// Many designed PDFs omit separators between individual skill labels. Match
// recognizable phrases only when their words appear in the source; keep any
// unmatched span as written rather than inventing a skill or dropping text.
const SKILL_PHRASES = [
  'Design Handoff (Zeplin / Figma Dev Mode)', 'Debugging & Problem Solving',
  'Component-Based Architecture', 'Cross-Browser Compatibility',
  'Information Architecture', 'Performance Optimization', 'Accessibility (WCAG)',
  'React Testing Library', 'Responsive Design', 'Interaction Design', 'Usability Testing',
  'Design Systems', 'User Research', 'Visual Design', 'Adobe XD', 'Tailwind CSS',
  'React Native', 'React.js', 'Node.js', 'HTML/CSS', 'UI/UX', 'CI/CD',
  'Figma', 'Wireframing', 'Prototyping', 'HTML', 'CSS', 'Tailwind', 'Sass',
  'JavaScript', 'TypeScript', 'React', 'GitHub', 'Git', 'Agile', 'Scrum',
  'Python', 'Java', 'SQL', 'Docker', 'Kubernetes', 'AWS', 'Azure',
];
const skillPhrasePattern = (phrase) => new RegExp(`(?<![a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+').replace(/ /g, '\\s+')}(?![a-z0-9])`, 'gi');

function splitSkillSequence(value) {
  const source = String(value || '').replace(/\bDesign,\s*Systems\b/gi, 'Design Systems').replace(/\bUl\b/g, 'UI').replace(/\bReact\.Js\b/gi, 'React.js').replace(/\s+/g, ' ').trim();
  if (!source) return [];
  const occupied = new Array(source.length).fill(false);
  const matches = [];
  for (const phrase of [...SKILL_PHRASES].sort((a, b) => b.length - a.length)) {
    for (const match of source.matchAll(skillPhrasePattern(phrase))) {
      const start = match.index; const end = start + match[0].length;
      if (occupied.slice(start, end).some(Boolean)) continue;
      occupied.fill(true, start, end);
      matches.push({ start, end, name: phrase });
    }
  }
  const items = [];
  const addUnknown = (fragment) => {
    for (const part of fragment.split(/[,;|•]/)) {
      const text = part.replace(/^[\s/&()]+|[\s/&()]+$/g, '').trim();
      if (text && !/^(?:and|or)$/i.test(text)) items.push(text);
    }
  };
  let cursor = 0;
  for (const match of matches.sort((a, b) => a.start - b.start)) {
    addUnknown(source.slice(cursor, match.start));
    items.push(match.name);
    cursor = match.end;
  }
  addUnknown(source.slice(cursor));
  return [...new Map(items.map((item) => [item.toLowerCase(), item])).values()];
}

function parseSkillLines(lines) {
  const groups = [];
  lines.forEach((rawLine) => {
    const line = rawLine.replace(BULLET_START, '').trim();
    if (!line) return;
    // Category headings are labels, not individual skills. Some PDFs place
    // the label and its values on separate lines without a colon.
    if (/^(?:front[ -]?end|back[ -]?end|devops|frameworks|tools|databases|programming languages|design tools|cloud|platforms)(?:\s*[&/]\s*(?:tools|devops|cloud|platforms|frameworks))?\s*:?$/i.test(line)) {
      groups.push({ id: crypto.randomUUID(), name: line.replace(/:$/, '').trim(), source: [] });
      return;
    }
    const colonIndex = line.indexOf(':');
    const hasGroup = colonIndex > 0 && colonIndex < 45;
    if (hasGroup || !groups.length) groups.push({ id: crypto.randomUUID(), name: hasGroup ? line.slice(0, colonIndex).trim() : 'Skills', source: [] });
    groups.at(-1).source.push(hasGroup ? line.slice(colonIndex + 1).trim() : line);
  });
  return groups.map(({ id, name, source }) => ({ id, name, skills: splitSkillSequence(source.join(' ')) }));
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
