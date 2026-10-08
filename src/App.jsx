import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import ResumeEditor from './components/ResumeEditor';
import ResumePreview from './components/ResumePreview';
import ChangeAudit from './components/ChangeAudit';
import { resumeActions } from './features/resume/resumeSlice';
import { jobActions } from './features/jobDescription/jobSlice';
import { tailoringActions } from './features/tailoring/tailoringSlice';
import { extractResumeText } from './services/fileExtraction';
import { analyzeAtsWithAI, parseResumeWithAI, tailorResumeWithAI } from './services/aiService';
import { parseResumeLocally } from './services/localResumeParser';
import { analyzeMatch } from './services/matchingService';
import { tailoredResultSchema, validateResume } from './services/resumeValidation';
import { downloadResumePdf } from './services/pdfService';
import { exportBackup, importBackup, STORAGE_KEY } from './services/storageService';
import styles from './App.module.css';

const editorSections = [['personal', 'Personal info'], ['skills', 'Skills'], ['experience', 'Experience'], ['projects', 'Projects'], ['education', 'Education'], ['more', 'Certs & more']];

function Status({ type = 'info', children }) { return children ? <div className={`${styles.status} ${styles[type]}`} role={type === 'error' ? 'alert' : 'status'}>{children}</div> : null; }

function NavIcon({ name }) {
  if (name === 'resume') return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 2.75h7l4 4v14.5h-11z" /><path d="M13.5 2.75v4h4M9.5 11h5M9.5 15h5M9.5 18h3" /></svg>;
  if (name === 'tailor') return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m4.25 19.75 10.9-10.9 3 3-10.9 10.9zM13.65 10.35l3 3" /><path d="M18.5 2.5v4M16.5 4.5h4M7 3v3M5.5 4.5h3" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.2 8.2A8.5 8.5 0 1 1 3.5 12" /><path d="M3.5 4.5v4h4M12 7.5V12l3 1.8" /></svg>;
}

