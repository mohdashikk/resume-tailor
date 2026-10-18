import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { analysisKey } from '../src/services/atsAnalysis';

let analyze, tailor;
const resume = { summary: 'React developer' };
const jd = 'Requirements:\nReact is required.\nWe are hiring for our product engineering team across several locations.';
beforeEach(async () => {
  localStorage.clear(); vi.resetModules();
  const service = await import('../src/services/aiService');
  analyze = service.analyzeAtsWithAI;
  tailor = service.tailorResumeWithAI;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('coalesces local analysis, returns independent results, and reuses normalized inputs without network calls', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
  const [a, b] = await Promise.all([analyze(resume, jd), analyze(resume, jd)]);
  expect(a).toEqual(b);
  expect(a.match.matched).toContain('react');
  b.requirements.length = 0;
  expect((await analyze({ summary: ' REACT developer ' }, jd)).requirements).toEqual(a.requirements);
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects short postings without caching an invalid report', async () => {
  await expect(analyze(resume, 'React')).rejects.toThrow(/fuller job description/);
  expect((await analyze(resume, jd)).match.matched).toContain('react');
});
it('revalidates cached scores instead of trusting stored numbers', async () => {
  const report = await analyze(resume, jd);
  localStorage.setItem('doitnext:ats:v1', JSON.stringify({ [analysisKey(resume, jd)]: { ...report, score: -999 } }));
  expect((await analyze(resume, jd)).score).toBe(report.score);
});
it('uses AI on the selected document even when a local result is cached', async () => {
  const report = await analyze(resume, jd);
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: report }) });
  const result = await analyze(resume, jd, { useAI: true, force: true });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action: 'ats', payload: { resume, jobDescription: jd } });
  expect(result.method).toBe('ai');
});
it('labels AI failure as local fallback and does not pass it off as AI', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, text: async () => JSON.stringify({ error: 'AI not configured' }) });
  const result = await analyze(resume, jd, { useAI: true });
  expect(result.method).toBe('local-fallback');
  expect(result.warning).toContain('AI not configured');
});
it('does not reuse the previous score when checking changed resume content', async () => {
  const before = await analyze(resume, jd);
  const after = await analyze({ summary: 'Python backend developer' }, jd, { force: true });
  expect(after.key).not.toBe(before.key);
  expect(after.score).toBeLessThan(before.score);
});
it('reuses completed targeted edits and keeps returned copies independent', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => JSON.stringify({
    data: { resume, matchComparison: { before: 50, after: 50, changedBullets: 1, rejectedBullets: 0, status: 'completed' } },
  }) });
  const first = await tailor(resume, jd);
  first.resume.summary = 'Changed by the user';
  expect((await tailor(resume, jd)).resume.summary).toBe(resume.summary);
  expect(fetch).toHaveBeenCalledOnce();
});

// Rewriting still uses the provider; retain transport failure and timeout coverage.
it.each(['invalid-json', 'empty', 'http', 'network'])('rejects tailoring transport failure %s and permits retry', async kind => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  if (kind === 'network') fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  else fetch.mockResolvedValueOnce({ ok: kind !== 'http', status: 502, text: async () => kind === 'invalid-json' ? '{' : JSON.stringify(kind === 'http' ? { error: 'Please retry' } : {}) });
  await expect(tailor(resume, jd)).rejects.toThrow();
  fetch.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ data: { resume } }) });
  expect((await tailor(resume, jd)).resume).toEqual(resume);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('reports a tailoring timeout without a result', async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, 'fetch').mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
  const pending = expect(tailor(resume, jd)).rejects.toThrow(/timed out.*try again/i);
  await vi.advanceTimersByTimeAsync(55001);
  await pending;
});
