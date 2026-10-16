const fs=require('fs');
const p='src/services/matchingService.js';let s=fs.readFileSync(p,'utf8'); const start=s.indexOf('const STOPWORDS');const end=s.indexOf('\nconst hasText');s="import { canonicalTerm, containsTerm, resumeEvidence } from './atsAnalysis';\n"+`// Offline helper only. The application ATS report uses validated AI extraction.
const TERMS = ['React', 'React Native', 'Java', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'Git', 'REST API', 'Jest', 'Redux', 'CI/CD', 'Figma', 'Research', 'Accessibility', 'Prototyping'];
export function analyzeMatch(resume, jobDescription) {
  const normalize = (text) => String(text).toLowerCase().replace(/react\\.js|reactjs/g, 'react').replace(/html5/g, 'html').replace(/css3/g, 'css').replace(/rest apis/g, 'rest api');
  const jd = normalize(jobDescription || '');
  const text = normalize(resumeEvidence(resume));
  const keywords = TERMS.map(canonicalTerm).filter((term) => containsTerm(jd, term));
  const matched = keywords.filter((term) => containsTerm(text, term));
  return { keywords, matched, missing: keywords.filter((term) => !matched.includes(term)), coverage: keywords.length ? Math.round(100 * matched.length / keywords.length) : null };
}
`+s.slice(end);fs.writeFileSync(p,s);
const storage='src/services/storageService.js';s=fs.readFileSync(storage,'utf8');s=s.replace('    if (parsed.masterResume)',`    // Validate older drafts with schema defaults; isolate invalid drafts from the master.
    const recoverDraft = (draft) => {
      const result = tailoredResultSchema.safeParse(draft);
      return result.success ? { ...draft, ...result.data } : null;
    };
    parsed.versions = (Array.isArray(parsed.versions) ? parsed.versions : []).map(recoverDraft).filter(Boolean);
    parsed.current = recoverDraft(parsed.current);
    if (parsed.masterResume)`);fs.writeFileSync(storage,s);
