const STOPWORDS = new Set('a an and are as at be by for from has have in is it of on or that the this to with will you your our we they using use required preferred'.split(' '));
const PHRASES = ['machine learning', 'project management', 'data analysis', 'product strategy', 'user research', 'continuous integration', 'cloud computing', 'artificial intelligence', 'stakeholder management', 'react native', 'node.js', 'power bi'];

const words = (value) => (value.toLowerCase().match(/[a-z][a-z0-9.+#-]{1,}/g) || []).filter((word) => !STOPWORDS.has(word));

export function analyzeMatch(resume, jobDescription) {
  const resumeText = JSON.stringify(resume || {}).toLowerCase();
  const jd = (jobDescription || '').toLowerCase();
  const counts = new Map();
  [...words(jd), ...PHRASES.filter((phrase) => jd.includes(phrase))].forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
  const keywords = [...counts.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([term]) => term);
  const matched = keywords.filter((term) => resumeText.includes(term));
  const missing = keywords.filter((term) => !resumeText.includes(term));
  return { keywords, matched, missing, coverage: keywords.length ? Math.round((matched.length / keywords.length) * 100) : 0 };
}

const hasText = (value) => Boolean(value?.trim());
const filledBullets = (items = []) => items.flatMap((item) => item.bullets || []).filter((bullet) => hasText(bullet.text));

export function analyzeResumeReadiness(resume) {
  if (!resume) return { score: 0, label: 'Not scored', suggestions: [] };

  const skills = (resume.skillGroups || []).flatMap((group) => group.skills || []).filter(hasText);
  const experience = (resume.experience || []).filter((item) => hasText(item.role) || hasText(item.company));
  const bullets = filledBullets(experience);
  const quantifiedBullets = bullets.filter((bullet) => /\b\d+(?:[.,]\d+)?%?|\$\d+|\b(?:increased|reduced|improved|grew|saved)\b/i.test(bullet.text));
  const suggestions = [];
  let score = 0;

  if (hasText(resume.name)) score += 5; else suggestions.push('Add your full name.');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resume.contact?.email || '')) score += 5; else suggestions.push('Add a valid email address.');
  if (hasText(resume.contact?.phone)) score += 4; else suggestions.push('Add a phone number.');
  if (hasText(resume.contact?.location)) score += 3;
  if (hasText(resume.title)) score += 3; else suggestions.push('Add a target professional title.');

  if ((resume.summary || '').trim().length >= 80) score += 12;
  else if (hasText(resume.summary)) { score += 6; suggestions.push('Expand the summary with role, experience, and strengths.'); }
  else suggestions.push('Add a concise professional summary.');

  if (skills.length >= 8) score += 15;
  else if (skills.length >= 4) { score += 9; suggestions.push('Add more role-relevant skills.'); }
  else { score += skills.length * 2; suggestions.push('Add a clear skills section.'); }

  if (experience.length) score += 12; else suggestions.push('Add professional experience.');
  if (bullets.length >= 4) score += 10;
  else if (bullets.length) { score += 5; suggestions.push('Add more achievement-focused experience bullets.'); }
  else suggestions.push('Describe your experience with concise bullet points.');
  if (quantifiedBullets.length >= 2) score += 8;
  else if (quantifiedBullets.length) { score += 4; suggestions.push('Quantify more achievements where truthful.'); }
  else suggestions.push('Add measurable outcomes where truthful.');

  if ((resume.education || []).some((item) => hasText(item.qualification) || hasText(item.institution))) score += 8;
  else suggestions.push('Add education or relevant training.');
  if ((resume.projects || []).length || (resume.certifications || []).length) score += 5;
  if (!(resume.ambiguities || []).length) score += 5; else suggestions.push('Resolve the flagged extraction issues.');
  if (experience.some((item) => hasText(item.startDate) && hasText(item.endDate))) score += 5;

  const normalizedScore = Math.min(100, score);
  const label = normalizedScore >= 85 ? 'Strong' : normalizedScore >= 70 ? 'Good' : normalizedScore >= 50 ? 'Needs improvement' : 'Incomplete';
  return { score: normalizedScore, label, suggestions: suggestions.slice(0, 3) };
}

export function calculateAtsScore(resume, jobDescription) {
  const readiness = analyzeResumeReadiness(resume);
  const match = analyzeMatch(resume, jobDescription);
  const hasJobKeywords = match.keywords.length > 0;
  return {
    score: hasJobKeywords ? Math.round((readiness.score * 0.45) + (match.coverage * 0.55)) : readiness.score,
    readiness,
    match,
    hasJobKeywords,
  };
}
