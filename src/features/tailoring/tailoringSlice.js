import { createSlice } from '@reduxjs/toolkit';

const initialState = { current: null, versions: [], status: 'idle', error: '' };
const slice = createSlice({
  name: 'tailoring', initialState,
  reducers: {
    setTailoringStatus(state, action) { Object.assign(state, action.payload); },
    setTailoredResult(state, action) { state.current = action.payload; state.status = 'succeeded'; state.error = ''; },
    clearCurrent(state) { state.current = null; state.status = 'idle'; state.error = ''; },
    updateTailoredResume(state, action) { if (state.current) state.current.resume = action.payload; },
    confirmMissingRequirement(state, action) {
      if (!state.current) return;
      const requirement = String(action.payload.requirement || '').trim();
      const skill = String(action.payload.skill || requirement).trim();
      if (!skill) return;
      const groups = state.current.resume.skillGroups;
      const alreadyPresent = groups.some((group) => group.skills.some((item) => item.toLowerCase() === skill.toLowerCase()));
      if (!alreadyPresent) {
        let group = groups.find((item) => item.id === 'confirmed-jd-skills');
        if (!group) {
          group = { id: 'confirmed-jd-skills', name: 'Additional relevant skills', skills: [] };
          groups.push(group);
        }
        group.skills.push(skill);
      }
      state.current.missingRequirements = state.current.missingRequirements.filter((item) => item !== requirement);
      const note = `Added confirmed JD requirement to Skills: ${skill}`;
      if (!state.current.changeSummary.includes(note)) state.current.changeSummary.push(note);
    },
    saveVersion(state, action) { state.versions.unshift(action.payload); },
    loadVersion(state, action) { state.current = structuredClone(action.payload); },
    hydrateTailoring(state, action) { return { ...state, versions: action.payload.versions || [], current: action.payload.current || null, status: 'idle', error: '' }; },
    clearTailoring() { return initialState; },
  },
});
export const tailoringActions = slice.actions;
export default slice.reducer;
