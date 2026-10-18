# Tailoring comparison — 18 October 2026

Inspected the signed-in AI Job Maker dashboard and its saved **Frontend Engineer (React)** version, including its base resume, tailored preview, and expanded job description. Inspected our local Tailor & review screen and server implementation. No reference account data was changed and no new reference tailoring was generated. These are observations of visible saved output, not access to their private algorithm.

| Area | Reference saved output | Our previous behavior | Implemented behavior |
| --- | --- | --- | --- |
| Summary | Shortens a long paragraph; emphasizes React, JavaScript, UX, and SaaS work. Removes the long backend-learning and styling-framework narrative. | Preserved the summary on initial tailoring; selected skills could trigger a rewrite. | Initial and subsequent AI tailoring can shorten the summary using supported source facts. Numbers/tenure remain protected. |
| Experience length | First role: 10 → 6 bullets. Second: 6 → 4. Third: 6 → 3. | One source bullet → one edited bullet; could not consolidate. | AI can propose shorter same-entry merges using explicit source IDs. Application checks retain all distinct factual vocabulary and numerical claims. Rejected merges leave source bullets intact. |
| Experience wording | Combines related component/UI work and uses action-led statements. | Selected skills routed to compatible tasks, with repetition protection. | Retains this placement and allows consolidation after accepted edits. Related task bullets can be selected even without an exact JD spelling. |
| Skills | Regroups frontend, styling/UI, and backend/tools; retains relevant source skills and adds Accessibility supported elsewhere. | Groups developer skills as Frontend, Backend, Other; deduplicates aliases. | Retains our existing grouping and brand; supported skills can be promoted from source evidence. |
| Missing keywords | Short selectable skill labels; selection precedes rewriting. | Same pending-selection flow. | Preserved; selected skills are applied by Rewrite Resume and rescored against the same rubric. |
| Score | Saved base 34 → tailored 36, with 10 matched and 24 missing keywords. | Required/preferred weighted evidence rubric. | Retains our rubric. Their score weights and private algorithm cannot be inferred from one output. |
| Factual additions | Visible base does not clearly establish some generated leadership, QA reduction, error-handling outcomes, or sprint/code-review claims. | Vocabulary checks, metric protection, optional evidence review. | These checks remain. We do not copy unsupported generated claims. |
| Interface | ATS, keyword selection, cover letter, preview and base/tailored switch. | Branded review with preview left, score right and Rewrite under selections. | Preserved; no extra panels or filters added. |

## Content rules

- Remove filler and less relevant background from the summary only when its remaining claims stay source-supported.
- Consolidate overlapping experience bullets within the same job or project; preserve unique responsibilities, tools and metrics.
- Never merge employers, rewrite dates, delete qualifications, invent outcomes, or infer leadership.
- Insert selected skills once in their planned destination. Preserve pre-existing factual mentions.
- If AI omits a selected skill assigned to a compatible experience task, request a focused AI writing repair. Reject unresolved or keyword-prefixed output instead of inserting a mechanical With [skill] fallback. Existing awkward prefixes are also candidates for repair.
- Recalculate the match after the final summary, experience and skills changes. Keep the master separate from the tailored copy.

## Validation scope

Automated tests cover summary shortening, unsupported claims, tenure changes, same-role consolidation, cross-employer rejection, selected-keyword distribution, and original-document preservation. Live browser verification is recorded separately in the task response; fixture tests do not prove every possible AI paraphrase is factually equivalent.

Live local sample: selecting Redux and clicking Rewrite Resume inserted Redux in the frontend experience bullet, removed its missing-keyword chip, and recalculated the app estimate from 81 to 85. The sample's other experience bullet, education and contact fields remained visible. This is a sample app estimate, not an employer score or a prediction for the user's resume.
