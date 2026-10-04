import { useMemo } from 'react';
import { buildChangeAudit } from '../services/changeAuditService';
import styles from './ChangeAudit.module.css';

export default function ChangeAudit({ master, tailored, jdKeywords }) {
  const audit = useMemo(() => buildChangeAudit(master, tailored, jdKeywords), [master, tailored, jdKeywords]);

  return <section className={styles.panel} aria-labelledby="edit-history-title">
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>Before → after</span><h3 id="edit-history-title">Tailoring edit history</h3><p>See exactly where the tailored resume differs from your master.</p></div>
      <span className={styles.count}>{audit.changes.length} edits</span>
    </div>

    <div className={styles.jdBox}>
      <strong>JD language introduced</strong>
      <p>These tracked JD terms appear in the tailored version but were not present verbatim in the master. Review them for accuracy—they are wording matches, not proof of a qualification.</p>
      <div className={styles.terms}>{audit.introducedTerms.length ? audit.introducedTerms.map((term) => <span key={term}>{term}</span>) : <em>No new tracked JD terms were introduced.</em>}</div>
    </div>

    <div className={styles.changeList}>
      {audit.changes.length ? audit.changes.map((change) => <article className={styles.change} key={change.id}>
        <div className={styles.changeHead}><strong>{change.location}</strong>{change.jdTerms.length > 0 && <div>{change.jdTerms.map((term) => <span key={term}>JD: {term}</span>)}</div>}</div>
        <div className={styles.columns}><div><small>Master</small><p>{change.before}</p></div><div className={styles.after}><small>Tailored</small><p>{change.after}</p></div></div>
      </article>) : <p className={styles.empty}>No text differences detected between the master and tailored version.</p>}
    </div>
  </section>;
}
