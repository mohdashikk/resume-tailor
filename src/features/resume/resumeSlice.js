import { createSlice } from '@reduxjs/toolkit';
import { blankResume } from '../../services/resumeValidation';

const initialState = { masterResume: null, workingResume: blankResume(), workingSaved: false, resumeLibrary: [], extractedText: '', sourceName: '', upload: { status: 'idle', progress: 0, message: '', error: '' } };

const slice = createSlice({
  name: 'resume', initialState,
  reducers: {
    setUploadStatus(state, action) { state.upload = { ...state.upload, ...action.payload }; },
    setExtractedText(state, action) { state.extractedText = action.payload; },
    setSourceName(state, action) { state.sourceName = action.payload; },
    setWorkingResume(state, action) { state.workingResume = action.payload; state.workingSaved = false; },
    upsertResumeLibrary(state, action) {
      const entry = action.payload;
      state.resumeLibrary = state.resumeLibrary.map((item) => ({ ...item, isMaster: entry.isMaster ? false : item.isMaster }));
      const existingIndex = state.resumeLibrary.findIndex((item) => item.resume?.id === entry.resume?.id);
      if (existingIndex >= 0) state.resumeLibrary[existingIndex] = { ...state.resumeLibrary[existingIndex], ...entry };
      else state.resumeLibrary.unshift(entry);
    },
    loadResumeFromLibrary(state, action) {
      const entry = action.payload;
      state.workingResume = JSON.parse(JSON.stringify(entry.resume));
      state.sourceName = entry.sourceName || '';
      state.workingSaved = false;
      state.masterResume = entry.isMaster ? JSON.parse(JSON.stringify(entry.resume)) : null;
      state.resumeLibrary = state.resumeLibrary.map((item) => ({ ...item, isMaster: item.resume?.id === entry.resume?.id }));
    },
    updateWorkingField(state, action) {
      state.workingSaved = false;
      const { path, value } = action.payload; const parts = path.split('.'); let node = state.workingResume;
      parts.slice(0, -1).forEach((part) => { node = node[part]; }); node[parts.at(-1)] = value;
    },
    updateCollectionItem(state, action) { state.workingSaved = false; const { collection, id, changes } = action.payload; const item = state.workingResume[collection].find((entry) => entry.id === id); if (item) Object.assign(item, changes); },
    addCollectionItem(state, action) { state.workingSaved = false; state.workingResume[action.payload.collection].push(action.payload.item); },
    deleteCollectionItem(state, action) { state.workingSaved = false; state.workingResume[action.payload.collection] = state.workingResume[action.payload.collection].filter((item) => item.id !== action.payload.id); },
    reorderCollection(state, action) { state.workingSaved = false; const { collection, index, direction } = action.payload; const target = index + direction; if (target < 0 || target >= state.workingResume[collection].length) return; const [item] = state.workingResume[collection].splice(index, 1); state.workingResume[collection].splice(target, 0, item); },
    confirmMaster(state) { state.masterResume = JSON.parse(JSON.stringify(state.workingResume)); state.workingSaved = true; },
    hydrateResume(state, action) { return { ...state, ...action.payload, upload: initialState.upload }; },
    clearResume() { return initialState; },
  },
});
export const resumeActions = slice.actions;
export default slice.reducer;
