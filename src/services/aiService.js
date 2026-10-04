const REQUEST_TIMEOUT = 55000;

async function postAI(action, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
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

export const parseResumeWithAI = (rawText) => postAI('parse', { rawText });
export const tailorResumeWithAI = (masterResume, jobDescription, company, jobTitle) =>
  postAI('tailor', { masterResume, jobDescription, company, jobTitle });
