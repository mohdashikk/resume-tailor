import { registerResumeFonts } from './resumeFonts.js';
import { projectDisplayName, projectDisplaySubtitle } from './projectRecoveryService.js';

const PAGE = { width: 210, height: 297, left: 10.5, right: 10.5, top: 14, bottom: 17 };
const COLOR = { ink: [24, 24, 24], muted: [84, 84, 84], rule: [181, 181, 181] };
const PT_TO_MM = 0.3528;

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

export async function createResumePdfDocument(resume) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  await registerResumeFonts(doc);
  const usable = PAGE.width - PAGE.left - PAGE.right;
  let y = PAGE.top;
  let activeSection = '';

  doc.setProperties({
    title: `${sanitizePdfText(resume.name) || 'Resume'} - Resume`,
    subject: 'ATS-friendly professional resume',
    author: sanitizePdfText(resume.name),
    creator: 'doitnext.ai Resume Tailor',
  });
  doc.setLineHeightFactor(1.15);

  const setType = (size = 9.8, style = 'normal', color = COLOR.ink) => {
    doc.setFont('Inter', style === 'bold' ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.setCharSpace(0);
  };
  const lineHeight = (size) => size * PT_TO_MM * 1.6;
  const split = (text, width, size = 9.8, style = 'normal') => {
    setType(size, style);
    return doc.splitTextToSize(sanitizePdfText(text), Math.max(width, 12));
  };
  const continuation = () => {
    if (!activeSection) return;
    setType(7.2, 'bold', COLOR.muted);
    doc.text(`${activeSection.toUpperCase()} - CONTINUED`, PAGE.left, y);
    y += 8;
    doc.setDrawColor(...COLOR.rule);
    doc.line(PAGE.left, y - 5, PAGE.width - PAGE.right, y - 5);
  };
  const addPage = () => {
    doc.addPage();
    y = PAGE.top;
    continuation();
  };
  const ensureSpace = (height) => {
    if (y + height > PAGE.height - PAGE.bottom) addPage();
  };
  const writeParagraph = (text, options = {}) => {
    const { size = 9.8, style = 'normal', color = COLOR.ink, x = PAGE.left, width = usable, gap = 1.3, url = '' } = options;
    const lines = split(text, width, size, style);
    const leading = lineHeight(size);
    if (!lines.length) return;
    lines.forEach((line, index) => {
      ensureSpace(leading + gap);
      setType(size, style, color);
      if (url && index === 0) doc.textWithLink(line, x, y, { url });
      else doc.text(line, x, y);
      y += leading;
    });
    y += gap;
  };
  const section = (title) => {
    if (y + 13 > PAGE.height - PAGE.bottom) {
      doc.addPage();
      y = PAGE.top;
    }
    activeSection = title;
    y += 3.4;
    setType(9.8, 'bold', COLOR.ink);
    doc.text(title.toUpperCase(), PAGE.left, y);
    doc.setDrawColor(...COLOR.rule);
    doc.setLineWidth(0.25);
    doc.line(PAGE.left, y + 1.8, PAGE.width - PAGE.right, y + 1.8);
    y += 5.8;
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
    const size = 9.8;
    setType(size, 'bold');
    const labelWidth = doc.getTextWidth(`${label}: `);
    if (labelWidth > usable * 0.6) {
      writeParagraph(`${label}:`, { size, style: 'bold', gap: 0 });
      writeParagraph(value, { size, gap: 1 });
      return;
    }
    const words = value.split(' ');
    let first = '';
    setType(size);
    while (words.length && doc.getTextWidth([first, words[0]].filter(Boolean).join(' ')) <= usable - labelWidth) {
      first = [first, words.shift()].filter(Boolean).join(' ');
    }
    ensureSpace(lineHeight(size) * 2);
    setType(size, 'bold');
    doc.text(`${label}:`, PAGE.left, y);
    setType(size);
    doc.text(first, PAGE.left + labelWidth, y);
    y += lineHeight(size);
    if (words.length) writeParagraph(words.join(' '), { size, gap: 1 });
    else y += 1;
  };
  const writeItemHeader = (left, right = '') => {
    const safeLeft = sanitizePdfText(left);
    const safeRight = sanitizePdfText(right);
    setType(8.1, 'normal', COLOR.muted);
    const dateWidth = safeRight ? Math.min(doc.getTextWidth(safeRight) + 4, usable * 0.45) : 0;
    const leftWidth = usable - dateWidth;
    const leftLines = split(safeLeft, leftWidth, 9.8, 'bold');
    const leading = lineHeight(9.8);
    ensureSpace(Math.max(leftLines.length * leading, 5) + 3);
    leftLines.forEach((line, index) => {
      setType(9.8, 'bold', COLOR.ink);
      doc.text(line, PAGE.left, y + index * leading);
    });
    if (safeRight) {
      setType(8.1, 'normal', COLOR.muted);
      doc.text(safeRight, PAGE.width - PAGE.right, y, { align: 'right' });
    }
    y += Math.max(leftLines.length * leading, leading) + 0.8;
  };
  const writeBullet = (text) => {
    const lines = split(text, usable - 6, 9.8, 'normal');
    if (!lines.length) return;
    const leading = lineHeight(9.8);
    ensureSpace(lines.length * leading + 1.2);
    setType(9.8, 'bold', COLOR.ink);
    doc.circle(PAGE.left + 1.1, y - 1.05, 0.45, 'F');
    lines.forEach((line, index) => {
      setType(9.8, 'normal', COLOR.ink);
      doc.text(line, PAGE.left + 4.2, y + index * leading);
    });
    y += lines.length * leading + 0.9;
  };
  const writeEntry = (item, type) => {
    const heading = type === 'experience'
      ? [item.role, item.company].filter(Boolean).join(', ')
      : [projectDisplayName(item), projectDisplaySubtitle(item)].filter(Boolean).join(' - ');
    const dates = [item.startDate, item.endDate].filter(Boolean).join(' - ');
    writeItemHeader(heading, [dates, item.location].filter(Boolean).join(' | '));
    if (type === 'project' && item.link) writeParagraph(item.link, { size: 8.1, color: COLOR.muted, url: item.link, gap: 0.8 });
    (item.bullets || []).filter((bullet) => bullet.text).forEach((bullet) => writeBullet(bullet.text));
    y += 1.2;
  };

  // Keep the export visually aligned with the clean, single-column live preview.
  y = PAGE.top + 2;
  writeParagraph((resume.name || 'Your name').toUpperCase(), { size: 18, style: 'bold', gap: 0.4 });
  if (resume.title) writeParagraph(resume.title, { size: 10.5, style: 'bold', gap: 1.2 });
  const contact = [];
  if (resume.contact?.email) contact.push({ label: resume.contact.email, url: `mailto:${resume.contact.email}` });
  if (resume.contact?.phone) contact.push({ label: resume.contact.phone, url: `tel:${resume.contact.phone.replace(/\s/g, '')}` });
  if (resume.contact?.location) contact.push({ label: resume.contact.location, url: '' });
  writeInlineLinks([...contact, ...(resume.links || []).filter((link) => link.url).map((link) => ({ label: link.label || link.url, url: link.url }))], 9);
  y += 2;

  if (resume.summary) { section('Professional summary'); writeParagraph(resume.summary, { size: 9.8, gap: 0.8 }); }
  if (resume.skillGroups?.length) { section('Skills'); resume.skillGroups.forEach(writeSkillGroup); }
  if (resume.experience?.length) { section('Professional experience'); resume.experience.forEach((item) => writeEntry(item, 'experience')); }
  if (resume.projects?.length) { section(resume.projectSectionTitle || 'Projects'); resume.projects.forEach((item) => writeEntry(item, 'project')); }
  if (resume.education?.length) {
    section('Education');
    resume.education.forEach((item) => {
      writeItemHeader([item.qualification, item.institution].filter(Boolean).join(' - '), [item.startDate, item.endDate].filter(Boolean).join(' - '));
      const educationMeta = [item.location, item.details].filter(Boolean).join(' | ');
      if (educationMeta) writeParagraph(educationMeta, { size: 8.45, color: COLOR.muted, gap: 1.4 });
    });
  }
  if (resume.certifications?.length) {
    section('Certifications');
    resume.certifications.forEach((item) => writeParagraph([item.name, item.issuer, item.date].filter(Boolean).join(' - '), { size: 9.8, gap: 0.8 }));
  }

  if (resume.languages?.some((value) => value.trim())) {
    section('Languages');
    writeParagraph(resume.languages.map((value) => value.trim()).filter(Boolean).join(', '), { size: 9.8, gap: 0.8 });
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...COLOR.rule);
    doc.setLineWidth(0.25);
    doc.line(PAGE.left, PAGE.height - 11, PAGE.width - PAGE.right, PAGE.height - 11);
    setType(7.2, 'normal', COLOR.muted);
    doc.text(`Page ${page} of ${pages}`, PAGE.width - PAGE.right, PAGE.height - 7.5, { align: 'right' });
  }
  doc.setPage(1);
  return doc;
}

export async function downloadResumePdf(resume, filename = 'tailored-resume.pdf') {
  const doc = await createResumePdfDocument(resume);
  doc.save(filename.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase());
}
