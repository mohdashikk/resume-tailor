# doitnext.ai Resume Tailor

doitnext.ai is a personal, browser-first resume workspace. It extracts PDF, scanned PDF, DOCX, TXT, PNG, JPG, and WebP resume text locally, keeps a validated master resume in `localStorage`, compares it with a job description, and uses a server-only Groq key to create a separate tailored version. Export produces a selectable-text, multi-page A4 PDF.

The review stage includes a tailoring edit history with section-level before/after text and labels for recurring JD terms introduced into the tailored wording.

PDF export uses a polished single-column A4 layout with measured wrapping, clickable links and multi-page section preservation.

## Run locally

Requirements: Node.js 20+ and a Groq API key for semantic parsing/tailoring.

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and set `GROQ_API_KEY`. Optionally change `GROQ_MODEL`.
3. Run the app: `npm run dev`
4. Open `http://localhost:5173`.

For local development, Vite provides the same `/api/ai` handler in server middleware and reads `GROQ_API_KEY` only from `.env.local`; the secret is never exposed to browser code. Vercel uses `api/ai.js` as the production serverless endpoint.

## Deploy

Import this repository into Vercel, add `GROQ_API_KEY` (and optionally `GROQ_MODEL`) in Project Settings → Environment Variables, then deploy. The key is read only by the server-only `server/aiService.js`; it is never included in the Vite bundle or saved in browser storage.

## Commands

- `npm run dev` — local Vite app plus secure `/api/ai` middleware
- `npm run dev:frontend` — alias for the same local development server
- `npm run dev:full` — alias for the same local development server
- `npm test` — validation, state separation, and storage-recovery tests
- `npm run build` — production bundle

## Architecture

Role-scoped tailoring and its evidence/validation contract are documented in [experience-tailoring-architecture.md](docs/experience-tailoring-architecture.md). The public `/api/ai` route delegates to the centralized server-only `server/aiService.js`; the browser `src/services/aiService.js` remains an HTTP client. Existing model configuration and the PDF/UI contracts are preserved.

- `src/features` — resume, job-description, and tailoring Redux state
- `src/services` — extraction, AI client, validation, matching, storage, and PDF export
- `src/components` — reusable editor and A4 preview
- `api/ai.js` — stable Vercel Node.js Function route; delegates to `server/aiService.js`

PDF extraction uses PDF.js with its worker imported as a Vite asset. Image-only PDF pages and image resumes use Tesseract OCR in the browser. DOCX extraction uses Mammoth's browser build and `ArrayBuffer` input. AI output is constrained by JSON Schema and checked again with Zod before it reaches Redux. Resume/JD text is explicitly delimited and treated as untrusted data in the server prompt.

## Resume upload and template mapping

An upload supplies content only; the existing editor, preview and PDF template control layout. Each import receives a fresh document ID and replaces the working resume rather than merging with a prior document. The saved master stays separate until the user saves the new master. When uploads overlap, only the latest request may update the editor.

Parsing identifies source sections and maps contact details, summary, skills, jobs, education, projects, certifications and languages into the template. The server validates the AI structure before normalization and recovers clearly structured, entirely omitted sections from source text with a review notice. Fallback parsing supports common inline headings, employer-first/role-first/date-line work layouts, comma-separated role/employer headings, locations after dates, bare portfolio domains, wrapped bullets and slash-containing skills. PDF text is ordered by position; repeated vertical gutters separate common sidebar columns while employment dates remain beside their roles. Unclear roles and unsupported extra sections are flagged for manual placement rather than silently discarded. Source files with unusual layouts or poor OCR still need review.

## Data and limitations

- Original uploaded binaries are not stored. Structured resume data, job descriptions, and saved versions are stored in this browser's `localStorage`.
- OCR quality depends on scan resolution, contrast, orientation, language, and typography. Names, dates, email addresses, and numbers must still be reviewed before saving the master resume.
- Local fallback parsing is conservative and deliberately does not guess experience structure. AI configuration is required for semantic parsing and automatic tailoring.
- ATS analysis uses the versioned requirement rubric below. It is an estimate, not an employer ATS score or hiring probability.
- Preview and PDF use locally bundled Inter Regular and Bold, licensed under the SIL Open Font License in `public/fonts/Inter-LICENSE.txt`. Export embeds these fonts and preserves working URL annotations, text selection, and page breaks. Characters outside Inter's supported scripts require another font.
- No real AI call can be verified without a user-provided server credential. Tests use deterministic fixtures; provider-specific behavior should be smoke-tested after configuration.

