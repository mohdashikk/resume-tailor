import { buildAnalysis, canonicalTerm, containsTerm, normalizeAliases, resumeEvidence, requirementText } from './atsAnalysis.js';

const skills = ['react', 'react native', 'java', 'javascript', 'typescript', 'html', 'css', 'git', 'rest api', 'jest', 'redux', 'ci/cd', 'python', 'node.js', 'sql', 'c', 'c++', 'c#', 'next.js', 'vue', 'angular', 'svelte', 'express', 'django', 'flask', 'fastapi', 'spring boot', 'php', 'ruby', 'graphql', 'mysql', 'postgresql', 'mongodb', 'redis', 'docker', 'kubernetes', 'terraform', 'aws', 'azure', 'gcp', 'github', 'gitlab', 'github actions', 'jenkins', 'figma', 'sketch', 'tailwind css', 'bootstrap', 'sass', 'vitest', 'cypress', 'playwright', 'selenium', 'unit testing', 'integration testing', 'accessibility', 'responsive design', 'agile', 'scrum', 'jira', 'communication', 'collaboration', 'leadership', 'user research'];
const negative = /\b(?:no|not|without|lack\w*|never)\b/i;
const durationPattern = /\b(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?\s*\+?\s*years?\b/i;

export function extractJobRequirements(jobDescription, resume) {
  if (String(jobDescription || '').trim().length < 80) throw new Error('Paste a fuller job description before checking ATS.');
  const evidence = resumeEvidence({ summary: resume.summary, skillGroups: resume.skillGroups?.map(group => ({ skills: group.skills })), experience: resume.experience, projects: resume.projects, education: resume.education, certifications: resume.certifications, languages: resume.languages })
    .split('\n').flatMap(line => line.split(/(?<=[!?;])\s+|(?<=\.)\s+(?=[A-Z])/)).filter(Boolean);
  // Requirement extraction must not change when a user edits the resume.
  const vocabulary = [...new Set([...skills, 'redux toolkit', 'redux saga', 'websocket', 'webrtc', 'canvas', 'webgl', 'telemetry', 'observability', 'screen sharing', 'real-time', 'debugging', 'component architecture', 'ux', 'storybook', 'eslint', 'sonarqube', 'react testing library', 'vite', 'nginx', 'wcag', 'prototyping', 'wireframing', 'interaction design', 'usability testing', 'design systems', 'information architecture', 'version control', 'performance optimization', 'authentication', 'authorization', 'api integration'])];
  const rows = new Map();
  let sectionPriority = 'required';
  const add = (term, source, priority, status, quotes = []) => {
    const key = canonicalTerm(term).slice(0, 200);
    // Standalone posting headings are not qualifications. Passing generic labels
    // to the validated report otherwise rejects the entire check.
    if (['experience', 'skills', 'developer', 'requirements'].includes(key.replace(/:$/, ''))) return;
    const previous = rows.get(key);
    if (!previous) rows.set(key, { term: key, source: source.slice(0, 2000), priority, status, evidence: quotes.map(quote => quote.slice(0, 2000)).slice(0, 10) });
    else {
      if (priority === 'required') previous.priority = 'required';
      if (status === 'matched' || (previous.status === 'missing' && status === 'uncertain')) { previous.status = status; previous.source = source.slice(0, 2000); }
      previous.evidence = [...new Set([...previous.evidence, ...quotes.map(quote => quote.slice(0, 2000))])].slice(0, 10);
    }
  };
  for (const line of requirementText(jobDescription).split(/\r?\n/)) {
    const clean = line.replace(/^\s*[-•*·▪◦]\s*/, '').trim();
    if (!clean) continue;
    if (/^(?:experience|work experience|professional experience|technical skills|skills|key skills|education|education and experience|job description|job summary|overview|candidate profile)\s*:?$/i.test(clean)) continue;
    if (/^(?:requirements|qualifications|responsibilities|what you.ll do|must.have|required(?: skills| qualifications)?|preferred(?: skills| qualifications)?|nice.to.have)\s*:?$/i.test(clean)) {
      sectionPriority = /preferred|nice.to.have/i.test(clean) ? 'preferred' : 'required';
      continue;
    }
    for (const source of clean.split(/(?<=[!?;])\s+|(?<=\.)\s+(?=[A-Z])/)) {
      const priority = /\b(?:preferred|desirable|optional|nice.to.have|a plus|a bonus)\b/i.test(source) ? 'preferred' : sectionPriority;
      const terms = vocabulary.filter(term => containsTerm(normalizeAliases(source), term));
      const duration = source.match(durationPattern);
      for (const term of terms) {
        const quotes = evidence.filter(quote => !negative.test(quote) && containsTerm(normalizeAliases(quote), term));
        // Keyword presence and qualified tenure are separate requirements. A
        // proficiency adjective must not erase direct evidence of the skill.
        add(term, source, priority, quotes.length ? 'matched' : 'missing', quotes);
      }
      if (/\b(?:expert|advanced|proficien\w*|strong|deep|extensive)\b/i.test(source) && terms.length) add(source, source, priority, 'uncertain');
      if (duration) {
        const minimum = Number(duration[1]);
        const quotes = evidence.filter(quote => {
          const stated = quote.match(durationPattern);
          return stated && !negative.test(quote) && Number(stated[1]) >= minimum && (!terms.length || terms.every(term => containsTerm(normalizeAliases(quote), term)));
        });
        // Do not sum overlapping roles or infer technology tenure from employment dates.
        add(`${minimum}+ years${terms.length ? ` in ${terms.join(', ')}` : ' of experience'}`, source, priority, quotes.length ? 'matched' : 'uncertain', quotes);
      }
      if (terms.length && /\b(?:degree|bachelor|master|certified|certification|license)\b/i.test(source)) {
        const quotes = evidence.filter(quote => normalizeAliases(quote).includes(normalizeAliases(source)));
        add(source, source, priority, quotes.length ? 'matched' : 'uncertain', quotes);
      }
      if (!terms.length && !duration && source.length > 8 && !/^(?:job title|location|salary|apply|we offer)\s*:/i.test(source)) add(source, source, priority, 'uncertain');
    }
  }
  if (!rows.size) throw new Error('No requirements could be identified. Paste the job requirements and responsibilities.');
  if (rows.size > 150) throw new Error('This posting contains too many requirements. Check one job description at a time.');
  return { requirements: [...rows.values()] };
}

export function analyzeAtsLocally(resume, jobDescription) {
  return buildAnalysis(extractJobRequirements(jobDescription, resume), resume, jobDescription);
}
