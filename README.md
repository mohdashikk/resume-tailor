# Reum Tailor MVP

Reum is a personal, browser-first resume workspace. It extracts PDF/DOCX text locally, keeps a validated master resume in `localStorage`, compares it with a job description, and uses a server-only OpenAI key to create a separate tailored version. Export produces a selectable-text, multi-page A4 PDF.

## Run locally

Requirements: Node.js 20+ and an OpenAI API key for semantic parsing/tailoring.

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY`. Optionally change `OPENAI_MODEL`.
3. Run the app: `npm run dev`
4. Open `http://localhost:5173`.

For local development, Vite provides the same `/api/ai` handler in server middleware and reads `OPENAI_API_KEY` only from `.env.local`; the secret is never exposed to browser code. Vercel uses `api/ai.js` as the production serverless endpoint.

## Deploy

Import this repository into Vercel, add `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`) in Project Settings → Environment Variables, then deploy. The key is read only in `api/ai.js`; it is never included in the Vite bundle or saved in browser storage.

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
- `api/ai.js` — Vercel Node.js Function and OpenAI Responses API adapter

PDF extraction uses PDF.js with its worker imported as a Vite asset. DOCX extraction uses Mammoth's browser build and `ArrayBuffer` input. AI output is constrained by JSON Schema and checked again with Zod before it reaches Redux. Resume/JD text is explicitly delimited and treated as untrusted data in the server prompt.

## Data and limitations

- Original uploaded binaries are not stored. Structured resume data, job descriptions, and saved versions are stored in this browser's `localStorage`.
- PDF.js cannot OCR image-only/scanned PDFs. The app explains this and offers text paste; OCR is intentionally outside this MVP.
- Local fallback parsing is conservative and deliberately does not guess experience structure. AI configuration is required for semantic parsing and automatic tailoring.
- Keyword coverage is a transparent literal match over recurring JD terms. It is not an ATS score or hiring probability.
- The generated PDF uses standard Helvetica for portability, working URL annotations, text selection, and page breaks. Complex scripts may require embedding an additional font in a future release.
- No real AI call can be verified without a user-provided server credential. Tests use deterministic fixtures; provider-specific behavior should be smoke-tested after configuration.

## Security notes

The function enforces request length limits, a 50-second provider timeout, strict structured output, schema validation, and non-invention/prompt-injection instructions. A malformed AI response returns an error and does not replace valid saved data. This personal-use MVP has no authentication or shared database; do not expose it as a multi-user service without adding access controls and abuse protection.
