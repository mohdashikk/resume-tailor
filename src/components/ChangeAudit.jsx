import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildChangeAudit, rejectAuditChange } from '../services/changeAuditService';
import styles from './ChangeAudit.module.css';

export default function ChangeAudit({ master, tailored, jdKeywords, onChange, defaultOpen = true }) {
  const audit = useMemo(() => buildChangeAudit(master, tailored, jdKeywords), [master, tailored, jdKeywords]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [decisions, setDecisions] = useState({});

  useEffect(() => {
    setActiveIndex((current) => Math.max(0, Math.min(current, audit.changes.length - 1)));
  }, [audit.changes.length]);

  const safeIndex = Math.max(0, Math.min(activeIndex, audit.changes.length - 1));
  const change = audit.changes[safeIndex];
  const reviewedCount = Object.keys(decisions).length;
  const move = (direction) => setActiveIndex((current) => {
    const total = audit.changes.length;
    if (!total) return 0;
    return (current + direction + total) % total;
  });
  const decide = (decision) => {
    if (!change) return;
    if (decision === 'rejected' && onChange) onChange(rejectAuditChange(tailored, master, change));
    setDecisions((current) => ({ ...current, [change.id]: decision }));
    if (safeIndex < audit.changes.length - 1) {
      setActiveIndex(safeIndex + 1);
    } else {
      setIsOpen(false);
    }
  };

  if (!audit.changes.length) return null;

  if (!isOpen) {
    return createPortal(<button type="button" className={styles.launcher} onClick={() => setIsOpen(true)}>
      <span>✦</span><strong>{reviewedCount >= audit.changes.length ? 'AI edits reviewed' : 'Review AI edits'}</strong><em>{reviewedCount}/{audit.changes.length}</em>
    </button>, document.body);
  }

  const currentDecision = decisions[change.id];
  const reason = change.jdTerms.length
    ? `Uses relevant job language such as ${change.jdTerms.slice(0, 3).join(', ')} while keeping the resume grounded in your source content.`
    : 'Improves clarity, relevance, and readability while preserving the facts from your base resume.';

  return createPortal(<section className={styles.panel} aria-labelledby="edit-history-title" aria-live="polite">
    <header className={styles.heading}>
      <div className={styles.title}><span className={styles.spark}>✦</span><div><h3 id="edit-history-title">AI change review</h3><p>{change.location}</p></div></div>
      <div className={styles.navigation}>
        <span>{safeIndex + 1} of {audit.changes.length}</span>
        <button type="button" aria-label="Previous change" onClick={() => move(-1)}>‹</button>
        <button type="button" aria-label="Next change" onClick={() => move(1)}>›</button>
        <button type="button" className={styles.close} aria-label="Close change review" onClick={() => setIsOpen(false)}>×</button>
      </div>
    </header>

    <div className={styles.columns}>
      <div><small>Before</small><p>{change.before}</p></div>
      <div className={styles.after}><small>After</small><p>{change.after}</p></div>
    </div>

    <div className={styles.footer}>
      <div className={styles.reason}><span>i</span><p><strong>Why this change?</strong>{reason}</p></div>
      <div className={styles.actions}>
        <button type="button" className={`${styles.reject} ${currentDecision === 'rejected' ? styles.selected : ''}`} onClick={() => decide('rejected')}>× Reject</button>
        <button type="button" className={`${styles.accept} ${currentDecision === 'accepted' ? styles.selected : ''}`} onClick={() => decide('accepted')}>✓ Accept</button>
      </div>
    </div>
    <div className={styles.progress} aria-label={`${reviewedCount} of ${audit.changes.length} changes reviewed`}><span style={{ width: `${(reviewedCount / audit.changes.length) * 100}%` }} /></div>
  </section>, document.body);
}
