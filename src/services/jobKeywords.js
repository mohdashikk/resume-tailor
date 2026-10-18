// Role terms only. Full posting quotes and qualifications stay in the rubric.
const terms = ['React Native','React.js','React','JavaScript','TypeScript','HTML','CSS','Redux Toolkit','Redux Saga','Redux','REST APIs','GraphQL','Node.js','Express','Next.js','Vue','Angular','Svelte','Python','Java','SQL','PostgreSQL','MySQL','MongoDB','Redis','Docker','Kubernetes','AWS','Azure','GCP','Git','GitHub','CI/CD','ESLint','SonarQube','Storybook','Playwright','Cypress','React Testing Library','Jest','Vitest','Vite','NGINX','WebSocket','WebRTC','Canvas','WebGL','Accessibility','WCAG','responsive design','cross-browser compatibility','version control','asynchronous flows','code reviews','real-time','cloud-hosted applications','healthcare','regulated-product','AI-assisted engineering tools','automated testing','unit testing','component testing','integration testing','testing','debugging','authentication','authorization','API integration','telemetry','observability','communication','collaboration','Agile','Scrum','Figma','Adobe XD','prototyping','wireframing','user research','user flows','usability testing','interaction design','information architecture','design systems','component architecture','performance optimization','clean code','maintainable code','UX'];
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function namedKeywordTerms(value) {
  const text = normalize(value);
  return terms.filter(term => new RegExp(`(^|[^a-z0-9+#])${escape(term.toLowerCase())}(?=$|[^a-z0-9+#])`, 'i').test(text));
}
export function formatSkillName(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const names = { reactjs: 'React.js', nodejs: 'Node.js', nextjs: 'Next.js', html5: 'HTML5', css3: 'CSS3', 'tailwind css': 'Tailwind CSS', sass: 'Sass', less: 'Less', 'react hooks': 'React Hooks', 'react hook form': 'React Hook Form' };
  return names[text.toLowerCase()] || terms.find(term => term.toLowerCase() === text.toLowerCase()) || text;
}

export const isVagueSkill = value => /^(?:regulated[- ]product|job requirements|role summary|essential responsibilities|must.have skills\s*&?\s*experience)$/i.test(String(value).trim());
const variants = [
  ['AI-assisted engineering tools', /\bai[- ]assist(?:ed)?(?: engineering tools?)?\b/i],
  ['unit testing', /\bunit(?:\s+and\s+component)?\s+tests?\b/i],
  ['component testing', /\bcomponent tests?\b/i],
  ['automated testing', /\bautomated tests?\b/i],
  ['REST APIs', /\brest(?:ful)? apis?\b/i],
  ['Accessibility', /\baccessible|\ba11y\b/i],
  ['responsive design', /\bresponsive(?: web)? (?:interfaces|applications|design|screens|pages)\b/i],
];
export function cleanKeywordTerms(value) {
  let text = normalize(value).replace(/^[-•*·\s]+/, '').replace(/[.;:,]+$/, '');
  if (/^(?:(?:job|role|professional)\s+(?:summary|requirements|overview|description)|must.have skills\s*&?\s*experience|(?:essential|key|main|core|primary)?\s*responsibilities|qualifications|requirements|skills|summary|about us)$/i.test(text)) return [];
  text = text.replace(/^(?:use of|experience (?:with|in|using)|knowledge of|familiarity with|understanding of|ability to use|working knowledge of)\s+/i, '');
  if (/^ai[- ]assist(?:ed)?(?: engineering tools?)?$/i.test(text)) return ['ai-assisted engineering tools'];
  if (/^accessible (?:interfaces|applications|design|screens|pages)$/i.test(text)) return ['accessibility'];
  if (/^responsive(?: web)? (?:interfaces|applications|screens|pages)$/i.test(text)) return ['responsive design'];
  // One concise term, keeping unfamiliar product/tool names instead of forcing
  // them into the dictionary. Tenure and qualifications are never skill chips.
  const qualification = /\b(?:years?|degree|bachelor|master|license|certif\w*|proficien\w*|expert|advanced|strong|experience|responsibilities)\b/i.test(text);
  const sentence = /^(?:ability to|write|build|develop|implement|support|maintain|design|resolve|ensure|work|must|should|we |you )\b/i.test(text) || /[;:]|\band\b|\bor\b/i.test(text) || text.split(' ').length > 5;
  if (!qualification && !sentence && text) return [text];
  const found = terms.filter(term => {
    let source = text;
    if (term.toLowerCase() === 'react') source = source.replace(/\breact native\b/g, '');
    return new RegExp(`(^|[^a-z0-9+#])${escape(term.toLowerCase())}(?=$|[^a-z0-9+#])`, 'i').test(source);
  });
  for (const [term, pattern] of variants) if (pattern.test(text)) found.push(term);
  return [...new Set(found.map(normalize))];
}
