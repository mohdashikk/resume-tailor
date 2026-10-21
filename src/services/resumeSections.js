const headings = {
  summary: ['professional summary', 'career summary', 'summary', 'profile', 'professional profile', 'objective', 'career objective', 'about me'],
  skills: ['skills', 'core skills', 'technical skills', 'technical expertise', 'core competencies', 'key skills', 'skills and tools', 'technologies'],
  experience: ['experience', 'professional experience', 'work experience', 'work history', 'employment', 'employment history', 'career history', 'internships'],
  projects: ['projects', 'selected projects', 'freelance projects', 'selected freelance projects', 'personal projects', 'academic projects'],
  education: ['education', 'academic background', 'academic qualifications', 'qualifications', 'educational qualifications'],
  certifications: ['certification', 'certifications', 'license', 'licenses', 'certifications and licenses'],
  languages: ['languages', 'language', 'languages spoken'],
  other: ['awards', 'publications', 'interests', 'references', 'volunteering', 'volunteer experience', 'achievements'],
};
const canonical = (value) => value.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
export function identifyHeading(line) {
  const match = String(line).trim().match(/^([^:]+?)(?:\s*:\s*(.*))?$/);
  if (!match) return null;
  const label = canonical(match[1]).replace(/\s*[-–—]\s*continued$/i, '');
  const section = Object.keys(headings).find((key) => headings[key].includes(label));
  return section ? { section, title: match[1].trim(), content: match[2]?.trim() || '' } : null;
}
export function splitResumeSections(rawText) {
  // Repair flattened uppercase headings without splitting ordinary sentences.
  const titles = Object.values(headings).flat().sort((a, b) => b.length - a.length).map((s) => s.toUpperCase()).join('|');
  const prepared = String(rawText || '').replace(new RegExp(`(^|\\s)(${titles})(?=\\s|:|$)`, 'g'), '$1\n$2\n');
  const sections = { header: [] }; let active = 'header'; let previousBlank = true;
  for (const raw of prepared.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { previousBlank = true; continue; }
    if (/^[-–—]\s*CONTINUED$/i.test(line)) continue;
    // Page labels in imported/generated PDFs are layout chrome, not resume
    // content. In particular they must not become education details.
    if (/^(?:(?:[\w.-]+\s+)?resume\s+)?page\s+\d+\s+of\s+\d+$/i.test(line)) continue;
    const heading = identifyHeading(line);
    // OCR can wrap a bullet at a word such as "projects". A lowercase label
    // attached to the preceding line is prose, not a new section heading.
    const wrappedLowercaseWord = heading && line === line.toLowerCase() && !line.includes(':') && !previousBlank;
    if (heading && !wrappedLowercaseWord) { active = heading.section; sections[active] ||= []; if (heading.content) sections[active].push(heading.content); }
    else { sections[active] ||= []; sections[active].push(line.replace(/^:\s*/, '')); }
    previousBlank = false;
  }
  return sections;
}
