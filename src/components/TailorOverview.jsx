import { useEffect, useRef, useState } from 'react';
import styles from './TailorOverview.module.css';
import { isRequirementHeading } from '../services/atsAnalysis';
import { isMeaningfulBulletRewrite } from '../services/targetedTailoringService';

export default function TailorOverview({ resume, sourceResume, jd, before, analysis, onRetailor, onRestartFromOriginal, onViewExperience, retailoring, retailorError, retrySecondsRemaining = 0, editingUnavailable }) {
  const [letter, setLetter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedSkills, setSelectedSkills] = useState({});
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { setLetter(''); setError(''); setBusy(false); active.current?.abort(); active.current = null; }, [resume, jd]);
  const match = analysis?.match || { matched: [], missing: [], uncertain: [] };
  const missing = [...match.missing, ...match.uncertain].filter(term => !isRequirementHeading(term));
  const score = analysis?.score;
  const delta = score != null && before != null ? score - before : null;
  const matchedVisible = match.matched, missingVisible = missing;
  const sourceBullets = sourceResume?.experience.flatMap(entry => entry.bullets.map(bullet => [bullet.id, bullet.text])) || [];
  const tailoredBullets = new Map(resume.experience.flatMap(entry => entry.bullets.map(bullet => [bullet.id, bullet.text])));
  const changedExperienceBullets = sourceBullets.filter(([id, text]) => tailoredBullets.has(id) && isMeaningfulBulletRewrite(text, tailoredBullets.get(id))).length;
  const remainingExperienceBullets = sourceBullets.length - changedExperienceBullets;
  const generate = async () => {
    const request = new AbortController(); active.current = request; setBusy(true); setError('');
    const timeout = setTimeout(() => request.abort(), 55000);
    try {
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: request.signal, body: JSON.stringify({ action: 'coverLetter', payload: { resume, jobDescription: jd } }) });
      const body = await response.json();
      if (!response.ok || !body.data?.text) throw new Error(body.error || 'Could not generate the cover letter. Please retry.');
      if (!request.signal.aborted) setLetter(body.data.text);
    } catch (e) { if (active.current === request) setError(request.signal.aborted ? 'Cover-letter generation timed out. Please retry.' : e.message); }
    finally { clearTimeout(timeout); if (active.current === request) setBusy(false); }
  };
  return <>
    <header className={styles.intro}><h2>Tailor for <span>Job</span></h2><p>Review the match, then rewrite the complete resume around your real experience.</p></header>
    <section className={styles.card} aria-label="ATS match overview"><h3>ATS Match Score</h3>
      {sourceResume && <p className={styles.retailorHelp} role="status">Experience updated: {changedExperienceBullets} of {sourceBullets.length} source bullets rephrased in this tailored copy. Your base resume stays unchanged. <button type="button" onClick={onViewExperience}>View rewritten Experience</button></p>}
      <div className={styles.scores}><div><small>Base</small><strong>{before ?? '—'}</strong></div><span>→</span><div><small>Tailored</small><b>{score ?? '—'}</b><span>/100</span></div>{delta !== null && <em>{delta > 0 ? '+' : ''}{delta}</em>}</div>
      <div className={styles.track} role="meter" aria-label="Tailored ATS match" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score ?? 0}><span style={{ width: `${score ?? 0}%` }} /></div>
      <h4><span className={styles.check}>✓</span> Matched keywords ({match.matched.length})</h4><div className={styles.chips}>{matchedVisible.map(term => <span key={term}>{term}</span>)}{!matchedVisible.length && <small>No matched keywords yet.</small>}</div>
      <h4><span className={styles.cross}>×</span> Missing / needs review ({missing.length})</h4><div className={styles.missing}>{missingVisible.map(term => {
        const skill = term.split(/\s+/).length <= 5 && !/\b(?:years?|degree|certif\w*|license|expert|proficien\w*)\b/i.test(term);
        return skill ? <label key={term}><input type="checkbox" checked={Object.hasOwn(selectedSkills, term)} disabled={retailoring} onChange={() => setSelectedSkills(current => { const next = { ...current }; if (Object.hasOwn(next, term)) delete next[term]; else next[term] = ''; return next; })} /><span>{term}</span><i>{Object.hasOwn(selectedSkills, term) ? '✓' : '+'}</i></label> : <span key={term}>{term}</span>;
      })}{!missingVisible.length && <small>No missing keywords.</small>}</div><p className={styles.hint}>Optional: confirm skills you genuinely have. The app attempts to rewrite the full resume whether or not you select a keyword.</p><small className={styles.note}>AI rewrites supported summary, experience, project, and education descriptions. It retains a source line when a factual rewrite cannot be verified.</small>
      <button className={styles.generate} disabled={retailoring || retrySecondsRemaining > 0} onClick={() => onRetailor(Object.keys(selectedSkills).map(term => ({ term })))}>{retailoring ? 'Rewriting resume…' : retrySecondsRemaining > 0 ? `Groq rate limit · retry in ${Math.floor(retrySecondsRemaining / 60)}:${String(retrySecondsRemaining % 60).padStart(2, '0')}` : remainingExperienceBullets ? `Retry ${remainingExperienceBullets} Experience bullet${remainingExperienceBullets === 1 ? '' : 's'} needing a fuller rewrite${Object.keys(selectedSkills).length ? ` (${Object.keys(selectedSkills).length} skills confirmed)` : ''}` : `Rewrite Resume${Object.keys(selectedSkills).length ? ` (${Object.keys(selectedSkills).length} selected)` : ''}`}</button>
      {onRestartFromOriginal && <button className={styles.restart} disabled={retailoring || retrySecondsRemaining > 0} onClick={() => onRestartFromOriginal(Object.keys(selectedSkills).map(term => ({ term })))}>Rewrite from original resume</button>}
      {(editingUnavailable || remainingExperienceBullets > 0) && <p className={styles.retailorHelp}>Some resume descriptions need a fuller source-backed rephrase. Retry uses the original resume as evidence and keeps previously accepted rewrites. “Rewrite from original resume” starts a fresh copy instead.</p>}{retailorError && <p role="alert">{retailorError}</p>}
    </section>
    <section className={`${styles.card} ${styles.letter}`}><h3>✉ Cover Letter</h3><p>Generate a cover letter for this role from your resume. Review and edit it before sending.</p><button className={styles.generate} disabled={busy} onClick={generate}>{busy ? 'Generating cover letter…' : '✦ Generate Cover Letter'}</button>{error && <p role="alert">{error}</p>}{letter && <><label className={styles.letterLabel}>Edit cover letter<textarea rows={14} value={letter} onChange={event => setLetter(event.target.value)} /></label><button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([letter], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'cover-letter.txt'; link.click(); URL.revokeObjectURL(url); }}>Download letter</button></>}</section>

  </>;
}
