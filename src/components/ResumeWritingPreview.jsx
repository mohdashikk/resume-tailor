import { useEffect, useMemo, useRef, useState } from 'react';
import { projectDisplayName, projectDisplaySubtitle } from '../services/projectRecoveryService.js';
import styles from './ResumePreview.module.css';

function writingLines(resume) {
  const lines = [];
  const add = (kind, text) => { if (text) lines.push({ kind, text }); };
  const dates = (item) => [item.startDate, item.endDate].filter(Boolean).join(' – ');
  add('name', resume.name || 'Your name');
  add('title', resume.title);
  add('contact', [resume.contact.email, resume.contact.phone, resume.contact.location].filter(Boolean).join(' • '));
  add('contact', resume.links.filter((link) => link.url).map((link) => link.label || link.url).join(' • '));
  if (resume.summary) { add('heading', 'Professional Summary'); add('body', resume.summary); }
  if (resume.skillGroups.length) {
    add('heading', 'Core Skills');
    add('body', resume.skillGroups.flatMap((group) => group.skills).join(' • '));
  }
  if (resume.experience.length) add('heading', 'Experience');
  resume.experience.forEach((item) => {
    add('entry', [item.role, item.company].filter(Boolean).join(' — '));
    add('contact', [item.location, dates(item)].filter(Boolean).join(' • '));
    item.bullets.forEach((bullet) => add('bullet', bullet.text));
  });
  if (resume.projects.length) add('heading', resume.projectSectionTitle || 'Projects');
  resume.projects.forEach((item) => {
    add('entry', [projectDisplayName(item), projectDisplaySubtitle(item)].filter(Boolean).join(' — '));
    add('contact', dates(item));
    item.bullets.forEach((bullet) => add('bullet', bullet.text));
  });
  if (resume.education.length) add('heading', 'Education');
  resume.education.forEach((item) => {
    add('entry', [item.qualification, item.institution].filter(Boolean).join(' — '));
    add('contact', dates(item));
    add('body', item.details);
  });
  if (resume.certifications.length) add('heading', 'Certifications');
  resume.certifications.forEach((item) => add('bullet', [item.name, item.issuer, item.date].filter(Boolean).join(' — ')));
  if (resume.languages?.some((value) => value.trim())) { add('heading', 'Languages'); add('body', resume.languages.filter((value) => value.trim()).join(', ')); }
  let offset = 0;
  return lines.map((line) => {
    const result = { ...line, start: offset, end: offset + line.text.length };
    offset = result.end;
    return result;
  });
}

export default function ResumeWritingPreview({ resume, onComplete }) {
  const lines = useMemo(() => writingLines(resume), [resume]);
  const total = lines.at(-1)?.end || 0;
  const [visible, setVisible] = useState(0);
  const cursorRef = useRef(null);
  const completeRef = useRef(onComplete);

  useEffect(() => { completeRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    setVisible(0);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer;
    const start = () => {
      clearInterval(timer);
      if (preference.matches) { setVisible(total); return; }
      let count = 0;
      setVisible(0);
      // Small bursts feel like streamed writing, with a single pass down the page.
      const burst = Math.max(2, Math.ceil(total / 450));
      timer = setInterval(() => {
        count = Math.min(total, count + burst);
        setVisible(count);
        if (count === total) clearInterval(timer);
      }, 45);
    };
    start();
    preference.addEventListener('change', start);
    return () => { clearInterval(timer); preference.removeEventListener('change', start); };
  }, [total, lines]);

  useEffect(() => {
    const cursor = cursorRef.current;
    const pane = cursor?.closest('[data-writing-scroll]');
    if (pane) {
      const overflow = cursor.getBoundingClientRect().bottom - pane.getBoundingClientRect().bottom + 32;
      if (overflow > 0) pane.scrollTop += overflow;
    }
    if (visible < total) return;
    // Let the final line paint and remain visible before showing the finished view.
    const timeout = setTimeout(() => completeRef.current?.(), 400);
    return () => clearTimeout(timeout);
  }, [visible, total]);

  const active = lines.findIndex((line) => visible < line.end);
  return <article className={`${styles.paper} ${styles.typingPaper}`} aria-label="Writing tailored resume" aria-busy="true">
    <div aria-hidden="true">
      {lines.map((line, index) => {
        if (index > active && active !== -1) return null;
        const Tag = line.kind === 'name' ? 'h1' : line.kind === 'heading' ? 'h2' : 'p';
        return <Tag key={index} className={styles[`typing_${line.kind}`]}>
          {line.text.slice(0, Math.max(0, visible - line.start))}
          {(index === active || (active === -1 && index === lines.length - 1)) && <span ref={cursorRef} className={styles.typingCursor} />}
        </Tag>;
      })}
    </div>
  </article>;
}
