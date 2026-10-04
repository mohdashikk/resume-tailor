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
  ambiguities: z.array(text).max(50).default([]),
});

export const tailoredResultSchema = z.object({
  resume: resumeSchema,
  changeSummary: z.array(text).max(30).default([]),
  missingRequirements: z.array(text).max(30).default([]),
});

export const blankResume = () => ({
  id: crypto.randomUUID(), name: '', title: '', contact: { email: '', phone: '', location: '' },
  links: [], summary: '', projectSectionTitle: 'Projects', skillGroups: [], experience: [], projects: [], education: [], certifications: [], ambiguities: [],
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
