import styles from './ResumePreview.module.css';
import { projectDisplayName, projectDisplaySubtitle } from '../services/projectRecoveryService.js';
import { groupSkillsForResume } from '../services/skillGroupingService.js';
import { aliases, canonicalTerm } from '../services/atsAnalysis.js';
import { educationDetails, resumeLink } from '../services/resumePresentation.js';

function KeywordText({ text, keywords }) {
  const terms = new Set(keywords.map(canonicalTerm));
  const variants = [...new Set([...terms, ...Object.keys(aliases).filter(alias => terms.has(aliases[alias]))])].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!variants.length) return text;
  const pattern = new RegExp(`(^|[^a-z0-9+#])(${variants.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[^a-z0-9+#])`, 'gi');
  const parts = []; let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1].length;
    // React Native is a distinct skill, not evidence of React web experience.
    if (canonicalTerm(match[2]) === 'react' && /^\s+native\b/i.test(text.slice(start + match[2].length))) continue;
    parts.push(text.slice(cursor, start), <mark key={start} className={styles.keyword}>{match[2]}</mark>);
    cursor = start + match[2].length;
  }
  parts.push(text.slice(cursor));
  return parts;
}

const Dates = ({ item, includeLocation = false }) => <span>{[[item.startDate, item.endDate].filter(Boolean).join(' - '), includeLocation ? item.location : ''].filter(Boolean).join(' · ')}</span>;
const Section = ({ title, children, show = true, sectionKey, activeSection }) => show ? <section data-preview-section={sectionKey} className={`${styles.section} ${activeSection === sectionKey ? styles.highlighted : ''}`}><h2>{title}</h2>{children}</section> : null;

export default function ResumePreview({ resume, label = 'Resume preview', activeSection = '', keywords = [] }) {
  if (!resume) return <div className={styles.empty}>Your ATS-friendly preview will appear here.</div>;
  const skillGroups = groupSkillsForResume(resume);
  return <article className={styles.paper} aria-label={label}>
    <header className={`${styles.header} ${activeSection === 'personal' ? styles.highlighted : ''}`} data-preview-section="personal">
      <h1>{resume.name || 'Your name'}</h1>
      {resume.title && <p className={styles.title}>{resume.title}</p>}
      <p className={styles.contact}>{[resume.contact.email, resume.contact.phone, resume.contact.location].filter(Boolean).join('  |  ')}</p>
      <p className={styles.links}>{resume.links.map(resumeLink).filter((link) => link.url).map((link, index) => <span key={link.id}>{index > 0 || Object.values(resume.contact).some(Boolean) ? '  |  ' : ''}<a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></span>)}</p>
    </header>
    <Section title="Professional Summary" sectionKey="personal" activeSection={activeSection} show={Boolean(resume.summary)}><p><KeywordText text={resume.summary} keywords={keywords} /></p></Section>
    <Section title="Skills" sectionKey="skills" activeSection={activeSection} show={skillGroups.length > 0}><div className={styles.skillList}>{skillGroups.filter((group) => group.skills.length).map((group) => <p key={group.id}>{group.name && <strong>{group.name}: </strong>}{<KeywordText text={group.skills.join(', ')} keywords={keywords} />}</p>)}</div></Section>
    <Section title="Professional Experience" sectionKey="experience" activeSection={activeSection} show={resume.experience.length > 0}>{resume.experience.map((item) => <div className={styles.item} key={item.id}><div className={styles.itemHead}><div><strong>{item.role}</strong>{item.company && <b>{item.company}</b>}</div><Dates item={item} includeLocation /></div><ul>{item.bullets.filter((b) => b.text).map((b) => <li key={b.id}><KeywordText text={b.text} keywords={keywords} /></li>)}</ul></div>)}</Section>
    <Section title={resume.projectSectionTitle || 'Projects'} sectionKey="projects" activeSection={activeSection} show={resume.projects.length > 0}>{resume.projects.map((item) => <div className={styles.item} key={item.id}><div className={styles.itemHead}><div><strong>{projectDisplayName(item)}</strong>{projectDisplaySubtitle(item) && <b>{projectDisplaySubtitle(item)}</b>}</div><Dates item={item} /></div>{item.link && <p className={styles.meta}><a href={item.link} target="_blank" rel="noreferrer">{item.link}</a></p>}<ul>{item.bullets.filter((b) => b.text).map((b) => <li key={b.id}><KeywordText text={b.text} keywords={keywords} /></li>)}</ul></div>)}</Section>
    <Section title="Education" sectionKey="education" activeSection={activeSection} show={resume.education.length > 0}>{resume.education.map((item) => <div className={styles.item} key={item.id}><div className={styles.itemHead}><strong>{[item.qualification, item.institution].filter(Boolean).join(' — ')}</strong><Dates item={item} /></div>{item.location && <p className={styles.meta}>{item.location}</p>}{educationDetails(item) && <p>{educationDetails(item)}</p>}</div>)}</Section>
    <Section title="Certifications" sectionKey="more" activeSection={activeSection} show={resume.certifications.length > 0}><ul>{resume.certifications.map((item) => <li key={item.id}>{[item.name, item.issuer, item.date].filter(Boolean).join(' — ')}</li>)}</ul></Section>
    <Section title="Languages" sectionKey="more" activeSection={activeSection} show={Boolean(resume.languages?.some((value) => value.trim()))}><p>{resume.languages?.map((value) => value.trim()).filter(Boolean).join(', ')}</p></Section>
  </article>;
}
