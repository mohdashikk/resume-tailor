# Experience tailoring implementation

## Architecture inspected

This repository uses JavaScript throughout. React 19 and Redux own the frontend. Vite serves development requests through `/api/ai`; Vercel deploys the same route as a Node function. There is no Python backend, authentication layer, or database to migrate. User-confirmed masters, current drafts and saved versions live in browser storage.

| Responsibility | Existing implementation |
| --- | --- |
| Frontend flow, upload/check/generate/rewrite/export | `src/App.jsx`, Redux slices, `TailorOverview.jsx` |
| Browser HTTP client, request coalescing and cache | `src/services/aiService.js` |
| Server orchestration, prompts, Groq models, cooldowns, structured parsing | `server/aiService.js` |
| Stable public API and Vite integration | `api/ai.js`, `vite.config.js` |
| PDF/DOCX/image extraction and OCR | `fileExtraction.js`, PDF.js, Mammoth, Tesseract |
| Local parsing, AI clarification and source reconciliation | `hybridResumeParser.js`, `localResumeParser.js`, `resumeParsingService.js` |
| JD rubric, alias matching, evidence quotes and score | `atsAnalysis.js`, `localAtsService.js` |
| Role-scoped evidence profile and deterministic role validation | `candidateEvidenceService.js` |
| Legacy bullet compatibility, metric/vocabulary checks, summary/skills helpers | `targetedTailoringService.js` |
| Preview/export template, fonts and clickable links | `ResumePreview.jsx`, `pdfService.js`, `resumeFonts.js` |

No new provider, SDK, embedding store, agent framework, database, or runtime was added. Groq configuration remains `GROQ_API_KEY`, `GROQ_MODEL` and `GROQ_FALLBACK_MODEL`. The key is read server-side. Browser `aiService.js` is an HTTP client, not a second Groq service. `matchingService.js` is a legacy offline readiness helper; `tailoredResumeService.js` is a compatibility reconciler. Neither calls a model.

## Root causes

1. The previous generator edited a global selection of at most sixteen individual bullets. Large or diverse histories could lose entire jobs from the model's context.
2. Compatibility between a task and a tool was treated as evidence that the tool had been used at that employer. A general skill confirmation does not establish that association.
3. Per-bullet word preservation blocked genuine paraphrases and combining complementary evidence within the same job.
4. There was no role-level source map or accepted/rejected-claim report. Some generation failures could leave partial candidate changes, and initial fallback results were easy to mistake for successful AI rewriting.
5. Provider orchestration and route handling lived together in `api/ai.js`.
6. Non-rate-limit provider/model failures stopped on the first configured model instead of trying the existing fallback. The request then returned local keyword normalization, which looked like successful tailoring even though no substantive AI rewrite had run.

## Updated flow

The app's `Rewrite Resume` action now requests `rewriteEntireResume: true`. This uses a focused full-resume path: one AI call for the professional summary and education details, then bounded batches covering every experience and project bullet. A second constrained pass handles bullets the model repeated, followed by one evidence review for remaining natural paraphrases. Each generated bullet stays linked to its own source ID; unsafe changes are retained from the original. A narrowly checked action-verb polish can refresh a repeated bullet without adding a claim. Identity, employer/project names, dates, qualifications, certifications, links and skill names remain factual fields rather than AI prose. The older role-rewrite contract below remains available to direct API callers that do not request the full mode.