## ATS rubric (requirements-v11-concise-keywords)

The UI sends the selected document and JD for AI extraction of required/preferred qualifications. The server validates quotes and computes the weighted score. The local fallback uses a skill dictionary, section headings, and explicit duration patterns. The Check ATS action requests AI extraction and evidence matching through the server. If AI is unavailable or its evidence fails validation, a clearly labeled local fallback report is shown; fallback reports are not cached as AI results. Unfamiliar qualifications and responsibilities remain uncertain for manual review. Strict Zod validation rejects missing fields, empty extraction, generic terms, invalid posting quotes and conflicting duplicates. Common technology omissions are rejected. Unverifiable or unrelated evidence is marked uncertain. Alias normalization and token boundaries distinguish Java from JavaScript and React from React Native.

Application code computes round(100 × matched weight / total weight). Required requirements weigh 3, preferred weigh 1; missing and uncertain earn 0. Keyword coverage is round(100 × matched requirement count / all distinct requirements), including preferred and uncertain requirements in the denominator. Both numbers, summaries, lists and recommendations derive from the same validated rows. The report exposes posting quotes, resume quotes and weighted points.

The browser reuses validated results for the same NFKC/case/whitespace-normalized resume content, JD and analysis version, excluding opaque IDs and extraction warnings. Object key order is stable across schema parsing and refresh. Content/JD/version changes invalidate reuse. Concurrent identical requests share one request. Local storage retains 10 reports; memory retains 20. Clearing storage, eviction, a new browser, or a version change requires extraction again; Local extraction is deterministic for the same inputs. Increase ANALYSIS_VERSION whenever extraction prompts, normalization, validation or scoring rules change. Failed requests never populate the cache.

Drafts retain their source resume, JD and validated analysis separately from the master. Refresh and legacy draft recovery permit editing/export without an ATS request. Legacy or outdated analysis is shown as unavailable instead of a guessed score. Draft review recalculates the current tailored analysis after manual edits and compares it with the saved source analysis when available. Change summaries are calculated from source/current content, including skill order changes.

Tests use fixture extractions and mocked provider responses. Semantic evidence for open-ended qualifications still requires user review; deterministic guards cover common technologies, accessibility and responsive design rather than every possible qualification.

## Security notes

The function enforces request length limits, a 50-second provider timeout, strict structured output, schema validation, and non-invention/prompt-injection instructions. A malformed AI response returns an error and does not replace valid saved data. This personal-use MVP has no authentication or shared database; do not expose it as a multi-user service without adding access controls and abuse protection.

Resume imports use local section parsing first and attempt AI clarification for ambiguous layouts. If clarification fails, local data remains available with review warnings. Automatic rewriting still uses AI.

AI requests fall back from GROQ_MODEL (default openai/gpt-oss-20b) to GROQ_FALLBACK_MODEL (default openai/gpt-oss-120b) on HTTP 429. Set GROQ_FALLBACK_MODEL to an empty string to disable fallback. Model cooldowns are shared within one server process. If both models are limited, the server waits up to 20 seconds and retries once within the request timeout. Restart the development server after changing environment variables.

Role-scoped tailoring batches at most three relevant jobs per compact Groq request and preserves explicit evidence references for every accepted bullet. The existing 15-second provider deadline applies per batch, with a 45-second overall generation budget. Role history and credentials are preserved independently of model output. Invalid roles retain their source wording with validation warnings; unavailable generation is not cached as a completed rewrite. Summary and supported skills can be tailored alongside experience. See the architecture document for schemas, compatibility, verification limits and debugging.


## Keyword-aware review

Requirement extraction uses a fixed vocabulary independent of edited resume skills, so adding evidence does not change the denominator. Equivalent JD spellings are applied within source-backed experience/project bullets even when AI is unavailable. AI edits additionally allow controlled verb forms while preserving factual vocabulary and normalized metrics. Review shows current tailored scores, missing requirements, keyword highlights and Base/Tailored switching. An 80% target shows remaining weighted points rather than forcing a minimum score. Users can add confirmed work evidence to a selected experience entry; edits immediately recalculate the report. Employer ATS scores are not available or guaranteed.

