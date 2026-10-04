import { blankResume, normalizeResume } from './resumeValidation';

const SECTION_NAMES = /^(professional\s+summary|summary|profile|skills|core\s+skills|technical\s+skills|experience|professional\s+experience|work\s+experience|employment|projects|selected\s+projects|selected\s+freelance\s+projects|education|certifications?|licenses?)\s*:?$/i;

export function parseResumeLocally(rawText) {
  const prepared = rawText
    .replace(/\s+(PROFESSIONAL SUMMARY|SUMMARY|PROFILE|CORE SKILLS|TECHNICAL SKILLS|PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EMPLOYMENT|SELECTED PROJECTS|PROJECTS|EDUCATION|CERTIFICATIONS?|LICENSES?)\s+/gi, '\n$1\n');
  const lines = prepared.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const resume = blankResume();
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
  const summaryKey = Object.keys(sections).find((key) => /summary|profile/.test(key));
  if (summaryKey) resume.summary = sections[summaryKey].join(' ');
  const skillsKey = Object.keys(sections).find((key) => key.includes('skills'));
  if (skillsKey) resume.skillGroups = [{ id: crypto.randomUUID(), name: 'Skills', skills: sections[skillsKey].join(',').split(/[,|•]/).map((x) => x.trim()).filter(Boolean) }];
  const certKey = Object.keys(sections).find((key) => /certification|license/.test(key));
  if (certKey) resume.certifications = sections[certKey].map((name) => ({ id: crypto.randomUUID(), name: name.replace(/^[-•]\s*/, ''), issuer: '', date: '' }));
  resume.ambiguities = ['Basic on-device parsing was used. Review all fields and add structured experience, projects, and education before saving the master resume.'];
  return normalizeResume(resume);
}
