import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildAnalysis } from '../src/services/atsAnalysis';

let analyze;
const resume = { summary: 'React developer' };
const jd = 'React developer needed';
const report = () => buildAnalysis({ requirements: [{ term: 'React', source: 'React', priority: 'required', status: 'matched', evidence: ['React developer'] }] }, resume, jd);
beforeEach(async () => {
  localStorage.clear(); vi.resetModules();
  analyze = (await import('../src/services/aiService')).analyzeAtsWithAI;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('coalesces concurrent requests, validates scores and reuses normalized inputs', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: { ...report(), score: 2 } }) });
  const [a, b] = await Promise.all([analyze(resume, jd), analyze(resume, jd)]);
  expect(a).toEqual(b); expect(a.score).toBe(100);
  expect(await analyze({ summary: ' REACT developer ' }, jd)).toEqual(a);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each(['invalid-json', 'empty', 'invalid-schema', 'http', 'network'])('rejects %s without caching success, allowing retry', async (kind) => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  if (kind === 'network') fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  else fetch.mockResolvedValueOnce({ ok: kind !== 'http', status: 502, text: async () => kind === 'invalid-json' ? '{' : JSON.stringify(kind === 'empty' ? {} : kind === 'http' ? { error: 'Please retry' } : { data: { ...report(), requirements: [] } }) });
  await expect(analyze(resume, jd)).rejects.toThrow();
  fetch.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ data: report() }) });
  expect((await analyze(resume, jd)).score).toBe(100);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('reports request timeout as retryable without a score', async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, 'fetch').mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
  const pending = expect(analyze(resume, jd)).rejects.toThrow(/timed out.*try again/i);
  await vi.advanceTimersByTimeAsync(55001);
  await pending;
});
