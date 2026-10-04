import { useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import ResumeEditor from './components/ResumeEditor';
import ResumePreview from './components/ResumePreview';
import { resumeActions } from './features/resume/resumeSlice';
import { jobActions } from './features/jobDescription/jobSlice';
import { tailoringActions } from './features/tailoring/tailoringSlice';
import { extractResumeText } from './services/fileExtraction';
import { parseResumeWithAI, tailorResumeWithAI } from './services/aiService';
import { parseResumeLocally } from './services/localResumeParser';
import { analyzeMatch } from './services/matchingService';
import { tailoredResultSchema, validateResume } from './services/resumeValidation';
import { downloadResumePdf } from './services/pdfService';
import { exportBackup, importBackup, STORAGE_KEY } from './services/storageService';
import styles from './App.module.css';

const stages = ['Upload & Base Resume', 'Job Description & Tailoring', 'Review & Export'];

function Status({ type = 'info', children }) { return children ? <div className={`${styles.status} ${styles[type]}`} role={type === 'error' ? 'alert' : 'status'}>{children}</div> : null; }

export default function App({ recovered = false }) {
  const dispatch = useDispatch();
  const { resume, job, tailoring } = useSelector((state) => state);
  const [stage, setStage] = useState(resume.masterResume ? 2 : 1);
  const [mobileView, setMobileView] = useState('editor');
  const [notice, setNotice] = useState(recovered ? 'Invalid saved data was moved to a recovery key and a clean workspace was opened.' : '');
  const fileRef = useRef(); const backupRef = useRef();
  const match = useMemo(() => analyzeMatch(resume.masterResume || resume.workingResume, job.text), [resume.masterResume, resume.workingResume, job.text]);

  const parseText = async (text, sourceName = 'Pasted text') => {
    dispatch(resumeActions.setUploadStatus({ status: 'parsing', progress: 78, message: 'Structuring resume with AI…', error: '' }));
    try {
      const parsed = await parseResumeWithAI(text);
      dispatch(resumeActions.setWorkingResume(parsed));
      dispatch(resumeActions.setUploadStatus({ status: 'succeeded', progress: 100, message: 'Resume parsed. Review every field before saving the master.', error: '' }));
    } catch (error) {
      const fallback = parseResumeLocally(text);
      dispatch(resumeActions.setWorkingResume(fallback));
      dispatch(resumeActions.setUploadStatus({ status: 'fallback', progress: 100, message: '', error: error.code === 'AI_NOT_CONFIGURED' ? 'AI is not configured. Basic on-device parsing was used; review and structure the result manually. Add OPENAI_API_KEY on the server for semantic parsing and tailoring.' : `${error.message} Basic on-device parsing was used instead; your previous saved master was not changed.` }));
    }
    dispatch(resumeActions.setExtractedText(text)); dispatch(resumeActions.setSourceName(sourceName));
  };

  const handleFile = async (file) => {
    if (!file) return;
    dispatch(resumeActions.setUploadStatus({ status: 'extracting', progress: 5, message: 'Reading file…', error: '' }));
    try {
      const extracted = await extractResumeText(file, ({ stage: next, percent }) => dispatch(resumeActions.setUploadStatus({ status: next, progress: percent, message: 'Extracting selectable text…', error: '' })));
      await parseText(extracted.text, file.name);
      if (extracted.warnings.length) setNotice(extracted.warnings.join(' '));
    } catch (error) {
      dispatch(resumeActions.setUploadStatus({ status: 'error', progress: 0, message: '', error: error.message }));
    }
  };

  const saveMaster = () => {
    const result = validateResume(resume.workingResume);
    if (!result.success) return dispatch(resumeActions.setUploadStatus({ status: 'error', error: 'Correct the invalid fields before saving the master resume.' }));
    dispatch(resumeActions.confirmMaster()); setNotice('Master resume saved locally. Tailored versions will remain separate.'); setStage(2); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const generate = async () => {
    if (!resume.masterResume) return setNotice('Save a master resume first.');
    if (job.text.trim().length < 80) return dispatch(tailoringActions.setTailoringStatus({ status: 'failed', error: 'Paste a fuller job description (at least 80 characters).' }));
    dispatch(tailoringActions.setTailoringStatus({ status: 'loading', error: '' }));
    try {
      const candidate = await tailorResumeWithAI(resume.masterResume, job.text, job.company, job.jobTitle);
      const validated = tailoredResultSchema.safeParse(candidate);
      if (!validated.success) throw new Error('The AI returned malformed resume data. Your master resume was not changed.');
      dispatch(tailoringActions.setTailoredResult(validated.data)); setStage(3); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) { dispatch(tailoringActions.setTailoringStatus({ status: 'failed', error: error.message })); }
  };

  const saveVersion = () => {
    if (!tailoring.current) return;
    dispatch(tailoringActions.saveVersion({ ...structuredClone(tailoring.current), id: crypto.randomUUID(), company: job.company, jobTitle: job.jobTitle, jobDescription: job.text, createdAt: new Date().toISOString() }));
    setNotice('Tailored version saved locally.');
  };

  const stateForBackup = useSelector((state) => ({ masterResume: state.resume.masterResume, workingResume: state.resume.workingResume, sourceName: state.resume.sourceName, job: state.job, current: state.tailoring.current, versions: state.tailoring.versions }));
  const restoreBackup = async (file) => {
    try { const data = await importBackup(file); dispatch(resumeActions.hydrateResume({ masterResume: data.masterResume, workingResume: data.workingResume, sourceName: data.sourceName })); dispatch(jobActions.hydrateJob(data.job || {})); dispatch(tailoringActions.hydrateTailoring({ current: data.current, versions: data.versions })); setNotice('Backup imported.'); }
    catch (error) { setNotice(error.message); }
  };
  const clearAll = () => { if (!window.confirm('Clear the master resume, job description, and all saved versions from this browser?')) return; localStorage.removeItem(STORAGE_KEY); dispatch(resumeActions.clearResume()); dispatch(jobActions.clearJob()); dispatch(tailoringActions.clearTailoring()); setStage(1); setNotice('Saved data cleared.'); };

  const viewToggle = <div className={styles.viewToggle} aria-label="Choose mobile view"><button className={mobileView === 'editor' ? styles.active : ''} onClick={() => setMobileView('editor')}>Editor</button><button className={mobileView === 'preview' ? styles.active : ''} onClick={() => setMobileView('preview')}>Preview</button></div>;

  return <div className={styles.app}>
    <header className={styles.topbar}><a className={styles.brand} href="#top" aria-label="Reum home"><span>R</span> Reum</a><p>Truthful tailoring for stronger applications</p><div className={styles.dataActions}><button onClick={() => exportBackup(stateForBackup)}>Backup JSON</button><button onClick={() => backupRef.current?.click()}>Import</button><button className={styles.dangerLink} onClick={clearAll}>Clear</button><input ref={backupRef} hidden type="file" accept="application/json,.json" onChange={(e) => restoreBackup(e.target.files[0])} /></div></header>
    <main id="top">
      <section className={styles.hero}><div><span className={styles.eyebrow}>AI resume studio</span><h1>Your experience, focused for the role.</h1><p>Import once, keep a trusted master, and tailor without inventing a thing.</p></div><div className={styles.privacy}>Files stay in your browser. Only extracted text is sent to AI when requested.</div></section>
      <nav className={styles.steps} aria-label="Resume workflow">{stages.map((name, index) => { const number = index + 1; const disabled = number === 2 && !resume.masterResume || number === 3 && !tailoring.current; return <button key={name} disabled={disabled} className={stage === number ? styles.currentStep : stage > number ? styles.doneStep : ''} onClick={() => setStage(number)}><span>{stage > number ? '✓' : number}</span>{name}</button>; })}</nav>
      {notice && <Status>{notice}<button className={styles.dismiss} onClick={() => setNotice('')} aria-label="Dismiss">×</button></Status>}

      {stage === 1 && <section className={styles.stage}>
        <div className={styles.stageIntro}><div><span className={styles.stageNumber}>01</span><h2>Build your trusted base</h2><p>Upload a PDF or DOCX, then correct the structured fields before locking in your master resume.</p></div>{resume.sourceName && <span className={styles.filePill}>● {resume.sourceName}</span>}</div>
        <div className={styles.uploadBox} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}><div className={styles.uploadIcon}>↥</div><h3>Drop your resume here</h3><p>PDF or DOCX · up to 10 MB · text is extracted in your browser</p><button className={styles.secondary} onClick={() => fileRef.current?.click()}>Choose file</button><input hidden ref={fileRef} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => handleFile(e.target.files[0])} /></div>
        {(resume.upload.status !== 'idle') && <div className={styles.progressWrap}><div className={styles.progressLabel}><span>{resume.upload.message || (resume.upload.status === 'error' ? 'Could not process file' : 'Ready to review')}</span><strong>{resume.upload.progress}%</strong></div><div className={styles.progress}><span style={{ width: `${resume.upload.progress}%` }} /></div>{resume.upload.error && <Status type="error">{resume.upload.error} {resume.extractedText && <button className={styles.inlineButton} onClick={() => parseText(resume.extractedText, resume.sourceName)}>Retry AI parsing</button>}</Status>}</div>}
        <details className={styles.pasteFallback}><summary>Paste resume text instead</summary><textarea rows="8" value={resume.extractedText} onChange={(e) => dispatch(resumeActions.setExtractedText(e.target.value))} placeholder="Paste all resume text here…" /><button className={styles.secondary} disabled={resume.extractedText.trim().length < 40} onClick={() => parseText(resume.extractedText)}>Parse pasted text</button></details>
        {resume.workingResume && <><div className={styles.editorToolbar}><div><h3>Review extracted content</h3><p>Nothing is final until you save the master resume.</p></div>{viewToggle}</div><div className={`${styles.workspace} ${styles[mobileView]}`}><div className={styles.editorPane}><ResumeEditor resume={resume.workingResume} onChange={(value) => dispatch(resumeActions.setWorkingResume(value))} />{resume.workingResume.ambiguities.length > 0 && <Status type="warning"><strong>Review needed:</strong> {resume.workingResume.ambiguities.join(' ')}</Status>}<button className={styles.primary} onClick={saveMaster}>Save as master resume →</button></div><div className={styles.previewPane}><div className={styles.previewLabel}>Live A4 preview</div><ResumePreview resume={resume.workingResume} /></div></div></>}
      </section>}

      {stage === 2 && <section className={styles.stage}>
        <div className={styles.stageIntro}><div><span className={styles.stageNumber}>02</span><h2>Focus on the opportunity</h2><p>Paste the complete job description. Reum compares it with your master before tailoring.</p></div><span className={styles.filePill}>Master saved</span></div>
        <div className={styles.jobGrid}><div className={styles.jobForm}><div className={styles.twoCols}><label>Company <input value={job.company} onChange={(e) => dispatch(jobActions.updateJob({ company: e.target.value }))} placeholder="Acme, Inc." /></label><label>Job title <input value={job.jobTitle} onChange={(e) => dispatch(jobActions.updateJob({ jobTitle: e.target.value }))} placeholder="Senior Product Designer" /></label></div><label>Complete job description <textarea rows="18" value={job.text} onChange={(e) => dispatch(jobActions.updateJob({ text: e.target.value }))} placeholder="Paste the full job description…" /></label><p className={styles.charCount}>{job.text.length.toLocaleString()} / 30,000 characters</p></div><aside className={styles.matchCard}><span className={styles.eyebrow}>Live relevance check</span><div className={styles.score}>{match.coverage}<small>%</small></div><h3>JD keyword coverage</h3><p>The share of recurring JD terms found verbatim in your master resume. It is not an ATS score or hiring probability.</p><div className={styles.termGroup}><strong>Matched</strong><div>{match.matched.length ? match.matched.map((term) => <span className={styles.match} key={term}>{term}</span>) : <em>No recurring terms matched yet.</em>}</div></div><div className={styles.termGroup}><strong>Missing or differently worded</strong><div>{match.missing.length ? match.missing.map((term) => <span className={styles.missing} key={term}>{term}</span>) : <em>Paste a JD to compare.</em>}</div></div></aside></div>
        {tailoring.error && <Status type="error">{tailoring.error}</Status>}
        <div className={styles.generateBar}><div><strong>Your master stays untouched.</strong><span>A separate, editable version will be created.</span></div><button className={styles.primary} disabled={tailoring.status === 'loading' || job.text.trim().length < 80} onClick={generate}>{tailoring.status === 'loading' ? <><span className={styles.spinner} /> Tailoring…</> : 'Generate tailored resume ✦'}</button></div>
      </section>}

      {stage === 3 && tailoring.current && <section className={styles.stage}>
        <div className={styles.stageIntro}><div><span className={styles.stageNumber}>03</span><h2>Review, refine, apply</h2><p>Every generated line remains editable. Compare it with the source before exporting.</p></div><div className={styles.reviewActions}><button className={styles.secondary} onClick={() => setStage(2)}>← Edit JD</button><button className={styles.secondary} onClick={generate}>Regenerate</button><button className={styles.secondary} onClick={saveVersion}>Save version</button><button className={styles.primary} onClick={() => downloadResumePdf(tailoring.current.resume, `${job.company || 'tailored'}-${job.jobTitle || 'resume'}.pdf`)}>Download PDF ↓</button></div></div>
        <div className={styles.insights}><div><h3>What changed</h3><ul>{tailoring.current.changeSummary.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>Missing requirements</h3>{tailoring.current.missingRequirements.length ? <ul>{tailoring.current.missingRequirements.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No explicit missing requirements were flagged.</p>}</div><div><h3>Match snapshot</h3><p><strong>{match.coverage}%</strong> JD keyword coverage</p><p>{match.matched.length} matched · {match.missing.length} missing/different</p></div></div>
        <details className={styles.comparison}><summary>Compare original master with tailored version</summary><div><div><h4>Master summary</h4><p>{resume.masterResume?.summary || 'No master summary.'}</p></div><div><h4>Tailored summary</h4><p>{tailoring.current.resume.summary || 'No tailored summary.'}</p></div></div></details>
        <div className={styles.editorToolbar}><div><h3>Edit tailored version</h3><p>Changes here never modify the master.</p></div>{viewToggle}</div><div className={`${styles.workspace} ${styles[mobileView]}`}><div className={styles.editorPane}><ResumeEditor resume={tailoring.current.resume} onChange={(value) => dispatch(tailoringActions.updateTailoredResume(value))} /></div><div className={styles.previewPane}><div className={styles.previewLabel}>Tailored A4 preview</div><ResumePreview resume={tailoring.current.resume} label="Tailored resume preview" /></div></div>
        {tailoring.versions.length > 0 && <section className={styles.versions}><h3>Saved versions</h3>{tailoring.versions.map((version) => <button key={version.id} onClick={() => dispatch(tailoringActions.loadVersion(version))}><strong>{version.jobTitle || 'Untitled role'} · {version.company || 'Unknown company'}</strong><span>{new Date(version.createdAt).toLocaleString()}</span></button>)}</section>}
      </section>}
    </main>
    <footer><span>Reum · personal resume workspace</span><span>Your data is stored locally in this browser.</span></footer>
  </div>;
}
