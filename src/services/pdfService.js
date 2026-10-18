import { registerResumeFonts } from './resumeFonts.js';
import { projectDisplayName, projectDisplaySubtitle } from './projectRecoveryService.js';
import { groupSkillsForResume } from './skillGroupingService.js';
import { educationDetails, resumeLink } from './resumePresentation.js';

const PAGE = { width: 210, height: 297, left: 30 / (72 / 25.4), right: 30 / (72 / 25.4), top: 38.4375 / (72 / 25.4), bottom: 15 };
const COLOR = { ink: [24, 24, 24], muted: [84, 84, 84], rule: [181, 181, 181] };
const PT_TO_MM = 25.4 / 72;

export function sanitizePdfText(value) {
  return String(value || '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calculateSkillLabelColumnWidth(groups, measureText, usableWidth) {
  const minimumWidth = 35;
  const maximumWidth = usableWidth * 0.42;
  const widestLabel = (groups || []).reduce((width, group) => {
    const label = sanitizePdfText(group.name || 'Skills').toUpperCase();
    return Math.max(width, measureText(label));
  }, 0);

  return Math.min(maximumWidth, Math.max(minimumWidth, widestLabel + 4));
}

export async function createResumePdfDocument(resume, { keywords = [] } = {}) {
  resume = { ...resume, skillGroups: groupSkillsForResume(resume) };
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  await registerResumeFonts(doc);
  const usable = PAGE.width - PAGE.left - PAGE.right;
  let y = PAGE.top;

  doc.setProperties({
    title: `${sanitizePdfText(resume.name) || 'Resume'} - Resume`,
    subject: 'ATS-friendly professional resume',
    author: sanitizePdfText(resume.name),
    creator: 'doitnext.ai Resume Tailor',
  });
  doc.setLineHeightFactor(1.15);

  const setType = (size = 9.75, style = 'normal', color = COLOR.ink) => {
    doc.setFont('Inter', style === 'bold' ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.setCharSpace(0);
  };
  const lineHeight = (size) => size * PT_TO_MM * 1.625;
  const split = (text, width, size = 9.75, style = 'normal') => {
    setType(size, style);
    return doc.splitTextToSize(sanitizePdfText(text), Math.max(width, 12));
  };
  const terms = keywords.filter(Boolean).sort((a, b) => b.length - a.length).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const emphasis = new RegExp(`(^|[^a-z0-9+#])(${terms ? terms + '|' : ''}\\d+(?:\\.\\d+)?(?:%|\\+))(?=$|[^a-z0-9+#])`, 'gi');
  const styledLines = (text, width, size = 9.75, prefix = '') => {
    const value = sanitizePdfText(text), runs = []; let cursor = 0;
    for (const match of value.matchAll(emphasis)) {
      const start = match.index + match[1].length;
      runs.push({ text: value.slice(cursor, start), bold: false }, { text: match[2], bold: true }); cursor = start + match[2].length;
    }
    runs.push({ text: value.slice(cursor), bold: false });
    if (prefix) runs.unshift({ text: prefix, bold: true });
    const lines = [[]]; let used = 0;
    for (const run of runs) for (const word of run.text.split(/(\s+)/).filter(Boolean)) {
      setType(size, run.bold ? 'bold' : 'normal');
      const w = doc.getTextWidth(word);
      if (used + w > width && used && word.trim()) { lines.push([]); used = 0; }
      if (!used && !word.trim()) continue;
      // Long URLs and identifiers must wrap rather than leave the page.
      if (w > width) {
        for (const char of word) { const cw = doc.getTextWidth(char); if (used + cw > width && used) { lines.push([]); used = 0; } lines.at(-1).push({ text: char, bold: run.bold }); used += cw; }
      } else { lines.at(-1).push({ text: word, bold: run.bold }); used += w; }
    }
    return lines;
  };
  const drawStyledLine = (line, x, baseline, size = 9.75, color = COLOR.ink) => {
    for (const run of line) { setType(size, run.bold ? 'bold' : 'normal', color); doc.text(run.text, x, baseline); x += doc.getTextWidth(run.text); }
  };
  const addPage = () => {
    doc.addPage();
    y = PAGE.top;
  };
  const ensureSpace = (height) => {
    if (y + height > PAGE.height - PAGE.bottom) addPage();
  };
  const writeParagraph = (text, options = {}) => {
    const { size = 9.75, style = 'normal', color = COLOR.ink, x = PAGE.left, width = usable, gap = 1.3, url = '' } = options;
    const lines = style === 'normal' && !url ? styledLines(text, width, size) : split(text, width, size, style);
    const leading = lineHeight(size);
    if (!lines.length) return;
    lines.forEach((line, index) => {
      ensureSpace(size * PT_TO_MM * .25);
      setType(size, style, color);
      if (Array.isArray(line)) drawStyledLine(line, x, y, size, color);
      else if (url && index === 0) doc.textWithLink(line, x, y, { url });
      else doc.text(line, x, y);
      y += leading;
    });
    y += 3 * PT_TO_MM;
  };
  const section = (title) => {
    if (y + 13 > PAGE.height - PAGE.bottom) {
      doc.addPage();
      y = PAGE.top;
    }
    y += 12 * PT_TO_MM;
    setType(9.75, 'bold', COLOR.ink);
    doc.text(title.toUpperCase(), PAGE.left, y);
    doc.setDrawColor(...COLOR.rule);
    doc.setLineWidth(0.25);
    doc.line(PAGE.left, y + 7.40625 * PT_TO_MM, PAGE.width - PAGE.right, y + 7.40625 * PT_TO_MM);
    y += 24.84375 * PT_TO_MM;
  };
  const writeInlineLinks = (items, size = 8.1, startX = PAGE.left) => {
    if (!items.length) return;
    const separator = '  |  ';
    let x = startX;
    const maxX = PAGE.width - PAGE.right;
    const nextLine = () => { y += lineHeight(size) + 0.6; x = startX; };
    setType(size, 'normal', COLOR.muted);
    items.forEach((item, index) => {
      const label = sanitizePdfText(item.label);
      if (!label) return;
      const parts = split(label, usable, size);
      const separatorWidth = index ? doc.getTextWidth(separator) : 0;
      if (x > startX && x + separatorWidth + doc.getTextWidth(parts[0]) > maxX) nextLine();
      if (x > startX) { doc.text(separator, x, y); x += separatorWidth; }
      parts.forEach((part, partIndex) => {
        if (partIndex > 0) nextLine();
        setType(size, 'normal', COLOR.muted);
        if (item.url) doc.textWithLink(part, x, y, { url: item.url }); else doc.text(part, x, y);
        x += doc.getTextWidth(part);
      });
    });
    y += lineHeight(size) + 0.9;
  };
  const writeSkillGroup = (group) => {
    const label = sanitizePdfText(group.name || 'Skills');
    const value = sanitizePdfText((group.skills || []).join(', '));
    if (!value) return;
    const lines = styledLines(value, usable, 9.75, group.name ? `${label}: ` : '');
    for (const line of lines) { ensureSpace(9.75 * PT_TO_MM * .25); drawStyledLine(line, PAGE.left, y); y += lineHeight(9.75); }
    y += 3 * PT_TO_MM;
  };
  const writeItemHeader = (left, right = '', suffix = '') => {
    const safeLeft = sanitizePdfText(left);
    const safeRight = sanitizePdfText(right);
    setType(9, 'normal', COLOR.muted);
    const dateWidth = safeRight ? Math.min(doc.getTextWidth(safeRight) + 4, usable * 0.45) : 0;
    const leftWidth = usable - dateWidth;
    const leftLines = split(safeLeft, leftWidth, 9.75, 'bold');
    const leading = lineHeight(9.75);
    ensureSpace(Math.max(leftLines.length * leading, 5) + 3);
    leftLines.forEach((line, index) => {
      setType(9.75, 'bold', COLOR.ink);
      doc.text(line, PAGE.left, y + index * leading);
    });
    if (suffix) {
      setType(9.75, 'bold');
      const roleWidth = doc.getTextWidth(safeLeft);
      setType(9.75, 'normal');
      const label = ', ' + sanitizePdfText(suffix);
      if (roleWidth + doc.getTextWidth(label) <= leftWidth) doc.text(label, PAGE.left + roleWidth, y);
      else {
        const lines = split(label.replace(/^, /, ''), leftWidth, 9.75);
        lines.forEach((line, index) => doc.text(line, PAGE.left, y + (leftLines.length + index) * leading));
        y += lines.length * leading;
      }
    }
    if (safeRight) {
      setType(9, 'normal', COLOR.muted);
      doc.text(safeRight, PAGE.width - PAGE.right, y, { align: 'right' });
    }
    y += Math.max(leftLines.length * leading, leading) + 3 * PT_TO_MM;
  };
  const writeBullet = (text) => {
    const lines = styledLines(text, usable - 15 * PT_TO_MM);
    if (!lines.length) return;
    const leading = lineHeight(9.75);
    if (lines.length * leading < PAGE.height - PAGE.top - PAGE.bottom) ensureSpace((lines.length - 1) * leading + 9.75 * PT_TO_MM * .25);
    setType(9.75, 'bold', COLOR.ink);
    doc.circle(PAGE.left + 6 * PT_TO_MM, y - 1, 0.38, 'F');
    lines.forEach((line) => { ensureSpace(9.75 * PT_TO_MM * .25); drawStyledLine(line, PAGE.left + 15 * PT_TO_MM, y); y += leading; });
    y += 3 * PT_TO_MM;
  };
  const writeEntry = (item, type) => {
    const heading = type === 'experience'
      ? item.role
      : [projectDisplayName(item), projectDisplaySubtitle(item)].filter(Boolean).join(' - ');
    const dates = [item.startDate, item.endDate].filter(Boolean).join(' - ');
    writeItemHeader(heading, [dates, item.location].filter(Boolean).join(' · '), type === 'experience' ? item.company : '');
    if (type === 'project' && item.link) writeParagraph(item.link, { size: 8.1, color: COLOR.muted, url: item.link, gap: 0.8 });
    (item.bullets || []).filter((bullet) => bullet.text).forEach((bullet) => writeBullet(bullet.text));
    y += 9 * PT_TO_MM;
  };

  // Keep the export visually aligned with the clean, single-column live preview.
  y = 48.105 * PT_TO_MM;
  setType(18, 'bold'); doc.text(sanitizePdfText(resume.name || 'Your name').toUpperCase(), PAGE.left, y); y = 70.06125 * PT_TO_MM;
  if (resume.title) { const lines = split(resume.title, usable, 10.5, 'bold'); setType(10.5, 'bold', [66, 66, 66]); doc.text(lines, PAGE.left, y); y += lines.length * 19.91175 * PT_TO_MM; }
  const contact = [];
  if (resume.contact?.email) contact.push({ label: resume.contact.email, url: `mailto:${resume.contact.email}` });
  if (resume.contact?.phone) contact.push({ label: resume.contact.phone, url: `tel:${resume.contact.phone.replace(/\s/g, '')}` });
  if (resume.contact?.location) contact.push({ label: resume.contact.location, url: '' });
  writeInlineLinks([...contact, ...(resume.links || []).map(resumeLink).filter((link) => link.url)], 9);
  y += 1.219 * PT_TO_MM;

  if (resume.summary) { section('Professional summary'); writeParagraph(resume.summary, { size: 9.75, gap: 0.8 }); }
  if (resume.skillGroups?.length) { section('Skills'); resume.skillGroups.forEach(writeSkillGroup); }
  if (resume.experience?.length) { section('Professional experience'); resume.experience.forEach((item) => writeEntry(item, 'experience')); y -= 9 * PT_TO_MM; }
  if (resume.projects?.length) { section(resume.projectSectionTitle || 'Projects'); resume.projects.forEach((item) => writeEntry(item, 'project')); y -= 9 * PT_TO_MM; }
  if (resume.education?.length) {
    section('Education');
    resume.education.forEach((item) => {
      writeItemHeader(item.qualification, [item.startDate, item.endDate].filter(Boolean).join(' - '), item.institution);
      const educationMeta = [item.location, educationDetails(item)].filter(Boolean).join(' | ');
      if (educationMeta) writeParagraph(educationMeta, { size: 8.45, color: COLOR.muted, gap: 1.4 });
    });
  }
  if (resume.certifications?.length) {
    section('Certifications');
    resume.certifications.forEach((item) => writeParagraph([item.name, item.issuer, item.date].filter(Boolean).join(' - '), { size: 9.75, gap: 0.8 }));
  }

  if (resume.languages?.some((value) => value.trim())) {
    section('Languages');
    writeParagraph(resume.languages.map((value) => value.trim()).filter(Boolean).join(', '), { size: 9.75, gap: 0.8 });
  }

  doc.setPage(1);
  return doc;
}

export async function downloadResumePdf(resume, filename = 'tailored-resume.pdf', options = {}) {
  const doc = await createResumePdfDocument(resume, options);
  doc.save(filename.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase());
}