export default function App({ recovered = false }) {
  const dispatch = useDispatch();
  const { resume, job, tailoring } = useSelector((state) => state);
  const [stage, setStage] = useState(1);
  const [atsChecked, setAtsChecked] = useState(false);
  const [atsLoading, setAtsLoading] = useState(false);
  const [atsError, setAtsError] = useState('');
  const [aiAtsReview, setAiAtsReview] = useState(null);
  const [selectedAtsResumeId, setSelectedAtsResumeId] = useState(resume.masterResume?.id || '');
  const [mobileView, setMobileView] = useState('editor');
  const [editorSection, setEditorSection] = useState('personal');
  const editorSectionIndex = Math.max(0, editorSections.findIndex(([id]) => id === editorSection));
  const previewRef = useRef(null);
  const [notice, setNotice] = useState(recovered ? 'Invalid saved data was moved to a recovery key and a clean workspace was opened.' : '');
  const fileRef = useRef(); const backupRef = useRef();
  const atsResumeOptions = [...resume.resumeLibrary];
  if (resume.masterResume && !atsResumeOptions.some((entry) => entry.resume.id === resume.masterResume.id)) atsResumeOptions.unshift({ resume: resume.masterResume, sourceName: 'Master resume', isMaster: true });
  const atsResume = atsResumeOptions.find((entry) => entry.resume.id === selectedAtsResumeId)?.resume || resume.masterResume || resume.workingResume;
  const match = useMemo(() => analyzeMatch(atsResume, job.text), [atsResume, job.text]);
  const activePreviewSectionCount = editorSection === 'skills' ? resume.workingResume.skillGroups.length : editorSection === 'experience' ? resume.workingResume.experience.length : editorSection === 'projects' ? resume.workingResume.projects.length : editorSection === 'education' ? resume.workingResume.education.length : editorSection === 'more' ? resume.workingResume.certifications.length : 1;

  useEffect(() => {
    if (stage !== 2 || (window.matchMedia?.('(max-width: 620px)')?.matches && mobileView === 'editor')) return;
    const pane = previewRef.current;
    const target = pane?.querySelector(`[data-preview-section="${editorSection}"]`);
    if (!pane || !target) return;
    const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 24;
    pane.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [activePreviewSectionCount, editorSection, mobileView, stage]);

  const parseText = async (text, sourceName = 'Pasted text') => {
    dispatch(tailoringActions.clearCurrent());
    dispatch(resumeActions.setUploadStatus({ status: 'parsing', progress: 78, message: 'Structuring resume with AI…', error: '' }));
    let parsedResume;
    try {
      parsedResume = await parseResumeWithAI(text);
      dispatch(resumeActions.setWorkingResume(parsedResume));
      dispatch(resumeActions.setUploadStatus({ status: 'succeeded', progress: 100, message: 'Resume parsed. Review every field before saving the master.', error: '' }));
    } catch (error) {
      parsedResume = parseResumeLocally(text);
      dispatch(resumeActions.setWorkingResume(parsedResume));
      dispatch(resumeActions.setUploadStatus({ status: 'fallback', progress: 100, message: '', error: error.code === 'AI_NOT_CONFIGURED' ? 'AI is not configured. Basic on-device parsing was used; review and structure the result manually. Add GROQ_API_KEY on the server for semantic parsing and tailoring.' : `${error.message} Basic on-device parsing was used instead; your previous saved master was not changed.` }));
    }
    dispatch(resumeActions.setExtractedText(text)); dispatch(resumeActions.setSourceName(sourceName));
    dispatch(resumeActions.upsertResumeLibrary({ resume: parsedResume, sourceName, updatedAt: new Date().toISOString(), isMaster: false }));
    setStage(2); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFile = async (file) => {
    if (!file) return;
    dispatch(resumeActions.setUploadStatus({ status: 'extracting', progress: 5, message: 'Reading file…', error: '' }));
    try {
      const extracted = await extractResumeText(file, ({ stage: next, percent }) => dispatch(resumeActions.setUploadStatus({ status: next, progress: percent, message: next === 'ocr' ? 'Reading scanned resume with OCR…' : 'Extracting resume text…', error: '' })));
      await parseText(extracted.text, file.name);
      if (extracted.warnings.length) setNotice(extracted.warnings.join(' '));
    } catch (error) {
      dispatch(resumeActions.setUploadStatus({ status: 'error', progress: 0, message: '', error: error.message }));
    }
  };

  const saveMaster = () => {
    const result = validateResume(resume.workingResume);
    if (!result.success) return dispatch(resumeActions.setUploadStatus({ status: 'error', error: 'Correct the invalid fields before saving the master resume.' }));
    dispatch(resumeActions.confirmMaster());
    dispatch(resumeActions.upsertResumeLibrary({ resume: result.data, sourceName: resume.sourceName, updatedAt: new Date().toISOString(), isMaster: true }));
    setSelectedAtsResumeId(result.data.id);
    dispatch(tailoringActions.clearCurrent());
    setAtsChecked(false);
    setAiAtsReview(null); setAtsError('');
    setNotice('Resume saved. Add a job description to check the ATS match.'); setStage(3); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const generate = async () => {
    if (!atsChecked) return setNotice('Check the ATS match before tailoring your resume.');
    if (!atsResume) return setNotice('Choose a saved resume first.');
    if (job.text.trim().length < 80) return dispatch(tailoringActions.setTailoringStatus({ status: 'failed', error: 'Paste a fuller job description (at least 80 characters).' }));
    dispatch(tailoringActions.clearCurrent());
    dispatch(tailoringActions.setTailoringStatus({ status: 'loading', error: '' }));
    try {
      const candidate = await tailorResumeWithAI(atsResume, job.text, job.company, job.jobTitle);
      const validated = tailoredResultSchema.safeParse(candidate);
      if (!validated.success) throw new Error('The AI returned malformed resume data. Your master resume was not changed.');
      dispatch(tailoringActions.setTailoredResult(validated.data)); setStage(4); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) { dispatch(tailoringActions.setTailoringStatus({ status: 'failed', error: error.message })); }
  };

  const saveVersion = () => {
    if (!tailoring.current) return;
    dispatch(tailoringActions.saveVersion({ ...structuredClone(tailoring.current), id: crypto.randomUUID(), company: job.company, jobTitle: job.jobTitle, jobDescription: job.text, createdAt: new Date().toISOString() }));
    setNotice('Tailored version saved locally.');
  };

  const addMissingRequirement = (requirement) => {
    const skill = window.prompt('Confirm that you have this skill, then edit the wording if needed before adding it to the resume:', requirement);
    if (!skill?.trim()) return;
    dispatch(tailoringActions.confirmMissingRequirement({ requirement, skill: skill.trim() }));
    setNotice(`Added “${skill.trim()}” to the tailored resume skills. Your master resume was not changed.`);
  };

  const stateForBackup = useSelector((state) => ({ masterResume: state.resume.masterResume, workingResume: state.resume.workingResume, resumeLibrary: state.resume.resumeLibrary, sourceName: state.resume.sourceName, job: state.job, current: state.tailoring.current, versions: state.tailoring.versions }));
  const restoreBackup = async (file) => {
    try { const data = await importBackup(file); dispatch(resumeActions.hydrateResume({ masterResume: data.masterResume, workingResume: data.workingResume, resumeLibrary: data.resumeLibrary || (data.masterResume ? [{ resume: data.masterResume, sourceName: data.sourceName || '', updatedAt: '', isMaster: true }] : []), workingSaved: false, sourceName: data.sourceName })); dispatch(jobActions.hydrateJob(data.job || {})); dispatch(tailoringActions.hydrateTailoring({ current: data.current, versions: data.versions })); setSelectedAtsResumeId(data.masterResume?.id || ''); setAtsChecked(false); setAiAtsReview(null); setAtsError(''); setNotice('Backup imported.'); }
    catch (error) { setNotice(error.message); }
  };
  const clearAll = () => { if (!window.confirm('Clear the master resume, job description, and all saved versions from this browser?')) return; localStorage.removeItem(STORAGE_KEY); dispatch(resumeActions.clearResume()); dispatch(jobActions.clearJob()); dispatch(tailoringActions.clearTailoring()); setSelectedAtsResumeId(''); setAtsChecked(false); setAiAtsReview(null); setAtsError(''); setStage(1); setNotice('Saved data cleared.'); };

  const selectResume = (entry) => { dispatch(resumeActions.loadResumeFromLibrary(entry)); dispatch(tailoringActions.clearCurrent()); setAtsChecked(false); setAiAtsReview(null); setAtsError(''); setStage(2); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const updateJob = (changes) => { dispatch(jobActions.updateJob(changes)); dispatch(tailoringActions.clearCurrent()); setAtsChecked(false); setAiAtsReview(null); setAtsError(''); };
  const runAtsCheck = async () => {
    if (!atsResume || job.text.trim().length < 80) return;
    setAtsLoading(true); setAtsChecked(false); setAtsError(''); setAiAtsReview(null); dispatch(tailoringActions.clearCurrent());
    try {
      const review = await analyzeAtsWithAI(atsResume, job.text);
      setAiAtsReview(review); setAtsChecked(true);
    } catch (error) {
      setAtsError(error.message || 'The AI ATS review could not be completed. Please try again.');
    } finally { setAtsLoading(false); }
  };

  const viewToggle = <div className={styles.viewToggle} aria-label="Choose mobile view"><button className={mobileView === 'editor' ? styles.active : ''} onClick={() => setMobileView('editor')}>Editor</button><button className={mobileView === 'preview' ? styles.active : ''} onClick={() => setMobileView('preview')}>Preview</button></div>;
  const exportTailoredResume = () => tailoring.current && downloadResumePdf(tailoring.current.resume, `${job.company || 'tailored'}-${job.jobTitle || 'resume'}.pdf`);

  return <div className={styles.app}>
    <aside className={styles.sidebar}>
      <div className={styles.siteWrapper}>
      <a className={styles.brand} href="#top" aria-label="doitnext.ai home">
        <strong>doitnext<span>.ai</span></strong>
      </a>
      <nav className={styles.sideNav} aria-label="Primary navigation">
        <button className={stage === 1 ? styles.sideActive : ''} onClick={() => setStage(1)}><NavIcon name="resume" />My resumes</button>
        <button className={stage === 2 ? styles.sideActive : ''} disabled={!resume.workingResume?.name && !resume.sourceName} onClick={() => setStage(2)}><NavIcon name="tailor" />Edit resume</button>
        <button className={stage === 3 ? styles.sideActive : ''} disabled={!resume.workingSaved} onClick={() => setStage(3)}><NavIcon name="history" />Check ATS</button>
        <button className={stage === 4 ? styles.sideActive : ''} disabled={!resume.workingSaved || !atsChecked} onClick={() => setStage(4)}><NavIcon name="tailor" />Tailor & review{tailoring.versions.length > 0 && <em>{tailoring.versions.length}</em>}</button>
      </nav>
      <div className={styles.sidebarTools}>
        <button onClick={() => exportBackup(stateForBackup)}>Backup data</button>
        <button onClick={() => backupRef.current?.click()}>Import backup</button>
        <button className={styles.dangerLink} onClick={clearAll}>Clear workspace</button>
        <input ref={backupRef} hidden type="file" accept="application/json,.json" onChange={(e) => restoreBackup(e.target.files[0])} />
      </div>
      <div className={styles.account}><span>A</span><div><strong>My workspace</strong><small>Stored locally</small></div></div>
      </div>
    </aside>
    <div className={styles.appShell}>
      <main id="top">
      {notice && <Status>{notice}<button className={styles.dismiss} onClick={() => setNotice('')} aria-label="Dismiss">×</button></Status>}

      {stage === 1 && <section className={styles.stage}>
        <div className={styles.stageIntro}><div><span className={styles.stageNumber}>STEP 1 · RESUME LIBRARY</span><h2>Upload and manage your resumes</h2><p>Choose an existing resume or add another one to your library.</p></div><span className={styles.filePill}>{resume.resumeLibrary.length} {resume.resumeLibrary.length === 1 ? 'resume' : 'resumes'}</span></div>
        <div className={styles.intakeGrid}>
          <div className={styles.uploadBox} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}><div className={styles.uploadIcon}>↥</div><div className={styles.uploadCopy}><h3>Upload existing resume</h3><p>PDF, DOCX, TXT, or image · up to 10 MB</p></div><button className={styles.primary} onClick={() => fileRef.current?.click()}>Choose file</button><input hidden ref={fileRef} type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/png,image/jpeg,image/webp" onChange={(e) => handleFile(e.target.files[0])} /></div>
          <details className={styles.pasteFallback}><summary>Paste resume text</summary><textarea rows="5" value={resume.extractedText} onChange={(e) => dispatch(resumeActions.setExtractedText(e.target.value))} placeholder="Paste all resume text here…" /><button className={styles.secondary} disabled={resume.extractedText.trim().length < 40} onClick={() => parseText(resume.extractedText)}>Parse pasted text</button></details>
        </div>
        {(resume.upload.status !== 'idle') && <div className={styles.progressWrap}><div className={styles.progressLabel}><span>{resume.upload.message || (resume.upload.status === 'error' ? 'Could not process file' : 'Ready to review')}</span><strong>{resume.upload.progress}%</strong></div><div className={styles.progress}><span style={{ width: `${resume.upload.progress}%` }} /></div>{resume.upload.error && <Status type="error">{resume.upload.error} {resume.extractedText && <button className={styles.inlineButton} onClick={() => parseText(resume.extractedText, resume.sourceName)}>Retry AI parsing</button>}</Status>}</div>}
        {resume.workingResume?.name && <button type="button" className={styles.continueResume} onClick={() => setStage(2)}><span><strong>Continue editing</strong><small>{resume.workingResume.name}{resume.sourceName ? ` · ${resume.sourceName}` : ''}</small></span><span>Open editor →</span></button>}
        <section className={styles.librarySection}><div className={styles.libraryHeading}><div><h3>All resumes</h3><p>Stored in this browser. Select one to review and edit.</p></div></div>{resume.resumeLibrary.length ? <div className={styles.resumeLibraryGrid}>{resume.resumeLibrary.map((entry) => <button type="button" className={styles.resumeLibraryCard} key={entry.resume.id} onClick={() => entry.resume.id === resume.workingResume?.id && !resume.workingSaved ? setStage(2) : selectResume(entry)}><span className={styles.resumeFileIcon}>PDF</span><span className={styles.resumeCardCopy}><strong>{entry.resume.name || 'Untitled resume'}</strong><small>{entry.resume.title || entry.sourceName || 'Resume'}{entry.isMaster ? ' · Current master' : ''}</small><small>{entry.sourceName || 'Pasted resume'}{entry.updatedAt ? ` · ${new Date(entry.updatedAt).toLocaleDateString()}` : ''}</small></span><span className={styles.resumeCardAction}>Review →</span></button>)}</div> : <div className={styles.emptyLibrary}>No resumes yet. Upload a file or paste resume text to get started.</div>}</section>
      </section>}

      {stage === 2 && <section className={styles.stage}>
        <div className={styles.resumeWorkspaceHeader}><div><span className={styles.eyebrow}>Editing resume</span><h2>{resume.workingResume.name || resume.sourceName || 'Untitled resume'}</h2></div><div className={styles.resumeHeaderActions}><span className={styles.liveBadge}>Live preview</span>{viewToggle}</div></div>
        <div className={`${styles.workspace} ${styles[mobileView]}`}><div className={styles.editorPane}><nav className={styles.editorSectionNav} aria-label="Resume sections">{editorSections.map(([id, label], index) => <button type="button" key={id} className={editorSection === id ? styles.editorSectionActive : ''} onClick={() => setEditorSection(id)}><span>{index + 1}</span>{label}</button>)}</nav><ResumeEditor resume={resume.workingResume} activeSection={editorSection} onChange={(value) => { setAtsChecked(false); dispatch(resumeActions.setWorkingResume(value)); }} />{resume.workingResume.ambiguities.length > 0 && <Status type="warning"><strong>Review needed:</strong> {resume.workingResume.ambiguities.join(' ')}</Status>}<div className={styles.sectionPager}><button className={styles.secondary} onClick={() => editorSectionIndex === 0 ? setStage(1) : setEditorSection(editorSections[editorSectionIndex - 1][0])}>{editorSectionIndex === 0 ? '← Back to resumes' : '← Previous'}</button><span>{editorSectionIndex + 1} of {editorSections.length} · {editorSections[editorSectionIndex][1]}</span>{editorSectionIndex < editorSections.length - 1 ? <button className={styles.primary} onClick={() => setEditorSection(editorSections[editorSectionIndex + 1][0])}>Next: {editorSections[editorSectionIndex + 1][1]} →</button> : <button className={styles.primary} onClick={saveMaster}>Save and check ATS →</button>}</div></div><div className={styles.previewPane} ref={previewRef}><div className={styles.previewLabel}>Resume preview · A4</div><ResumePreview resume={resume.workingResume} activeSection={editorSection} /></div></div>
      </section>}

      {stage === 3 && <section className={styles.stage}>
        <div className={styles.stageIntro}><div><span className={styles.stageNumber}>STEP 3 · JOB MATCH</span><h2>Check your ATS score</h2><p>Choose a resume, paste the job description, and see which keywords match or need attention.</p></div><span className={styles.filePill}>Your resume stays unchanged</span></div>
        <div className={styles.jobGrid}>
          <div className={styles.jobForm}>
            <span className={styles.formLabel}>Resume to check</span>
            <div className={styles.resumePicker} role="group" aria-label="Choose a resume to check">{atsResumeOptions.map((entry) => { const selected = entry.resume.id === (atsResume?.id || selectedAtsResumeId); return <button type="button" key={entry.resume.id} aria-pressed={selected} className={`${styles.resumeChoice} ${selected ? styles.resumeChoiceActive : ''}`} onClick={() => { setSelectedAtsResumeId(entry.resume.id); setAtsChecked(false); dispatch(tailoringActions.clearCurrent()); }}><span>▤</span>{entry.isMaster ? 'Master resume' : entry.resume.title || entry.resume.name || entry.sourceName || 'Resume'}</button>; })}</div>
            <label>Job description<textarea rows="18" value={job.text} onChange={(e) => updateJob({ text: e.target.value })} placeholder="Paste the complete job description here…" /></label>
            <p className={styles.charCount}>{job.text.length.toLocaleString()} / 30,000 characters</p>
            <small className={styles.inputHint}>Paste the complete posting. Exact keywords matter for ATS matching.</small>
            {job.text.trim().length > 0 && <button className={styles.primary} disabled={job.text.trim().length < 80 || atsLoading} onClick={runAtsCheck}>{atsLoading ? <><span className={styles.spinner} /> Checking ATS Score…</> : <><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 16a8 8 0 1 1 16 0" /><path d="m12 15 4-5" /><circle cx="12" cy="15" r="1" /></svg>Check ATS Score</>}</button>}
            {job.text.trim().length > 0 && job.text.trim().length < 80 && <small className={styles.inputHint}>Add a little more detail to run the check (80 characters minimum).</small>}
            {atsError && <Status type="error">{atsError}</Status>}
          </div>
          <div className={styles.atsReportColumn}>
          <aside className={styles.matchCard}>
            {!atsChecked && !atsLoading ? <div className={styles.atsEmpty}>
              <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path d="M10 43a22 22 0 0 1 44 0" /><path d="m32 40 10-13" /><circle cx="32" cy="40" r="2.5" /></svg>
              <h3>Your ATS score will appear here</h3>
              <p>Choose a resume, paste a job description, and run the check to see your match and missing keywords.</p>
            </div> : <>
            <div className={styles.reportTitle}><span className={styles.eyebrow}>AI ATS REVIEW</span><small>{atsResume.name || atsResume.title || 'Selected resume'}</small></div>
            <div className={styles.score}>{atsLoading ? <span className={styles.scoreLoading}>···</span> : atsChecked ? aiAtsReview.score : '—'}<small>/100</small></div>
            <h3>ATS match score</h3>
            <p>{atsChecked ? aiAtsReview.summary : 'AI review of keyword alignment, experience evidence, and ATS readability.'}</p>
            <div className={styles.scoreBreakdown}><div><span>JD keyword match</span><strong>{atsChecked && match.keywords.length > 0 ? `${match.coverage}%` : '—'}</strong></div><div><span>Assessment</span><strong>AI estimate</strong></div></div>
            <div className={styles.keywordColumns}>
              <div className={styles.termGroup}><strong>Matched keywords</strong><div>{atsChecked ? match.matched.slice(0, 5).map((term) => <span className={styles.match} key={term}>{term}</span>) : <em>—</em>}</div></div>
              <div className={styles.termGroup}><strong>Missing keywords</strong><div>{atsChecked ? match.missing.slice(0, 5).map((term) => <span className={styles.missing} key={term}>{term}</span>) : <em>—</em>}</div></div>
            </div>
            <small className={styles.scoreNote}>AI estimate for guidance—not an employer ATS score or a hiring prediction.</small>
            </>}
          </aside>
          {atsChecked && <div className={`${styles.generateBar} ${styles.atsTailorBar}`}><div><strong>{match.missing.length ? 'Want a higher score?' : 'Make this resume job ready'}</strong><span>{aiAtsReview.nextSteps?.[0] || 'Tailor a copy using your existing experience.'}</span></div><button className={styles.primary} onClick={() => { dispatch(tailoringActions.clearCurrent()); setStage(4); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Tailor for this job →</button></div>}
          </div>
        </div>
        {tailoring.error && <Status type="error">{tailoring.error}</Status>}
      </section>}

      {stage === 4 && !tailoring.current && <section className={`${styles.stage} ${styles.tailorStage}`}>
        <div className={styles.stageIntro}><div><span className={styles.stageNumber}>STEP 4 · TAILOR</span><h2>Shape your resume for this job</h2><p>Review the match and your base resume before creating a tailored copy.</p></div><span className={styles.filePill}>Base resume stays unchanged</span></div>
        <div className={styles.tailorWorkspace}>
          <div className={styles.tailorControls}>
            <div className={styles.tailorSource}><div><span className={styles.eyebrow}>JOB DESCRIPTION</span><strong>{job.jobTitle || 'Job description ready'}</strong><small>{job.text.length.toLocaleString()} characters provided</small></div><button type="button" className={styles.textAction} onClick={() => { setStage(3); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit job →</button></div>
            <section className={styles.tailorMatchPanel}>
              <div className={styles.tailorMatchHeading}><div><span className={styles.eyebrow}>BEFORE TAILORING</span><h3>Your match at a glance</h3></div><span className={styles.tailorScore}>{aiAtsReview?.score ?? '—'}<small>/100</small></span></div>
              <div className={styles.tailorScoreTrack} role="meter" aria-label="AI ATS estimate" aria-valuemin="0" aria-valuemax="100" aria-valuenow={aiAtsReview?.score ?? 0}><span style={{ width: `${aiAtsReview?.score ?? 0}%` }} /></div>
              <p className={styles.tailorSummary}>{aiAtsReview?.summary || 'Review the job match before tailoring.'}</p>
              <div className={styles.tailorTerms}><h4>Already represented <span>{match.matched.length}</span></h4><div>{match.matched.length ? match.matched.map((term) => <span className={styles.match} key={term}>{term}</span>) : <small>No exact keyword matches found.</small>}</div></div>
              <div className={styles.tailorTerms}><h4>Needs attention <span>{match.missing.length}</span></h4><div>{match.missing.length ? match.missing.map((term) => <span className={styles.missing} key={term}>{term}</span>) : <small>No missing keywords found.</small>}</div></div>
              <p className={styles.tailorGuidance}>We’ll emphasize relevant experience already in your resume. Missing qualifications won’t be invented.</p>
              <button type="button" className={`${styles.primary} ${styles.tailorGenerate}`} disabled={tailoring.status === 'loading'} onClick={generate}>{tailoring.status === 'loading' ? <><span className={styles.spinner} /> Creating tailored resume…</> : 'Create tailored resume →'}</button>
              {tailoring.error && <Status type="error">{tailoring.error}</Status>}
            </section>
          </div>
          <aside className={`${styles.previewPane} ${styles.tailorPreview}`}><div className={styles.previewHeader}><div><h3>Base resume preview</h3><span>This version will not be changed.</span></div></div><ResumePreview resume={atsResume} label="Base resume preview" /></aside>
        </div>
      </section>}

      {stage === 4 && tailoring.current && <section className={`${styles.stage} ${styles.reviewStage}`}>
        <div className={styles.finalActions}><button className={styles.secondary} onClick={saveVersion}>Save draft</button><button className={styles.primary} onClick={exportTailoredResume}>Export PDF</button></div>
        <div className={styles.mobileReviewToggle}>{viewToggle}</div>
        <div className={`${styles.reviewGrid} ${styles[mobileView]}`}>
          <div className={styles.reviewColumn}>
            <section className={styles.roleCard}><div className={styles.roleIcon}>▦</div><div><h2>{job.jobTitle || 'Target role'}</h2><p>{job.company || 'Job-specific version'}<span>•</span>{atsResume.name || 'Selected resume'}</p><small>● Job description added</small></div><button className={styles.textAction} onClick={() => setStage(2)}>✎ Edit</button></section>
            <div className={styles.metricGrid}><div><span className={styles.metricIcon}>☷</span><p>Matched skills<strong>{match.matched.length} / {Math.max(match.keywords.length, match.matched.length)}</strong></p></div><div><span className={`${styles.metricIcon} ${styles.amber}`}>☆</span><p>Missing terms<strong>{match.missing.length}</strong></p></div><div><span className={`${styles.metricIcon} ${styles.green}`}>▤</span><p>AI ATS estimate<strong>{atsChecked ? `${aiAtsReview.score}%` : '—'}</strong></p></div></div>
            <section className={styles.insightPanel}><div className={styles.panelHeading}><div><h3>Job match insights</h3><p>Review what matches and what still needs attention.</p></div><span>{match.coverage}% match</span></div><div className={styles.matchRows}>{match.matched.slice(0, 5).map((term) => <div key={term}><span className={styles.check}>✓</span><p><strong>{term}</strong><small>Found in the selected resume.</small></p><em>In resume</em></div>)}</div>{tailoring.current.missingRequirements.length > 0 && <div className={styles.reviewWarning}>! &nbsp; {tailoring.current.missingRequirements.length} requirements need your review</div>}</section>
            <div className={styles.insights}><div><h3>What changed</h3><ul>{tailoring.current.changeSummary.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>Missing requirements</h3>{tailoring.current.missingRequirements.length ? <><p className={styles.requirementHelp}>Only confirm requirements you genuinely have.</p><ul className={styles.requirementList}>{tailoring.current.missingRequirements.map((item, index) => <li key={`${item}-${index}`}><span>{item}</span><button type="button" onClick={() => addMissingRequirement(item)}>I have this · add</button></li>)}</ul></> : <p>No explicit missing requirements were flagged.</p>}</div></div>
            <ChangeAudit master={atsResume} tailored={tailoring.current.resume} jdKeywords={match.keywords} />
            <details className={styles.editorDetails}><summary><span>Edit tailored resume</span><small>Changes here never modify the master.</small></summary><div className={styles.editorPane}><ResumeEditor resume={tailoring.current.resume} onChange={(value) => dispatch(tailoringActions.updateTailoredResume(value))} /></div></details>
            {tailoring.versions.length > 0 && <section className={styles.versions}><h3>Saved versions</h3>{tailoring.versions.map((version) => <button key={version.id} onClick={() => { dispatch(tailoringActions.loadVersion(version)); dispatch(jobActions.hydrateJob({ company: version.company || '', jobTitle: version.jobTitle || '', text: version.jobDescription || '' })); }}><strong>{version.jobTitle || 'Untitled role'} · {version.company || 'Unknown company'}</strong><span>{new Date(version.createdAt).toLocaleString()}</span></button>)}</section>}
          </div>
          <aside className={styles.previewPane}><div className={styles.previewHeader}><div><h3>Live resume preview</h3><span>Master resume stays unchanged.</span></div><div><button>A4⌄</button><button>⌕ 100%⌄</button></div></div><ResumePreview resume={tailoring.current.resume} label="Tailored resume preview" /></aside>
        </div>
      </section>}
    </main>
    </div>
  </div>;
}