1. Validate the existing JD analysis against the exact source resume and posting, or extract the same deterministic rubric locally when the caller has no analysis. Required/preferred weights and ATS contracts remain unchanged.
2. Build a candidate evidence profile. Each experience/project entry retains identity, dates, original bullets and stable source IDs. Classify each JD requirement as direct, transferable, or unverified.
3. An optional saved master contributes missing evidence only when candidate name/email and employer/title/dates match. IDs alone cannot move a fact between employers. A general skill confirmation goes to Skills; an explicit role confirmation is recorded as a distinct evidence source.
4. Send every non-empty experience and project entry in batches of at most three using the existing configured Groq models and strict JSON. Each role output contains `role_id`, `tailored_bullets`, and source `evidence_references`. Relevant roles foreground supported JD-aligned work; other roles receive clarity improvements without forced keywords. The first batch also receives the candidate's existing skills and handles the targeted summary and education wording. Old flat `edits` responses remain accepted for compatibility.
5. Validate citations, coverage of every original role bullet, retention of each cited responsibility and detail, named technologies, ownership claims, qualitative outcomes, numerical claims, coverage of verified required skills, concise wording, repetition and role relevance. Exact source-backed edits pass deterministically. Natural professional paraphrases that use different wording go through a separate evidence-entailment request; only approved bullets are applied. A polished subset of an original bullet is not accepted as a faithful rewrite. Invalid role drafts receive one source-tight repair pass instead of being discarded wholesale. Cross-job references, unsupported tools, metrics, scope, outcomes, and leadership claims remain blocked. Missing mandatory role outputs reject the generation atomically.
6. Build the candidate from the original resume, replacing accepted role bullets only. Independently check identity, historical fields, education credentials, links and certifications. Retain rejected roles and flag them rather than silently inventing content.
7. Prioritize supported skills, recalculate using the same JD rubric, and return the normal resume plus optional `tailoringReport`. Existing frontend parsing, draft recovery, local persistence and PDF export accept that additive report.
8. Mount the existing full `ResumeEditor` against the tailored draft on the review screen. Summary, skills, every experience and project bullet, education, certifications, and other sections now edit the same structured object used by the live preview and PDF export; the source resume remains separate and unchanged.

The provider adapter now advances to the configured fallback model for model-specific 4xx/5xx failures. Generic job-seeking summaries also receive a focused rewrite, with an evidence-only title-and-matching-skills fallback when the provider repeats the original filler.

The report supplies each role's original/tailored bullets, matched requirements, source evidence, per-generated-bullet citation links (`tailored_bullet_evidence`), changes, status, verification needs and validation failures. It is stored with the draft and included in normal backups. No extra dashboard, filters or workflow steps were added. Existing notices now explain unavailable or rejected experience rewriting.

## Performance and errors

- Full-resume mode uses short narrative and per-bullet provider calls within the existing browser/function deadlines; the legacy role batches retain their 45-second generation budget.
- No repeated JD model analysis is needed when the validated source rubric is supplied. Role evidence mapping and factual validation are deterministic.
- Inputs over the bounded context budget receive a retryable, source-preserving error. Missing roles, malformed JSON, truncation, provider errors and rate limits preserve original experience; the response is explicitly marked unavailable or returns an error when selected claims cannot be applied atomically.
- Only fully completed results without role validation failures enter the browser tailoring cache.
- Set `AI_DEBUG=true` for stage names, durations, requirement/role/bullet counts, rate-limit status and validation failure counts. Resume text, employer names, credentials, provider bodies and API keys are never logged. Raw provider errors are not echoed to the browser.

## Validation and limits

Regression tests cover React tailoring, verified TypeScript evidence, missing testing tools, several employers, unrelated postings, malformed/incomplete responses, Groq rate limiting, history/credential invariants, metric preservation, more than sixteen bullets, count-only logging, master-role matching, UI forwarding and PDF generation after tailoring. Existing parser, storage, preview, export and ATS tests remain in use. The project has no configured lint/typecheck script; the production Vite build checks module integration.

Source-supported vocabulary is deliberately conservative and can reject a valid paraphrase. It does not prove real-world truth or every semantic relationship between a metric and an outcome. Unverified or undisclosed experience remains a verification need, not proof that the candidate lacks the skill. Saved masters are user-confirmed records, not external employment verification. An ATS estimate is separate from writing quality and employer scoring. No score floor or fabricated achievement is introduced.

The regression suite also verifies that tailored experience and project bullets appear in editable fields, manual review edits update the live preview/export state, and the base resume remains unchanged. A live synthetic weak-resume/JD run rewrote the summary and all four bullets across two employers and one project, preserved employer/title/date facts, and kept unsupported TypeScript out of the result.
