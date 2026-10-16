# doitnext.ai Resume Tailor

doitnext.ai is a personal, browser-first resume workspace. It extracts PDF, scanned PDF, DOCX, TXT, PNG, JPG, and WebP resume text locally, keeps a validated master resume in `localStorage`, compares it with a job description, and uses a server-only Groq key to create a separate tailored version. Export produces a selectable-text, multi-page A4 PDF.

The review stage includes a tailoring edit history with section-level before/after text and labels for recurring JD terms introduced into the tailored wording.

PDF export uses a polished single-column A4 layout with measured wrapping, continuation headings, clickable links, page numbering, and multi-page section preservation.

## Run locally

Requirements: Node.js 20+ and a Groq API key for semantic parsing/tailoring.

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and set `GROQ_API_KEY`. Optionally change `GROQ_MODEL`.
3. Run the app: `npm run dev`
4. Open `http://localhost:5173`.

For local development, Vite provides the same `/api/ai` handler in server middleware and reads `GROQ_API_KEY` only from `.env.local`; the secret is never exposed to browser code. Vercel uses `api/ai.js` as the production serverless endpoint.

## Deploy

Import this repository into Vercel, add `GROQ_API_KEY` (and optionally `GROQ_MODEL`) in Project Settings → Environment Variables, then deploy. The key is read only in `api/ai.js`; it is never included in the Vite bundle or saved in browser storage.

## Commands

- `npm run dev` — local Vite app plus secure `/api/ai` middleware
- `npm run dev:frontend` — alias for the same local development server
- `npm run dev:full` — alias for the same local development server
- `npm test` — validation, state separation, and storage-recovery tests
- `npm run build` — production bundle

## Architecture

- `src/features` — resume, job-description, and tailoring Redux state
- `src/services` — extraction, AI client, validation, matching, storage, and PDF export
- `src/components` — reusable editor and A4 preview
- `api/ai.js` — Vercel Node.js Function and Groq Chat Completions adapter

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

## ATS rubric (requirements-v2)

AI extracts distinct required/preferred qualifications and assesses exact resume evidence; it never supplies the final score. Strict Zod validation rejects missing fields, empty extraction, generic terms, invalid posting quotes and conflicting duplicates. Common technology omissions are rejected. Unverifiable or unrelated evidence is marked uncertain. Alias normalization and token boundaries distinguish Java from JavaScript and React from React Native.

Application code computes round(100 × matched weight / total weight). Required requirements weigh 2, preferred weigh 1; missing and uncertain earn 0. Keyword coverage is round(100 × matched requirement count / all distinct requirements), including preferred and uncertain requirements in the denominator. Both numbers, summaries, lists and recommendations derive from the same validated rows. The report exposes posting quotes, resume quotes and weighted points.

The browser reuses validated results for the same NFKC/case/whitespace-normalized resume content, JD and analysis version, excluding opaque IDs and extraction warnings. Object key order is stable across schema parsing and refresh. Content/JD/version changes invalidate reuse. Concurrent identical requests share one request. Local storage retains 10 reports; memory retains 20. Clearing storage, eviction, a new browser, or a version change requires extraction again; AI extraction may vary on a new uncached request. Increase ANALYSIS_VERSION whenever extraction prompts, normalization, validation or scoring rules change. Failed requests never populate the cache.

Drafts retain their source resume, JD and validated analysis separately from the master. Refresh and legacy draft recovery permit editing/export without an ATS request. Legacy or outdated analysis is shown as unavailable instead of a guessed score. Draft review scores describe the saved source analysis, not a rescoring of subsequent manual edits. Change summaries are calculated from source/current content, including skill order changes.

Tests use fixture extractions and mocked provider responses. Semantic evidence for open-ended qualifications still depends on AI assessment and user review; deterministic guards cover common technologies, accessibility and responsive design rather than every possible qualification.

## Security notes

The function enforces request length limits, a 50-second provider timeout, strict structured output, schema validation, and non-invention/prompt-injection instructions. A malformed AI response returns an error and does not replace valid saved data. This personal-use MVP has no authentication or shared database; do not expose it as a multi-user service without adding access controls and abuse protection.
