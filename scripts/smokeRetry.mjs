import { loadEnv } from 'vite';
import { handleAIRequest } from '../server/aiService.js';
import { blankResume } from '../src/services/resumeValidation.js';
import { assertSourceHistory } from '../src/services/candidateEvidenceService.js';

// Synthetic-only smoke test: no real resume, contact details, or saved draft.
const original = blankResume();
original.name = 'Synthetic Designer';
original.title = 'UI/UX Designer';
original.summary = 'Designer with experience in Figma and accessible web interfaces.';
original.skillGroups = [{ id: 'skills', name: 'Design', skills: ['Figma', 'design systems', 'user research', 'accessibility'] }];
original.experience = [{ id: 'job', role: 'UI/UX Designer', company: 'Example Studio', startDate: '2022', endDate: '2024', location: '', bullets: [
  { id: 'led', text: 'Led end-to-end UX design for scalable SaaS web applications, from discovery and user research to wireframes and high-fidelity Figma prototypes.' },
  { id: 'testing', text: 'Conducted usability testing and design reviews.' },
  { id: 'flows', text: 'Defined user flows, interaction patterns, and information architecture to improve product usability.' },
  { id: 'layouts', text: 'Designed UI layouts, website branding assets, and visual identity components.' },
] }];
if (process.env.SMOKE_MANY === 'true') {
  const sample = original.experience[0].bullets;
  original.experience = Array.from({ length: 4 }, (_, jobIndex) => ({
    ...structuredClone(original.experience[0]), id: `job-${jobIndex}`,
    company: `Example Studio ${jobIndex + 1}`,
    bullets: Array.from({ length: 6 }, (_, bulletIndex) => ({
      ...sample[bulletIndex % sample.length], id: `job-${jobIndex}-bullet-${bulletIndex}`,
    })),
  }));
}
const existing = structuredClone(original);
existing.id = 'prior-tailored-copy';
existing.summary = 'Designed accessible web interfaces with Figma.';
existing.experience[0].bullets[1].text = 'Performed design reviews and usability testing.';
if (process.env.SMOKE_EDIT === 'true') {
  existing.title = 'Senior UI/UX Designer';
  existing.experience[0].bullets.push({ id: 'user-added', text: 'Coordinated design reviews with product stakeholders.' });
}
const jobDescription = process.env.SMOKE_FRONTEND_JD === 'true'
  ? 'We seek a Front-End Developer to build accessible React interfaces with JavaScript, reusable components, REST APIs, testing, responsive design, and collaboration with designers and product teams.'
  : 'We seek a UI/UX designer for SaaS web applications who can lead user research, design Figma prototypes, build information architecture and user flows, and work on usability, branding and design systems.';
const env = { ...loadEnv('development', process.cwd(), ''), AI_DEBUG: 'true' };
if (process.env.SMOKE_VERBOSE === 'true') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const stage = JSON.parse(args[1].body).response_format?.json_schema?.name;
    const response = await originalFetch(...args);
    const body = await response.clone().json();
    console.log('[synthetic-stage]', JSON.stringify({ stage, status: response.status,
      output: body.choices?.[0]?.message?.content ? JSON.parse(body.choices[0].message.content) : undefined }));
    return response;
  };
}
const request = { action: 'tailor', payload: { masterResume: original, existingTailoredResume: existing, jobDescription, rewriteEntireResume: true } };
const response = process.env.SMOKE_URL
  ? await fetch(process.env.SMOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      .then(async result => ({ status: result.status, body: await result.json() }))
  : await handleAIRequest(request, env);
if (response.status !== 200) throw new Error(response.body.error || `Retry returned ${response.status}`);
const tailored = response.body.data.resume;
if (process.env.SMOKE_EDIT === 'true') {
  if (tailored.title !== existing.title || !tailored.experience[0].bullets.some(bullet => bullet.id === 'user-added')) throw new Error('Existing draft edits were not retained.');
} else assertSourceHistory(original, tailored);
if (tailored.experience[0].bullets[1].text !== existing.experience[0].bullets[1].text) throw new Error('A prior accepted rewrite was lost.');
console.log(JSON.stringify({ status: response.body.data.matchComparison.status, changedBullets: response.body.data.matchComparison.changedBullets,
  unchanged: original.experience[0].bullets.filter((bullet, index) => bullet.text === tailored.experience[0].bullets[index].text).map(bullet => bullet.id),
  priorRewritePreserved: tailored.experience[0].bullets[1].text === existing.experience[0].bullets[1].text,
  ...(process.env.SMOKE_VERBOSE === 'true' ? { comparison: response.body.data.matchComparison } : {}) }, null, 2));
