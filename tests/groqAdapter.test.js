import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAIRequest } from '../api/ai';

const parsedResume = {
  id: 'resume-1', name: 'Asha Rao', title: 'Product Designer',
  contact: { email: 'asha@example.com', phone: '', location: '' },
  links: [], summary: 'Designs accessible digital products.', skillGroups: [],
  experience: [], projects: [], education: [], certifications: [], ambiguities: [],
};

describe('Groq AI adapter', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it('generates a validated editable cover letter from the selected resume and job', async () => {
    const letter = 'Dear Hiring Team, I design accessible digital products and would welcome the opportunity to contribute to your team.';
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ text: letter }) } }] }) });
    const jobDescription = 'We seek a product designer to create accessible digital products with our cross-functional engineering team.';
    const result = await handleAIRequest({ action: 'coverLetter', payload: { resume: parsedResume, jobDescription } }, { GROQ_API_KEY: 'cover-letter-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.text).toBe(letter);
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content).toContain('Asha Rao');
  });

  it('falls back immediately, skips cooling models, and restores the primary after cooldown', async () => {
    vi.useFakeTimers();
    const success = { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(parsedResume) } }] }) };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => '13' }, json: async () => ({ error: { message: 'Rate limited' } }) })
      .mockResolvedValue(success);
    const env = { GROQ_API_KEY: 'fallback-test-key' };
    const input = { action: 'parse', payload: { rawText: 'Asha Rao\nProduct Designer\n'.padEnd(80, 'x') } };
    expect((await handleAIRequest(input, env)).status).toBe(200);
    expect((await handleAIRequest(input, env)).status).toBe(200);
    expect(fetchMock.mock.calls.map(([, request]) => JSON.parse(request.body).model)).toEqual([
      'openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'openai/gpt-oss-120b',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format.json_schema.strict).toBe(true);
    await vi.advanceTimersByTimeAsync(13_000);
    expect((await handleAIRequest(input, env)).status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).model).toBe('openai/gpt-oss-20b');
  });

  it('tries the fallback model when the configured model has a provider failure', async () => {
    const success = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(parsedResume) } }] }) };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: { message: 'Model temporarily unavailable' } }) })
      .mockResolvedValueOnce(success);
    const result = await handleAIRequest(
      { action: 'parse', payload: { rawText: 'Asha Rao\nProduct Designer\n'.padEnd(80, 'x') } },
      { GROQ_API_KEY: 'provider-fallback-key', GROQ_MODEL: 'configured-model', GROQ_FALLBACK_MODEL: 'fallback-model' },
    );
    expect(result.status).toBe(200);
    expect(fetchMock.mock.calls.map(([, request]) => JSON.parse(request.body).model)).toEqual(['configured-model', 'fallback-model']);
  });

  it('returns the shortest cooldown when both models are limited and avoids more calls during cooldown', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => '60' }, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => '30' }, json: async () => ({}) });
    const input = { action: 'parse', payload: { rawText: 'Asha Rao\nProduct Designer\n'.padEnd(80, 'x') } };
    const env = { GROQ_API_KEY: 'both-limited-test-key' };
    const result = await handleAIRequest(input, env);
    expect(result.status).toBe(429);
    expect(result.body.code).toBe('AI_RATE_LIMITED');
    expect(result.body.error).toContain('30 seconds');
    expect((await handleAIRequest(input, env)).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports the Groq environment variable when configuration is missing', async () => {
    const result = await handleAIRequest({ action: 'parse', payload: { rawText: 'x'.repeat(80) } }, {});
    expect(result.status).toBe(503);
    expect(result.body.error).toContain('GROQ_API_KEY');
  });

  it('uses Groq Chat Completions with strict structured output', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(parsedResume) } }] }),
    });
    const result = await handleAIRequest(
      { action: 'parse', payload: { rawText: 'Asha Rao\nProduct Designer\n'.padEnd(80, 'x') } },
      { GROQ_API_KEY: 'test-key', GROQ_MODEL: 'openai/gpt-oss-20b' },
    );
    expect(result.status).toBe(200);
    expect(result.body.data.name).toBe('Asha Rao');
    const [url, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(body.model).toBe('openai/gpt-oss-20b');
    expect(body.reasoning_effort).toBe('low');
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it('returns all source experience bullets when the AI omits one', async () => {
    const rawText = `Asha Rao
Product Designer
Experience
Product Designer | Orbit Labs | Jul 2023 - Present
• Designed accessible customer dashboards in Figma.
• Conducted usability tests and applied customer feedback.
• Collaborated with developers on reusable interface components.`;
    const incomplete = { ...parsedResume, experience: [{
      id: 'role-1', masterId: 'role-1', role: 'Product Designer', company: 'Orbit Labs',
      location: '', startDate: 'Jul 2023', endDate: 'Present',
      bullets: [{ id: 'bullet-1', text: 'Designed accessible customer dashboards in Figma.' }],
    }] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(incomplete) } }] }) });
    const result = await handleAIRequest({ action: 'parse', payload: { rawText } }, { GROQ_API_KEY: 'source-bullet-recovery-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.experience[0].bullets.map((bullet) => bullet.text)).toEqual([
      'Designed accessible customer dashboards in Figma.',
      'Conducted usability tests and applied customer feedback.',
      'Collaborated with developers on reusable interface components.',
    ]);
  });

  it('waits for Groq rate limits and retries once', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (name) => name === 'retry-after' ? '0' : null },
        json: async () => ({ error: { message: 'Rate limit reached. Please try again in 0s.' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(parsedResume) } }] }),
      });

    const result = await handleAIRequest(
      { action: 'parse', payload: { rawText: 'Asha Rao\nProduct Designer\n'.padEnd(80, 'x') } },
      { GROQ_API_KEY: 'retry-test-key', GROQ_FALLBACK_MODEL: '' },
    );

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('automatically repairs a Groq schema-generation failure', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: {
          code: 'json_validate_failed',
          message: "Generated JSON does not match the expected schema: expected object, but got string",
          failed_generation: JSON.stringify({ ...parsedResume, experience: ['Product Designer at Orbit'] }),
        } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(parsedResume) } }] }),
      });

    const result = await handleAIRequest(
      { action: 'parse', payload: { rawText: 'Asha Rao\nProduct Designer\n'.padEnd(80, 'x') } },
      { GROQ_API_KEY: 'test-key' },
    );

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retryBody.temperature).toBe(0);
    expect(retryBody.messages.at(-1).content).toContain('include every required property');
  });

  it('uses only master skills and orders them for the JD', async () => {
    const masterResume = {
      ...parsedResume,
      skillGroups: [
        { id: 'design', name: 'Design', skills: ['User research', 'Figma'] },
        { id: 'frontend', name: 'Front-End', skills: ['HTML5', 'React.js', 'CSS3'] },
      ],
    };
    const aiResume = {
      ...masterResume,
      id: 'tailored-1',
      skillGroups: [{ id: 'invented', name: 'Programming', skills: ['Python'] }],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ resume: aiResume, changeSummary: [], missingRequirements: ['Python'] }) } }],
      }),
    });

    const result = await handleAIRequest({
      action: 'tailor',
      payload: {
        masterResume,
        jobDescription: 'We need a product designer with strong React, CSS, and Figma experience for responsive digital products.'.padEnd(100, ' '),
        company: 'Example',
        jobTitle: 'Product Designer',
      },
    }, { GROQ_API_KEY: 'test-key' });

    expect(result.status).toBe(200);
    expect(result.body.data.resume.skillGroups.map((group) => group.name)).toEqual(['Design & UX', 'Frontend', 'Styling & UI']);
    expect(result.body.data.resume.skillGroups.flatMap((group) => group.skills)).not.toContain('Python');
    expect(result.body.data.changeSummary.some((item) => /skill/i.test(item))).toBe(true);
  });

  it.each([{ requirements: [] }, { requirements: [{ term: 'React' }] }, null])('rejects invalid ATS output without returning a score: %j', async (output) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }) });
    const result = await handleAIRequest({ action: 'ats', payload: { resume: parsedResume, jobDescription: 'Seeking a React frontend developer to build accessible interfaces and write unit tests with Jest.' } }, { GROQ_API_KEY: 'test-key' });
    expect(result.status).toBe(422);
    expect(result.body.data).toBeUndefined();
    expect(result.body.error).toContain('retry');
  });

  it('repairs a schema-valid ATS extraction that omitted a named JD technology', async () => {
    const jobDescription = 'Seeking a product designer with React and TypeScript experience to create accessible digital interfaces with the product team.';
    const row = term => ({ term, priority: 'required', source: jobDescription, status: 'missing', evidence: [] });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ requirements: [row('React')] }) } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ requirements: [row('React'), row('TypeScript')] }) } }] }) });
    const result = await handleAIRequest({ action: 'ats', payload: { resume: parsedResume, jobDescription } }, { GROQ_API_KEY: 'ats-semantic-repair-test' });
    expect(result.status).toBe(200);
    expect(result.body.data.requirements.map(item => item.term)).toEqual(['react', 'typescript']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps summary and skips the provider when there are no relevant source bullets', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const result = await handleAIRequest({ action: 'tailor', payload: { masterResume: parsedResume, jobDescription: 'Seeking an experienced designer with Jest testing experience for our accessible digital product team.' } }, { GROQ_API_KEY: 'test-key' });
    expect(result.status).toBe(200);
    expect(result.body.data.resume.summary).toBe(parsedResume.summary);
    expect(result.body.data.matchComparison.status).toBe('local');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
