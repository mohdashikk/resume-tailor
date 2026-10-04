const STOPWORDS = new Set('a an and are as at be by for from has have in is it of on or that the this to with will you your our we they using use required preferred'.split(' '));
const PHRASES = ['machine learning', 'project management', 'data analysis', 'product strategy', 'user research', 'continuous integration', 'cloud computing', 'artificial intelligence', 'stakeholder management', 'react native', 'node.js', 'power bi'];

const words = (value) => (value.toLowerCase().match(/[a-z][a-z0-9.+#-]{1,}/g) || []).filter((word) => !STOPWORDS.has(word));

export function analyzeMatch(resume, jobDescription) {
  const resumeText = JSON.stringify(resume).toLowerCase();
  const jd = jobDescription.toLowerCase();
  const counts = new Map();
  [...words(jd), ...PHRASES.filter((phrase) => jd.includes(phrase))].forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
  const keywords = [...counts.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([term]) => term);
  const matched = keywords.filter((term) => resumeText.includes(term));
  const missing = keywords.filter((term) => !resumeText.includes(term));
  return { keywords, matched, missing, coverage: keywords.length ? Math.round((matched.length / keywords.length) * 100) : 0 };
}
