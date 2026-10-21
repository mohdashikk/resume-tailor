import { loadEnv } from 'vite';
import { handleAIRequest } from '../server/aiService.js';
import { blankResume } from '../src/services/resumeValidation.js';
import { assertSourceHistory } from '../src/services/candidateEvidenceService.js';

const role = (id, bullets) => ({ id, role: 'UI/UX Designer', company: `Company ${id}`, location: '', startDate: '2020', endDate: '2022', bullets: bullets.map((text, index) => ({ id: `${id}-${index}`, text })) });
const resume = blankResume();
resume.name = 'Sample Candidate';
resume.title = 'UI/UX Designer';
resume.summary = 'Designer with experience in Figma, design systems, and accessible web interfaces.';
resume.skillGroups = [{ id: 'skills', name: 'Skills', skills: ['Figma', 'React', 'HTML', 'CSS', 'design systems', 'accessibility'] }];
resume.experience = [
  role('first', ['Led UX design for SaaS applications, from user research to high-fidelity Figma prototypes.', 'Translated business requirements into web and mobile interface designs.', 'Built and maintained a design system with reusable components.', 'Conducted usability testing and design reviews.', 'Defined user flows and information architecture.', 'Collaborated with developers and product managers.', 'Designed role-based UI and authentication flows.']),
  role('second', ['Designed responsive web application interfaces.', 'Created wireframes and interactive Figma prototypes.', 'Documented a component-based design system.', 'Improved UI consistency through design audits.', 'Worked with developers to implement designs.', 'Delivered accessible designs across devices and browsers.']),
  role('third', ['Owned the design lifecycle for client projects.', 'Created UI layouts and prototypes in Figma and Adobe XD.', 'Designed responsive accessible web interfaces.', 'Maintained style guides and UI kits.', 'Applied user-centered design principles.']),
  role('fourth', ['Designed website UI layouts and branding assets.', 'Worked with developers on responsive design and usability.']),
];
resume.projects = [{ id: 'sample-project', name: 'Component Library', subtitle: '', link: '', startDate: '', endDate: '',
  bullets: [{ id: 'sample-project-0', text: 'Built reusable interface components in React.' }] }];
resume.education = [{ id: 'sample-degree', institution: 'Example College', qualification: 'Bachelor of Design', location: '', startDate: '2016', endDate: '2020',
  details: 'Completed a capstone project on accessible web interfaces.' }];
const jobDescription = 'We need a React frontend engineer to develop reusable components, responsive and accessible web interfaces, and authentication workflows. Work with designers and developers in Agile teams. Required skills include React, JavaScript, TypeScript, HTML, CSS, testing, REST APIs, state management, and debugging. Preferred skills include Figma, design systems, Docker, Playwright and Storybook.';
const environment = loadEnv('development', process.cwd(), '');
environment.AI_DEBUG = 'true';
environment.GROQ_MODEL = 'openai/gpt-oss-120b';
environment.GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b';
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
const request = { action: 'tailor', payload: { masterResume: resume, jobDescription, rewriteEntireResume: true } };
const result = process.env.SMOKE_URL
  ? await (async () => {
    const response = await fetch(process.env.SMOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    return { status: response.status, body: await response.json() };
  })()
  : await handleAIRequest(request, environment);
const tailored = result.body.data?.resume;
if (!tailored) throw new Error(result.body.error || 'The AI returned no tailored resume.');
assertSourceHistory(resume, tailored);
if (tailored.experience.some((entry, index) => entry.bullets.length !== resume.experience[index].bullets.length)) throw new Error('An experience bullet was lost.');
const originalRoleText = resume.experience.map(entry => entry.bullets.map(bullet => bullet.text).join(' ')).join(' ');
for (const unsupported of ['TypeScript', 'REST APIs', 'Playwright', 'Docker', 'Storybook']) {
  if (!originalRoleText.includes(unsupported) && tailored.experience.some(entry => entry.bullets.some(bullet => bullet.text.includes(unsupported)))) throw new Error(`Unsupported employer claim: ${unsupported}`);
}
console.log(JSON.stringify({ status: result.status, comparison: result.body.data?.matchComparison,
  roles: result.body.data?.tailoringReport?.roles.map(({ role_id, status, validation_failures }) => ({ role_id, status, validation_failures })),
  summaryChanged: Boolean(tailored && tailored.summary !== resume.summary),
  projectChanged: Boolean(tailored && tailored.projects[0].bullets[0].text !== resume.projects[0].bullets[0].text),
  educationChanged: Boolean(tailored && tailored.education[0].details !== resume.education[0].details),
  unchangedExperienceBullets: resume.experience.flatMap((entry, roleIndex) => entry.bullets.flatMap((bullet, bulletIndex) =>
    bullet.text === tailored.experience[roleIndex].bullets[bulletIndex].text ? [`${roleIndex + 1}.${bulletIndex + 1}: ${bullet.text}`] : [])),
  error: result.body.error }, null, 2));
