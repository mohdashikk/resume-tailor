import { createSlice } from '@reduxjs/toolkit';

const initialState = { company: '', jobTitle: '', text: '' };
const slice = createSlice({ name: 'job', initialState, reducers: { updateJob(state, action) { Object.assign(state, action.payload); }, hydrateJob(state, action) { return { ...state, ...action.payload }; }, clearJob() { return initialState; } } });
export const jobActions = slice.actions;
export default slice.reducer;