ATS extraction scores each named skill once rather than also scoring its surrounding responsibility sentence and comma fragments. Named skill coverage is independent of proficiency and duration checks; those remain separate review requirements. WebRTC, Canvas, WebGL, telemetry, observability and real-time concepts are recognized explicitly. Unknown standalone qualifications remain available for review.

Uploaded documents are selected immediately for ATS checking, including reviewed working copies and saved tailored versions. The report names the checked source file. New upload/selection and JD changes invalidate pending results. Base/tailored comparisons retain the source requirement rubric instead of extracting another denominator. Explicit checks request fresh AI analysis; local fallback is labeled and retryable.

The resume preview and PDF export use a fixed reference-based Inter template, independent of upload layout: A4, 30 pt side margins, 18 pt name, 10.5 pt title, 9 pt contact/dates, 9.75 pt body and headings, and 15.84375 pt body leading. Role names are bold while employers are regular; dates align right. Export supports emphasized matched keywords and numeric metrics, embeds Inter, and omits extra continuation labels and footers to follow the reference. AI provides structured content rather than template styling.

Direct positive skill evidence can correct an AI missing/uncertain assessment. Common equivalent inflections (accessible/accessibility, user experience/UX, collaborated/collaboration, cross-browser compatibility, component-based architecture) are recognized without inventing related technologies. AI extraction requests atomic requirements rather than duplicate compound sentences. Targeted edits accept controlled noun/verb inflections while preserving facts and metrics.

Tailor & Review uses the reference two-column workspace: collapsible JD and compact base/tailored score with keyword chips on the left, sticky A4 preview and comparison/edit/export controls on the right. Confirmed missing-skill chips immediately update the copy and rubric. Detailed evidence and change diagnostics remain available in expandable sections. The cover-letter action generates plain editable text through the existing AI endpoint and supports text download; it never sends the letter. The one-page check measures actual PDF page count without shrinking the reference typography.

The review screen is intentionally limited to ATS Match Score, Cover Letter and Re-tailor Resume alongside the preview and PDF download. Re-tailoring requests fresh AI analysis and rewriting of the current copy, including confirmed skills. Diagnostic panels, fit-to-page controls, change-review overlays and extra review cards are omitted from this screen.

Developer resume Skills use Frontend, Backend and Other skills subheadings in the preview and PDF. Empty categories are omitted; non-developer profiles retain appropriate categories. The application displays all keywords without category filters or profile labels. First-pass tailoring still promotes supported JD keywords toward the 60% representation target. Tailoring controls use the shared violet-blue brand action gradient.
Keyword selections remain pending until Re-tailor Resume is clicked. The request includes each selected JD skill and an optional user-confirmed experience entry. AI rewrites the summary and eligible existing bullets; only role-assigned confirmations may introduce a skill into that role. Skills without a role assignment are limited to Skills/summary. Metrics and source facts are checked; failed AI requests leave the current resume and pending selections unchanged. Selection alone does not modify the displayed score.

Rewrite Resume updates the current tailored copy directly and reports which sections changed. The resume preview is on the left and ATS matching/rewrite controls are on the right. Natural selected-skill paraphrases that fail vocabulary equality may receive a separate bounded AI evidence review. Unchanged metrics are enforced in code; review failures retain the conservative result. Historical fields and unassigned roles remain protected.

The keyword selection UI has no placement dropdowns. Rewrite resolves selected skills to experience entries only when the same role already contains positive evidence; otherwise it uses Skills and summary. Existing validated JD requirements are rescored without an extra AI analysis request. Standalone responsibility/qualification headings are excluded from requirements and skill selection.

Keyword chips contain concise JD role terms only. Extraction removes heading labels and phrases such as use of/experience with; full responsibility sentences are reduced to named role concepts. Duration and qualification rows remain in the weighted rubric but are excluded from selectable skills. Keyword coverage is computed over distinct keyword concepts rather than all qualifications; the weighted ATS score continues to include real qualification requirements. Rewrite selection is validated against the same cleaned keyword list.
