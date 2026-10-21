import { blankResume } from '../src/services/resumeValidation.js';
import { loadEnv } from 'vite';
import { handleAIRequest } from '../server/aiService.js';
import { analyzeAtsLocally } from '../src/services/localAtsService.js';

const resume = blankResume();
resume.name = 'Synthetic Candidate';
resume.title = 'UI/UX Designer';
resume.summary = 'Designed accessible web interfaces with Figma and user research.';
resume.skillGroups = [{ id: 'synthetic-skills', name: 'Skills', skills: ['Figma', 'accessibility'] }];
resume.experience = [{ id: 'synthetic-job', role: 'UI/UX Designer', company: 'Example Studio', location: '', startDate: '2022', endDate: 'Present', bullets: [{ id: 'synthetic-bullet', text: 'Designed accessible web interfaces and conducted usability testing.' }] }];
const jobDescription = 'We need a UI/UX designer who designs accessible web interfaces, conducts user research and usability testing, and collaborates with product teams.';
const direct = await handleAIRequest({ action: 'ats', payload: { resume, jobDescription } }, { ...loadEnv('development', process.cwd(), ''), AI_DEBUG: 'true' });
console.log(JSON.stringify({ route: 'direct', status: direct.status, code: direct.body.code, error: direct.body.error, score: direct.body.data?.score }));
const localAnalysis = analyzeAtsLocally(resume, jobDescription);
const tailor = await handleAIRequest({ action: 'tailor', payload: { masterResume: resume, jobDescription, analysis: localAnalysis, rewriteEntireResume: true } }, { ...loadEnv('development', process.cwd(), ''), AI_DEBUG: 'true' });
console.log(JSON.stringify({ route: 'direct-tailor-with-local-analysis', status: tailor.status, code: tailor.body.code, error: tailor.body.error, comparison: tailor.body.data?.matchComparison }));
const response = await fetch('http://localhost:5173/api/ai', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'ats', payload: { resume, jobDescription } }),
});
const body = await response.json();
console.log(JSON.stringify({ route: 'localhost', status: response.status, code: body.code, error: body.error, method: body.data?.method, score: body.data?.score }));
const liveTailorResponse = await fetch('http://localhost:5173/api/ai', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'tailor', payload: { masterResume: resume, jobDescription, analysis: localAnalysis, rewriteEntireResume: true } }),
});
const liveTailor = await liveTailorResponse.json();
console.log(JSON.stringify({ route: 'localhost-tailor', status: liveTailorResponse.status, code: liveTailor.code,
  error: liveTailor.error, comparison: liveTailor.data?.matchComparison,
  summary: liveTailor.data?.resume?.summary, bullet: liveTailor.data?.resume?.experience?.[0]?.bullets?.[0]?.text }));
