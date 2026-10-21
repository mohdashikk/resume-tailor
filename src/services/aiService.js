import { analysisKey, readCachedAnalysis, cacheAnalysis, validateAnalysis } from './atsAnalysis';
import { analyzeAtsLocally } from './localAtsService.js';
import { parseResumeHybrid } from './hybridResumeParser.js';
const REQUEST_TIMEOUT = 55000;

async function postAI(action, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), action === 'tailor' ? 90000 : REQUEST_TIMEOUT);
  try {
    const response = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }), signal: controller.signal,
    });
    const rawBody = await response.text();
    let body = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch {
      const error = new Error(response.status === 404
        ? 'The AI endpoint is not running. Start the app with npm run dev.'
        : 'The AI endpoint returned an unexpected response. Start the app with npm run dev and check the server console.');
      error.code = 'AI_ENDPOINT_UNAVAILABLE';
      throw error;
    }
    if (!response.ok) {
      const error = new Error(body.error || (response.status === 404
        ? 'The AI endpoint is not running. Start the app with npm run dev.'
        : `The AI endpoint failed with HTTP ${response.status}. Check the server console.`));
      error.code = body.code || 'AI_ERROR';
      if (Number.isFinite(body.retryAfterSeconds)) error.retryAfterSeconds = Math.max(0, body.retryAfterSeconds);
      throw error;
    }
    if (!body.data) {
      const error = new Error('The AI endpoint returned no resume data. Check the server console and try again.');
      error.code = 'EMPTY_AI_RESPONSE';
      throw error;
    }
    return body.data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The AI request timed out. Please try again.');
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      const unavailable = new Error('Could not connect to the AI endpoint. Start the app with npm run dev.');
      unavailable.code = 'AI_ENDPOINT_UNAVAILABLE';
      throw unavailable;
    }
    throw error;
  } finally { clearTimeout(timeout); }
}

export const parseResumeWithAI = (rawText) => parseResumeHybrid(rawText, (text) => postAI('parse', { rawText: text }));
const inFlight = new Map();
const validatedResults = new Map();
export const analyzeAtsWithAI = async (resume, jobDescription, { force = false, minimumDuration = 0, useAI = false } = {}) => {
  const started = Date.now();
  // Yield before CPU work so the browser can paint the checking state.
  if (minimumDuration > 0) await new Promise(resolve => setTimeout(resolve, 0));
  const key = analysisKey(resume, jobDescription);
  if (useAI) {
    // AI checks never reuse a local report or another document's pending request.
    try {
      const raw = await postAI('ats', { resume, jobDescription });
      const report = validateAnalysis(raw, resume, jobDescription);
      return cacheAnalysis({ ...report, method: 'ai' }, resume, jobDescription);
    } catch (error) {
      return { ...analyzeAtsLocally(resume, jobDescription), method: 'local-fallback', warning: `AI analysis unavailable: ${error.message}` };
    }
  }
  const cached = force ? null : readCachedAnalysis(resume, jobDescription);
  if (cached) return cached;
  if (!force && validatedResults.has(key)) return structuredClone(validatedResults.get(key));
  if (!inFlight.has(key)) {
    const pending = Promise.resolve().then(() => analyzeAtsLocally(resume, jobDescription)).then((report) => {
      const validated = cacheAnalysis(report, resume, jobDescription);
      validatedResults.set(key, validated);
      if (validatedResults.size > 20) validatedResults.delete(validatedResults.keys().next().value);
      return validated;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  try {
    return structuredClone(await inFlight.get(key));
  } finally {
    const remaining = Math.min(2000, minimumDuration) - (Date.now() - started);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  }
};
const tailoredCache = new Map();
const pendingTailoring = new Map();
export const tailorResumeWithAI = async (masterResume, jobDescription, company, jobTitle, analysis, { force = false, confirmedSkills = [], selectedKeywords = [], verifiedCareerProfile, existingTailoredResume } = {}) => {
  const payload = { masterResume, jobDescription, company, jobTitle, analysis, confirmedSkills, selectedKeywords, rewriteEntireResume: true, ...(verifiedCareerProfile ? { verifiedCareerProfile } : {}), ...(existingTailoredResume ? { existingTailoredResume } : {}) };
  if (force || confirmedSkills.length) return postAI('tailor', payload);
  const key = JSON.stringify(['full-resume-rewrite-v4', masterResume, existingTailoredResume, verifiedCareerProfile, jobDescription, company, jobTitle, selectedKeywords]);
  if (tailoredCache.has(key)) return structuredClone(tailoredCache.get(key));
  if (!pendingTailoring.has(key)) {
    const pending = postAI('tailor', payload).then(result => {
      if (result.matchComparison?.status === 'completed' && !result.tailoringReport?.roles.some(role => role.validation_failures.length)) {
        tailoredCache.set(key, result);
        if (tailoredCache.size > 10) tailoredCache.delete(tailoredCache.keys().next().value);
      }
      return result;
    }).finally(() => pendingTailoring.delete(key));
    pendingTailoring.set(key, pending);
  }
  return structuredClone(await pendingTailoring.get(key));
};
