const PAGE = { width: 210, height: 297, margin: 17 };
const safe = (value) => value || '';

export async function downloadResumePdf(resume, filename = 'tailored-resume.pdf') {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = PAGE.margin;
  const usable = PAGE.width - PAGE.margin * 2;
  const checkPage = (needed = 8) => { if (y + needed > PAGE.height - PAGE.margin) { doc.addPage(); y = PAGE.margin; } };
  const line = (text, options = {}) => {
    const { size = 9.2, bold = false, color = [36, 35, 42], gap = 1.3, url } = options;
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    const parts = doc.splitTextToSize(safe(text), usable); checkPage(parts.length * size * 0.38 + 3);
    if (url) doc.textWithLink(parts[0], PAGE.margin, y, { url }); else doc.text(parts, PAGE.margin, y);
    y += parts.length * size * 0.38 + gap;
  };
  const section = (title) => { if (!title) return; checkPage(12); y += 2.5; line(title.toUpperCase(), { size: 9, bold: true, color: [93, 64, 164], gap: 1 }); doc.setDrawColor(210, 202, 230); doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y); y += 3; };
  const itemHeader = (left, right) => { checkPage(9); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(30, 28, 35); doc.text(safe(left), PAGE.margin, y); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(safe(right), PAGE.width - PAGE.margin, y, { align: 'right' }); y += 4.3; };
  const bullet = (text) => { const parts = doc.splitTextToSize(safe(text), usable - 5); checkPage(parts.length * 3.5 + 2); doc.circle(PAGE.margin + 1, y - 1, 0.45, 'F'); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8); doc.setTextColor(45, 43, 50); doc.text(parts, PAGE.margin + 4, y); y += parts.length * 3.5 + 1.2; };

  line(resume.name, { size: 20, bold: true, color: [35, 26, 55], gap: 2 });
  line(resume.title, { size: 11, color: [93, 64, 164], gap: 2 });
  const contacts = [resume.contact.email, resume.contact.phone, resume.contact.location].filter(Boolean).join('  •  ');
  if (contacts) line(contacts, { size: 8.5, gap: 1 });
  resume.links.filter((x) => x.url).forEach((link) => line(link.label || link.url, { size: 8.5, color: [76, 55, 135], url: link.url, gap: 0.6 }));
  if (resume.summary) { section('Professional summary'); line(resume.summary); }
  if (resume.skillGroups.length) { section('Skills'); resume.skillGroups.forEach((group) => line(`${group.name}${group.name ? ': ' : ''}${group.skills.join(', ')}`, { size: 8.8 })); }
  if (resume.experience.length) { section('Experience'); resume.experience.forEach((item) => { itemHeader([item.role, item.company].filter(Boolean).join(' — '), [item.startDate, item.endDate].filter(Boolean).join(' – ')); item.bullets.forEach((b) => bullet(b.text)); y += 1; }); }
  if (resume.projects.length) { section('Projects'); resume.projects.forEach((item) => { itemHeader([item.name, item.subtitle].filter(Boolean).join(' — '), [item.startDate, item.endDate].filter(Boolean).join(' – ')); item.bullets.forEach((b) => bullet(b.text)); y += 1; }); }
  if (resume.education.length) { section('Education'); resume.education.forEach((item) => { itemHeader([item.qualification, item.institution].filter(Boolean).join(' — '), [item.startDate, item.endDate].filter(Boolean).join(' – ')); if (item.details) line(item.details, { size: 8.8 }); }); }
  if (resume.certifications.length) { section('Certifications'); resume.certifications.forEach((item) => line([item.name, item.issuer, item.date].filter(Boolean).join(' — '), { size: 8.8 })); }
  doc.save(filename.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase());
}
