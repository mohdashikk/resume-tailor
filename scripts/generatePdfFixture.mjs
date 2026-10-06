import { mkdir, writeFile } from 'node:fs/promises';
import { createResumePdfDocument } from '../src/services/pdfService.js';

const resume = {
  id: 'qa-resume', name: 'ALEX MORGAN', title: 'UI/UX DESIGNER | PRODUCT DESIGN | FRONT-END UI',
  contact: { email: 'alex@example.com', phone: '+91 90000 00000', location: 'Kerala, India' },
  links: [
    { id: 'l1', label: 'LinkedIn', url: 'https://linkedin.com/in/alex' },
    { id: 'l2', label: 'Portfolio', url: 'https://example.com' },
  ],
  summary: 'Product designer with 6+ years of experience delivering end-to-end UX and UI for SaaS applications. Expert in user flows, wireframing, high-fidelity prototyping, design systems, and front-end collaboration. A strong focus on WCAG accessibility ensures inclusive and practical experiences.',
  skillGroups: [
    { id: 's1', name: 'UX / Product', skills: ['User research', 'User flows', 'Information architecture', 'Wireframing', 'Prototyping', 'Interaction design', 'Usability testing'] },
    { id: 's2', name: 'UI / Systems', skills: ['Figma', 'Components', 'UI kits', 'Visual design', 'Responsive design', 'WCAG accessibility'] },
    { id: 's3', name: 'Technical (design support)', skills: ['HTML5', 'CSS3', 'Sass', 'Tailwind CSS', 'JavaScript', 'React.js', 'Git', 'GitHub'] },
    { id: 's4', name: 'Additional relevant skills', skills: ['Figma Dev Mode', 'Developer handoff', 'Agile / Scrum', 'Cross-browser compatibility'] },
  ],
  experience: Array.from({ length: 7 }, (_, index) => ({
    id: `exp-${index}`, role: index ? 'UI/UX Designer' : 'Senior UI/UX Designer', company: `Example Product Company ${index + 1}`,
    location: index % 2 ? 'Kochi, Kerala' : 'Trivandrum, Kerala', startDate: `Jan 20${18 + index}`, endDate: index ? `Dec 20${19 + index}` : 'Present',
    bullets: [
      { id: `b-${index}-1`, text: 'Designed responsive SaaS workflows spanning onboarding, authentication, dashboards, order processing, reporting, billing, and role-based access.' },
      { id: `b-${index}-2`, text: 'Translated complex business requirements into user flows, wireframes, validation states, polished Figma screens, touchscreen views, and interactive prototypes.' },
      { id: `b-${index}-3`, text: 'Built reusable design-system components and collaborated with product managers and developers through Agile reviews and clear developer handoff.' },
    ],
  })),
  projects: [
    { id: 'p1', name: 'Blockspace Applicant Tracking System', subtitle: 'Recruitment and candidate-management workflows', link: 'https://example.com/blockspace', startDate: '', endDate: '', bullets: [{ id: 'pb1', text: 'Designed accessible recruitment workflows and responsive recruiter tools with clear information hierarchy.' }] },
    { id: 'p2', name: 'Enabled2Parent', subtitle: 'Responsive website for a UK charity supporting parents', link: '', startDate: '', endDate: '', bullets: [{ id: 'pb2', text: 'Created a clear, accessible content structure and mobile-friendly interface.' }] },
  ],
  education: [{ id: 'e1', qualification: 'Bachelor of Arts (BA) - Distance Education', institution: 'Example University', location: 'Kerala, India', startDate: '2018', endDate: '2021', details: 'Final-year project focused on digital product communication and accessible interface design.' }],
  certifications: [
    { id: 'c1', name: 'Accessibility for Designers', issuer: 'Example Institute', date: '2024' },
    { id: 'c2', name: 'Advanced Figma Systems', issuer: 'Example Academy', date: '2023' },
  ], ambiguities: [],
};

const outputDirectory = new URL('../output/pdf/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const document = await createResumePdfDocument(resume);
await writeFile(new URL('doitnext-resume-export-sample.pdf', outputDirectory), Buffer.from(document.output('arraybuffer')));
