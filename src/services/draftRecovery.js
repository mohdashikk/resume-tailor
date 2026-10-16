import { validateAnalysis } from './atsAnalysis';
import { resumeSchema, tailoredResultSchema } from './resumeValidation';

export function recoverDraft(draft) {
  const result = tailoredResultSchema.safeParse(draft);
  if (!result.success) return null;
  const source = resumeSchema.safeParse(draft.sourceResume);
  const recovered = { ...draft, ...result.data, sourceResume: source.success ? source.data : null, analysis: null };
  if (source.success && typeof draft.jobDescription === 'string') {
    try { recovered.analysis = validateAnalysis(draft.analysis, source.data, draft.jobDescription); } catch { /* Older drafts remain editable without a score. */ }
  }
  return recovered;
}
