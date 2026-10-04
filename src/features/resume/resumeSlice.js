import { createSlice } from '@reduxjs/toolkit';
import { blankResume } from '../../services/resumeValidation';

const initialState = { masterResume: null, workingResume: blankResume(), extractedText: '', sourceName: '', upload: { status: 'idle', progress: 0, message: '', error: '' } };

const slice = createSlice({
  name: 'resume', initialState,
  reducers: {
    setUploadStatus(state, action) { state.upload = { ...state.upload, ...action.payload }; },
    setExtractedText(state, action) { state.extractedText = action.payload; },
    setSourceName(state, action) { state.sourceName = action.payload; },
    setWorkingResume(state, action) { state.workingResume = action.payload; },
    updateWorkingField(state, action) {
      const { path, value } = action.payload; const parts = path.split('.'); let node = state.workingResume;
      parts.slice(0, -1).forEach((part) => { node = node[part]; }); node[parts.at(-1)] = value;
    },
    updateCollectionItem(state, action) { const { collection, id, changes } = action.payload; const item = state.workingResume[collection].find((entry) => entry.id === id); if (item) Object.assign(item, changes); },
    addCollectionItem(state, action) { state.workingResume[action.payload.collection].push(action.payload.item); },
    deleteCollectionItem(state, action) { state.workingResume[action.payload.collection] = state.workingResume[action.payload.collection].filter((item) => item.id !== action.payload.id); },
    reorderCollection(state, action) { const { collection, index, direction } = action.payload; const target = index + direction; if (target < 0 || target >= state.workingResume[collection].length) return; const [item] = state.workingResume[collection].splice(index, 1); state.workingResume[collection].splice(target, 0, item); },
    confirmMaster(state) { state.masterResume = JSON.parse(JSON.stringify(state.workingResume)); },
    hydrateResume(state, action) { return { ...state, ...action.payload, upload: initialState.upload }; },
    clearResume() { return initialState; },
  },
});
export const resumeActions = slice.actions;
export default slice.reducer;
