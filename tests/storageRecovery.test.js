import { describe, expect, it } from 'vitest';
import { loadSavedState, STORAGE_KEY } from '../src/services/storageService';

describe('storage recovery', () => {
  it('quarantines invalid JSON without crashing', () => {
    const values = new Map([[STORAGE_KEY, '{broken json']]);
    const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
    const result = loadSavedState(storage);
    expect(result.data).toBeNull(); expect(result.recovered).toBe(true);
    expect(values.get(`${STORAGE_KEY}:recovery`)).toBe('{broken json');
    expect(values.has(STORAGE_KEY)).toBe(false);
  });

  it('rejects structurally invalid saved resumes', () => {
    const storage = { getItem: () => JSON.stringify({ masterResume: { id: 4 } }), setItem: () => {}, removeItem: () => {} };
    expect(loadSavedState(storage).recovered).toBe(true);
  });
});
