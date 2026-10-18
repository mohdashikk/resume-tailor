import { z } from 'zod';

const text = z.string().max(12000).default('');
const shortText = z.string().max(500).default('');
const linkSchema = z.object({ id: z.string(), label: shortText, url: shortText });
const bulletSchema = z.object({ id: z.string(), text });
const experienceSchema = z.object({
  id: z.string(), masterId: z.string().optional(), role: shortText, company: shortText,
  location: shortText, startDate: shortText, endDate: shortText,
  bullets: z.array(bulletSchema).max(20).default([]),
});
const projectSchema = z.object({
  id: z.string(), masterId: z.string().optional(), name: shortText, subtitle: shortText,
  link: shortText, startDate: shortText, endDate: shortText,
  bullets: z.array(bulletSchema).max(20).default([]),
});
const educationSchema = z.object({
  id: z.string(), institution: shortText, qualification: shortText,
  location: shortText, startDate: shortText, endDate: shortText, details: text,
});
const skillGroupSchema = z.object({ id: z.string(), name: shortText, skills: z.array(shortText).max(100).default([]) });

export const resumeSchema = z.object({
  id: z.string(), name: shortText, title: shortText,
  projectSectionTitle: shortText,
  contact: z.object({ email: shortText, phone: shortText, location: shortText }),
  links: z.array(linkSchema).max(20).default([]), summary: text,
  skillGroups: z.array(skillGroupSchema).max(20).default([]),
  experience: z.array(experienceSchema).max(50).default([]),
  projects: z.array(projectSchema).max(50).default([]),
  education: z.array(educationSchema).max(30).default([]),
  certifications: z.array(z.object({ id: z.string(), name: shortText, issuer: shortText, date: shortText })).max(30).default([]),
  languages: z.array(shortText).max(50).default([]),
  ambiguities: z.array(text).max(50).default([]),
});

export const tailoredResultSchema = z.object({
  resume: resumeSchema,
  changeSummary: z.array(text).max(30).default([]),
  missingRequirements: z.array(text).max(30).default([]),
  tailoringReport: z.object({
    version: z.literal('role-evidence-v1'),
    roles: z.array(z.object({
      role_id: z.string(), entry_id: z.string(), section: z.enum(['experience', 'projects']),
      original_bullets: z.array(text), tailored_bullets: z.array(text),
      tailored_bullet_evidence: z.array(z.object({ bullet_index: z.number().int().nonnegative(), evidence_references: z.array(z.string()) })).default([]),
      status: z.enum(['tailored', 'retained', 'not_relevant']), validation_failures: z.array(shortText),
      matched_jd_requirements: z.array(z.object({ requirement_id: z.string(), term: shortText, classification: z.enum(['direct', 'transferable', 'unverified']), evidence_references: z.array(z.string()) })),
      evidence_references: z.array(z.object({ id: z.string(), text, origin: z.enum(['resume', 'verified_profile', 'user_role_confirmation']) }).passthrough()),
      changes_made: z.array(text), claims_requiring_verification: z.array(shortText),
    })).max(100),
    requirements: z.array(z.object({ id: z.string(), term: shortText, priority: z.enum(['required', 'preferred']), classification: z.enum(['direct', 'transferable', 'unverified']) }).passthrough()).max(150),
    claims_requiring_verification: z.array(z.object({ term: shortText, reason: text })),
  }).optional(),
  matchComparison: z.object({
    before: z.number().min(0).max(100), after: z.number().min(0).max(100),
    changedBullets: z.number().int().nonnegative(), rejectedBullets: z.number().int().nonnegative(),
    status: z.enum(['local', 'completed', 'unavailable']),
  }).optional(),
});

export const blankResume = () => ({
  id: crypto.randomUUID(), name: '', title: '', contact: { email: '', phone: '', location: '' },
  links: [], summary: '', projectSectionTitle: 'Projects', skillGroups: [], experience: [], projects: [], education: [], certifications: [], languages: [], ambiguities: [],
});

export function normalizeResume(candidate) {
  const withIds = {
    ...blankResume(), ...candidate,
    contact: { email: '', phone: '', location: '', ...(candidate?.contact || {}) },
    links: (candidate?.links || []).map((x) => ({ id: x.id || crypto.randomUUID(), label: x.label || '', url: x.url || '' })),
    skillGroups: (candidate?.skillGroups || []).map((x) => ({ id: x.id || crypto.randomUUID(), name: x.name || '', skills: x.skills || [] })),
    experience: (candidate?.experience || []).map((x) => ({ ...x, id: x.id || crypto.randomUUID(), bullets: (x.bullets || []).map((b) => typeof b === 'string' ? { id: crypto.randomUUID(), text: b } : { ...b, id: b.id || crypto.randomUUID() }) })),
    projects: (candidate?.projects || []).map((x) => ({ ...x, id: x.id || crypto.randomUUID(), bullets: (x.bullets || []).map((b) => typeof b === 'string' ? { id: crypto.randomUUID(), text: b } : { ...b, id: b.id || crypto.randomUUID() }) })),
    education: (candidate?.education || []).map((x) => ({ ...x, id: x.id || crypto.randomUUID() })),
    certifications: (candidate?.certifications || []).map((x) => ({ ...x, id: x.id || crypto.randomUUID() })),
  };
  return resumeSchema.parse(withIds);
}

export function validateResume(candidate) {
  return resumeSchema.safeParse(candidate);
}

export function formatResumeError(error) {
  if (Array.isArray(error?.issues)) {
    const fields = error.issues.slice(0, 3).map(({ path }) => path.map((part) => typeof part === 'number' ? `entry ${part + 1}` : part).join(' / '));
    return `Some resume fields could not be read reliably${fields.length ? ` (${fields.join('; ')})` : ''}. Review the source text or try a clearer file.`;
  }
  return error?.message || 'The resume could not be read. Please try another file or paste the text.';
}
