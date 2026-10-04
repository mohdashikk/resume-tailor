import { createSlice } from '@reduxjs/toolkit';

const initialState = { current: null, versions: [], status: 'idle', error: '' };
const slice = createSlice({
  name: 'tailoring', initialState,
  reducers: {
    setTailoringStatus(state, action) { Object.assign(state, action.payload); },
    setTailoredResult(state, action) { state.current = action.payload; state.status = 'succeeded'; state.error = ''; },
    updateTailoredResume(state, action) { if (state.current) state.current.resume = action.payload; },
    saveVersion(state, action) { state.versions.unshift(action.payload); },
    loadVersion(state, action) { state.current = structuredClone(action.payload); },
    hydrateTailoring(state, action) { return { ...state, versions: action.payload.versions || [], current: action.payload.current || null, status: 'idle', error: '' }; },
    clearTailoring() { return initialState; },
  },
});
export const tailoringActions = slice.actions;
export default slice.reducer;
