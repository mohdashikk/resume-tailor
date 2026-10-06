import styles from './ResumePreview.module.css';
import { projectDisplayName, projectDisplaySubtitle } from '../services/projectRecoveryService.js';

const Dates = ({ item }) => <span>{[item.startDate, item.endDate].filter(Boolean).join(' – ')}</span>;
const Section = ({ title, children, show = true }) => show ? <section className={styles.section}><h2>{title}</h2>{children}</section> : null;

export default function ResumePreview({ resume, label = 'Resume preview' }) {
  if (!resume) return <div className={styles.empty}>Your ATS-friendly preview will appear here.</div>;
  return <article className={styles.paper} aria-label={label}>
    <header className={styles.header}>
      <h1>{resume.name || 'Your name'}</h1>
      {resume.title && <p className={styles.title}>{resume.title}</p>}
      <p className={styles.contact}>{[resume.contact.email, resume.contact.phone, resume.contact.location].filter(Boolean).join('  •  ')}</p>
      <p className={styles.links}>{resume.links.filter((x) => x.url).map((link, index) => <span key={link.id}><a href={link.url} target="_blank" rel="noreferrer">{link.label || link.url}</a>{index < resume.links.length - 1 ? '  •  ' : ''}</span>)}</p>
    </header>
    <Section title="Professional Summary" show={Boolean(resume.summary)}><p>{resume.summary}</p></Section>
    <Section title="Core Skills" show={resume.skillGroups.length > 0}><p className={styles.skillList}>{resume.skillGroups.flatMap((group) => group.skills).join('  •  ')}</p></Section>
    <Section title="Experience" show={resume.experience.length > 0}>{resume.experience.map((item) => <div className={styles.item} key={item.id}><div className={styles.itemHead}><div><strong>{item.role}</strong>{item.company && <b>{item.company}</b>}</div><Dates item={item} /></div>{item.location && <p className={styles.meta}>{item.location}</p>}<ul>{item.bullets.filter((b) => b.text).map((b) => <li key={b.id}>{b.text}</li>)}</ul></div>)}</Section>
    <Section title={resume.projectSectionTitle || 'Projects'} show={resume.projects.length > 0}>{resume.projects.map((item) => <div className={styles.item} key={item.id}><div className={styles.itemHead}><div><strong>{projectDisplayName(item)}</strong>{projectDisplaySubtitle(item) && <b>{projectDisplaySubtitle(item)}</b>}</div><Dates item={item} /></div><ul>{item.bullets.filter((b) => b.text).map((b) => <li key={b.id}>{b.text}</li>)}</ul></div>)}</Section>
    <Section title="Education" show={resume.education.length > 0}>{resume.education.map((item) => <div className={styles.item} key={item.id}><div className={styles.itemHead}><strong>{[item.qualification, item.institution].filter(Boolean).join(' — ')}</strong><Dates item={item} /></div>{item.details && <p>{item.details}</p>}</div>)}</Section>
    <Section title="Certifications" show={resume.certifications.length > 0}><ul>{resume.certifications.map((item) => <li key={item.id}>{[item.name, item.issuer, item.date].filter(Boolean).join(' — ')}</li>)}</ul></Section>
  </article>;
}
