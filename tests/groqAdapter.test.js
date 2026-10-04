import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAIRequest } from '../api/ai';

const parsedResume = {
  id: 'resume-1', name: 'Asha Rao', title: 'Product Designer',
  contact: { email: 'asha@example.com', phone: '', location: '' },
  links: [], summary: 'Designs accessible digital products.', skillGroups: [],
  experience: [], projects: [], education: [], certifications: [], ambiguities: [],
};

describe('Groq AI adapter', () => {
  afterEach(() => vi.restoreAllMocks());

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
    expect(body.response_format.json_schema.strict).toBe(true);
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
    expect(result.body.data.resume.skillGroups.map((group) => group.id)).toEqual(['frontend', 'design']);
    expect(result.body.data.resume.skillGroups.flatMap((group) => group.skills)).not.toContain('Python');
    expect(result.body.data.changeSummary.some((item) => /skill/i.test(item))).toBe(true);
  });
});
