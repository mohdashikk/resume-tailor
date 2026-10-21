import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import ResumeEditor from './components/ResumeEditor';
import ResumePreview from './components/ResumePreview';
import TailorOverview from './components/TailorOverview';
import { resumeActions } from './features/resume/resumeSlice';
import { jobActions } from './features/jobDescription/jobSlice';
import { tailoringActions } from './features/tailoring/tailoringSlice';
import { extractResumeText } from './services/fileExtraction';
import { analyzeAtsWithAI, parseResumeWithAI, tailorResumeWithAI } from './services/aiService';
import { analyzeAtsLocally } from './services/localAtsService';
import { parseResumeLocally } from './services/localResumeParser';
import { assertParsedResumeCoverage, prepareUploadedResume } from './services/resumeParsingService';
import { analysisKey, readCachedAnalysis, validateAnalysis, rescoreAnalysis } from './services/atsAnalysis';
import { isMeaningfulBulletRewrite } from './services/targetedTailoringService';
import { tailoredResultSchema, validateResume, formatResumeError } from './services/resumeValidation';
import { downloadResumePdf } from './services/pdfService';
import { exportBackup, importBackup, STORAGE_KEY } from './services/storageService';
import styles from './App.module.css';

const editorSections = [['personal', 'Personal info'], ['skills', 'Skills'], ['experience', 'Experience'], ['projects', 'Projects'], ['education', 'Education'], ['more', 'Certs & more']];

function Status({ type = 'info', children }) { return children ? <div className={`${styles.status} ${styles[type]}`} role={type === 'error' ? 'alert' : 'status'}>{children}</div> : null; }

function AiLoading({ title, message, steps = [] }) {
  return <div className={styles.aiLoading} role="status" aria-live="polite">
    <div className={styles.aiLoaderVisual} aria-hidden="true">
      <span className={styles.aiOrbitOne}><i /></span>
      <span className={styles.aiOrbitTwo}><i /></span>
      <span className={styles.aiCore}>✦</span>
      <span className={styles.aiScanLine} />
    </div>
    <div className={styles.aiLoadingCopy}><span className={styles.eyebrow}>LOCAL ATS CHECK</span><h3>{title}</h3><p>{message}</p></div>
    <div className={styles.aiLoadingSteps} aria-hidden="true">{steps.map((step, index) => <span key={step} style={{ '--delay': `${index * .22}s` }}><i />{step}</span>)}</div>
  </div>;
}

function TailoringProgress({ status = 'ready', sourceResume, tailoredResume, score }) {
  const sourceBullets = sourceResume?.experience.flatMap(entry => entry.bullets) || [];
  const listedSkills = tailoredResume?.skillGroups.flatMap(group => group.skills) || [];
  const skillsChanged = Boolean(tailoredResume && JSON.stringify(sourceResume?.skillGroups || []) !== JSON.stringify(tailoredResume.skillGroups));
  const revisedBullets = tailoredResume ? sourceBullets.filter(bullet => {
    const tailored = tailoredResume.experience.flatMap(entry => entry.bullets).find(item => item.id === bullet.id);
    return tailored && isMeaningfulBulletRewrite(bullet.text, tailored.text);
  }).length : 0;
  const steps = [
    { title: 'Rewrite Experience with AI', detail: status === 'complete' ? `${revisedBullets} of ${sourceBullets.length} experience bullets updated; source facts checked.` : 'Rephrase role bullets against the job description, keeping verified facts.' },
    { title: 'Review and align skills', detail: status === 'complete' ? `${listedSkills.length} listed skills reviewed${skillsChanged ? ' and reprioritized' : ''}; missing skills were not invented.` : 'Use only skills supported by the resume or explicitly confirmed.' },
    { title: 'Check the tailored ATS score', detail: status === 'complete' ? `Tailored resume scored ${score ?? '—'}/100 against this job.` : 'Calculate the score from the finished resume, after the edits.' },
  ];
  return <section className={styles.tailoringProgress} aria-label="Tailoring process" aria-live="polite">
    <div className={styles.tailoringProgressHeader}><span className={styles.eyebrow}>TAILORING PROCESS</span><strong>{status === 'working' ? 'Rewriting your resume…' : status === 'complete' ? 'Tailored copy ready to review' : 'Ready to tailor'}</strong></div>
    <ol>{steps.map((step, index) => <li key={step.title} className={status === 'complete' ? styles.processDone : status === 'working' && index === 0 ? styles.processActive : styles.processPending}>
      <span className={styles.processNumber}>{status === 'complete' ? '✓' : index + 1}</span><div><strong>{step.title}</strong><small>{step.detail}</small></div>
    </li>)}</ol>
    {status === 'working' && <p role="status">AI is working on the source-backed rewrite. The base resume remains visible and unchanged until the tailored copy is ready.</p>}
  </section>;
}

function NavIcon({ name }) {
  if (name === 'resume') return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 2.75h7l4 4v14.5h-11z" /><path d="M13.5 2.75v4h4M9.5 11h5M9.5 15h5M9.5 18h3" /></svg>;
  if (name === 'tailor') return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m4.25 19.75 10.9-10.9 3 3-10.9 10.9zM13.65 10.35l3 3" /><path d="M18.5 2.5v4M16.5 4.5h4M7 3v3M5.5 4.5h3" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.2 8.2A8.5 8.5 0 1 1 3.5 12" /><path d="M3.5 4.5v4h4M12 7.5V12l3 1.8" /></svg>;
}

export default function App({ recovered = false }) {
  const dispatch = useDispatch();
  const resume = useSelector((state) => state.resume);
  const job = useSelector((state) => state.job);
  const tailoring = useSelector((state) => state.tailoring);
  const [stage, setStage] = useState(() => tailoring.current ? 4 : 1);
  const [previewSource, setPreviewSource] = useState(false);
  const [retailoring, setRetailoring] = useState(false);
  const [retailorError, setRetailorError] = useState('');
  const [retryUntil, setRetryUntil] = useState(0);
  const [cooldownNow, setCooldownNow] = useState(Date.now());
  const currentTailoringKey = useRef('');
  currentTailoringKey.current = tailoring.current ? analysisKey(tailoring.current.resume, job.text) : '';
  const generationRequest = useRef(0);
  const [atsChecked, setAtsChecked] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [atsLoading, setAtsLoading] = useState(false);
  const [atsError, setAtsError] = useState('');
  const [aiAtsReview, setAiAtsReview] = useState(null);
  const [selectedAtsResumeId, setSelectedAtsResumeId] = useState(resume.masterResume?.id || '');
  const [mobileView, setMobileView] = useState(() => tailoring.current ? 'preview' : 'editor');
  const [editorSection, setEditorSection] = useState('personal');
  const savedParseMissingExperience = resume.upload.status === 'idle' && resume.sourceName && !resume.extractedText &&
    resume.workingResume?.experience?.length > 0 && resume.workingResume.experience.every((entry) => !entry.bullets?.length);
  const editorSectionIndex = Math.max(0, editorSections.findIndex(([id]) => id === editorSection));
  const previewRef = useRef(null);
  const [notice, setNotice] = useState(recovered ? 'Invalid saved data was moved to a recovery key and a clean workspace was opened.' : '');
  useEffect(() => {
    if (retryUntil <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setCooldownNow(current);
      if (current >= retryUntil) { clearInterval(timer); setRetryUntil(0); }
    }, 1000);
    return () => clearInterval(timer);
  }, [retryUntil]);
  const retrySecondsRemaining = Math.max(0, Math.ceil((retryUntil - cooldownNow) / 1000));
  const fileRef = useRef(); const backupRef = useRef();
  const uploadRequest = useRef(0);
  const atsResumeOptions = [...resume.resumeLibrary];
  if (resume.masterResume && !atsResumeOptions.some((entry) => entry.resume.id === resume.masterResume.id)) atsResumeOptions.unshift({ resume: resume.masterResume, sourceName: 'Master resume', isMaster: true });
  if (resume.workingResume?.name && !atsResumeOptions.some(entry => entry.resume.id === resume.workingResume.id)) atsResumeOptions.unshift({ resume: resume.workingResume, sourceName: resume.sourceName || 'Current resume' });
  for (const version of tailoring.versions) if (!atsResumeOptions.some(entry => entry.resume.id === version.resume.id)) atsResumeOptions.push({ resume: version.resume, sourceName: version.jobTitle || 'Tailored version' });
  const atsResume = selectedAtsResumeId === resume.workingResume?.id ? resume.workingResume : atsResumeOptions.find((entry) => entry.resume.id === selectedAtsResumeId)?.resume || resume.workingResume || resume.masterResume;
  const atsSourceName = atsResumeOptions.find(entry => entry.resume.id === atsResume?.id)?.sourceName || 'Current resume';
  let draftAnalysis = null;
  if (stage === 4 && tailoring.current?.sourceResume) {
    try { draftAnalysis = validateAnalysis(tailoring.current.analysis, tailoring.current.sourceResume, tailoring.current.jobDescription); } catch { /* Legacy drafts have no trustworthy analysis. */ }
  }
  const displayedAnalysis = stage === 4 && tailoring.current ? draftAnalysis : (aiAtsReview?.key === analysisKey(atsResume, job.text) ? aiAtsReview : null);
  let basePreviewAnalysis = displayedAnalysis;
  if (!basePreviewAnalysis && stage === 4 && !tailoring.current && atsResume && job.text.trim().length >= 80) {
    try { basePreviewAnalysis = analyzeAtsLocally(atsResume, job.text); } catch { /* Keep the preview available when the posting is incomplete. */ }
  }
  let match = (stage === 4 && !tailoring.current ? basePreviewAnalysis : displayedAnalysis)?.match || { keywords: [], matched: [], missing: [], uncertain: [], coverage: null };
  const activeAnalysisKey = analysisKey(atsResume, job.text);
  const requestKey = useRef(activeAnalysisKey);
  const atsRequest = useRef(0);
  requestKey.current = activeAnalysisKey;
  useEffect(() => {
    const cached = readCachedAnalysis(atsResume, job.text);
    setAiAtsReview(cached); setAtsChecked(Boolean(cached));
    setSelectedKeywords([]);
  }, [activeAnalysisKey]);
  let tailoredMatch = null;
  if (tailoring.current && (draftAnalysis || job.text.trim().length >= 80)) {
    try { tailoredMatch = draftAnalysis ? rescoreAnalysis(draftAnalysis, tailoring.current.resume, job.text) : analyzeAtsLocally(tailoring.current.resume, job.text); } catch { /* Older drafts may lack sufficient posting text. */ }
  }
  if (stage === 4 && tailoredMatch) match = tailoredMatch.match;
  const openDraft = (draft) => {
    generationRequest.current += 1;
    setPreviewSource(false);
    setMobileView('preview');
    dispatch(tailoringActions.loadVersion(draft));
    dispatch(jobActions.hydrateJob({ company: draft.company || '', jobTitle: draft.jobTitle || '', text: draft.jobDescription || '' }));
    setStage(4);
  };
  const activePreviewSectionCount = editorSection === 'skills' ? resume.workingResume.skillGroups.length : editorSection === 'experience' ? resume.workingResume.experience.length : editorSection === 'projects' ? resume.workingResume.projects.length : editorSection === 'education' ? resume.workingResume.education.length : editorSection === 'more' ? resume.workingResume.certifications.length : 1;

  useEffect(() => {
    if (stage !== 2 || (window.matchMedia?.('(max-width: 620px)')?.matches && mobileView === 'editor')) return;
    const pane = previewRef.current;
    const target = pane?.querySelector(`[data-preview-section="${editorSection}"]`);
    if (!pane || !target) return;
    const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 24;
    pane.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [activePreviewSectionCount, editorSection, mobileView, stage]);

  useEffect(() => {
    if (stage !== 4 || !tailoring.current || mobileView !== 'preview') return;
    const frame = requestAnimationFrame(() => {
      previewRef.current?.querySelector('[data-preview-section="experience"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [stage, mobileView, tailoring.current?.resume.id]);

  useEffect(() => {
    if (stage !== 4 || tailoring.current || tailoring.status !== 'loading') return;
    const frame = requestAnimationFrame(() => {
      const pane = previewRef.current;
      const section = pane?.querySelector('[data-preview-section="experience"]');
      if (pane && section) pane.scrollTop = Math.max(0, section.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 24);
    });
    return () => cancelAnimationFrame(frame);
  }, [stage, tailoring.current, tailoring.status]);

  const parseText = async (text, sourceName = 'Pasted text', request = ++uploadRequest.current) => {
    atsRequest.current += 1; generationRequest.current += 1;
    setAtsLoading(false); setAtsChecked(false); setAiAtsReview(null); setAtsError('');
    dispatch(tailoringActions.clearCurrent());
    dispatch(resumeActions.setExtractedText(text)); dispatch(resumeActions.setSourceName(sourceName));
    dispatch(resumeActions.setUploadStatus({ status: 'parsing', progress: 78, message: 'Reading resume sections…', error: '' }));
    let parsedResume;
    try {
      parsedResume = assertParsedResumeCoverage(prepareUploadedResume(await parseResumeWithAI(text)), text);
      if (request !== uploadRequest.current) return;
      dispatch(resumeActions.setWorkingResume(parsedResume));
      const bulletCount = parsedResume.experience.reduce((total, entry) => total + entry.bullets.length, 0);
      const localFallback = parsedResume.ambiguities.some((warning) => /Automatic layout clarification was unavailable|AI omitted source experience/.test(warning));
      dispatch(resumeActions.setUploadStatus({ status: localFallback ? 'fallback' : 'succeeded', progress: 100, message: `Parsed ${parsedResume.experience.length} jobs, ${bulletCount} experience bullets, and ${parsedResume.education.length} education entries. Review against the upload before saving.`, error: localFallback ? 'AI parsing was unavailable or incomplete. On-device parsing was used; compare every field with the extracted text before saving.' : '' }));
    } catch (error) {
      if (request !== uploadRequest.current) return;
      try {
        parsedResume = assertParsedResumeCoverage(prepareUploadedResume(parseResumeLocally(text)), text);
      } catch (fallbackError) {
        dispatch(resumeActions.setUploadStatus({ status: 'error', progress: 0, message: '', error: formatResumeError(fallbackError) }));
        return;
      }
      dispatch(resumeActions.setWorkingResume(parsedResume));
      const bulletCount = parsedResume.experience.reduce((total, entry) => total + entry.bullets.length, 0);
      dispatch(resumeActions.setUploadStatus({ status: 'fallback', progress: 100, message: `Parsed ${parsedResume.experience.length} jobs, ${bulletCount} experience bullets, and ${parsedResume.education.length} education entries.`, error: error.code === 'AI_NOT_CONFIGURED' ? 'AI is not configured. Basic on-device parsing was used; review and structure the result manually. Add GROQ_API_KEY on the server for semantic parsing and tailoring.' : `${formatResumeError(error)} Basic on-device parsing was used instead; your previous saved master was not changed.` }));
    }
    dispatch(resumeActions.setExtractedText(text)); dispatch(resumeActions.setSourceName(sourceName));
    dispatch(resumeActions.upsertResumeLibrary({ resume: parsedResume, sourceName, updatedAt: new Date().toISOString(), isMaster: false }));
    setSelectedAtsResumeId(parsedResume.id);
    setEditorSection('personal'); setMobileView('editor');
    setStage(2); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFile = async (file) => {
    if (!file) return;
    atsRequest.current += 1; generationRequest.current += 1;
    setAtsLoading(false); setAtsChecked(false); setAiAtsReview(null); setAtsError('');
    const request = ++uploadRequest.current;
    dispatch(resumeActions.setUploadStatus({ status: 'extracting', progress: 5, message: 'Reading file…', error: '' }));
    try {
      const extracted = await extractResumeText(file, ({ stage: next, percent }) => { if (request === uploadRequest.current) dispatch(resumeActions.setUploadStatus({ status: next, progress: percent, message: next === 'ocr' ? 'Reading scanned resume with OCR…' : 'Extracting resume text…', error: '' })); });
      if (request !== uploadRequest.current) return;
      await parseText(extracted.text, file.name, request);
      if (request !== uploadRequest.current) return;
      if (extracted.warnings.length) setNotice(extracted.warnings.join(' '));
    } catch (error) {
      if (request !== uploadRequest.current) return;
      dispatch(resumeActions.setUploadStatus({ status: 'error', progress: 0, message: '', error: formatResumeError(error) }));
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
    if (!atsResume) return setNotice('Choose a saved resume first.');
    if (job.text.trim().length < 80) return dispatch(tailoringActions.setTailoringStatus({ status: 'failed', error: 'Paste a fuller job description (at least 80 characters).' }));
    if (!atsChecked || !displayedAnalysis) return setAtsError('Check the ATS match for this job before tailoring.');
    if (!selectedKeywords.length) return setAtsError('Select at least one job keyword to prioritize before rewriting.');
    if (retrySecondsRemaining) return setAtsError(`Groq is rate-limited. Try rewriting in ${retrySecondsRemaining} seconds.`);
    const request = ++generationRequest.current;
    const source = structuredClone(atsResume), description = job.text;
    const sourceAnalysis = displayedAnalysis;
    setAtsError('');
    setPreviewSource(false);
    dispatch(tailoringActions.clearCurrent());
    dispatch(tailoringActions.setTailoringStatus({ status: 'loading', error: '' }));
    setStage(4);
    try {
      const candidate = await tailorResumeWithAI(source, description, job.company, job.jobTitle, sourceAnalysis, { selectedKeywords, verifiedCareerProfile: resume.masterResume || undefined });
      if (request !== generationRequest.current || analysisKey(source, description) !== requestKey.current) return;
      const validated = tailoredResultSchema.safeParse(candidate);
      if (!validated.success) throw new Error('The AI returned malformed resume data. Your master resume was not changed.');
      dispatch(tailoringActions.setTailoredResult({ ...validated.data, analysis: sourceAnalysis, jobDescription: description, sourceResume: source })); setStage(4); setMobileView('preview');
      if (validated.data.matchComparison?.status === 'unavailable' || validated.data.tailoringReport?.roles.some(role => role.validation_failures.length)) setNotice('Some resume wording was retained because AI rewriting was unavailable or could not be verified. Review before exporting.');
    } catch (error) { if (request === generationRequest.current) {
      if (error.code === 'AI_RATE_LIMITED' && error.retryAfterSeconds) { setCooldownNow(Date.now()); setRetryUntil(Date.now() + error.retryAfterSeconds * 1000); }
      dispatch(tailoringActions.setTailoringStatus({ status: 'failed', error: formatResumeError(error) }));
    } }
  };

  const retailor = async (confirmedSkills = [], fromOriginal = false) => {
    if (!tailoring.current || retailoring) return;
    const request = ++generationRequest.current;
    const originalSource = structuredClone(tailoring.current.sourceResume || resume.masterResume || tailoring.current.resume);
    const source = structuredClone(fromOriginal ? originalSource : tailoring.current.resume);
    const description = job.text;
    const currentKey = currentTailoringKey.current;
    setRetailoring(true); setRetailorError('');
    try {
      const analysis = draftAnalysis || analyzeAtsLocally(originalSource, description);
      if (request !== generationRequest.current || currentKey !== currentTailoringKey.current) return;
      const result = tailoredResultSchema.parse(await tailorResumeWithAI(originalSource, description, job.company, job.jobTitle, analysis, { force: true, confirmedSkills, verifiedCareerProfile: resume.masterResume || undefined, ...(fromOriginal ? {} : { existingTailoredResume: source }) }));
      if (request !== generationRequest.current || currentKey !== currentTailoringKey.current) return;
      // Stored evidence must describe the stored base, even when this rewrite
      // used the current draft as its immediate input.
      const sourceAnalysis = draftAnalysis || analyzeAtsLocally(originalSource, description);
      dispatch(tailoringActions.setTailoredResult({ ...result, sourceResume: originalSource, analysis: sourceAnalysis, jobDescription: description }));
      setPreviewSource(false);
      setMobileView('preview');
      const originalBullets = new Map(['experience', 'projects'].flatMap(section => originalSource[section].flatMap(entry => entry.bullets.map(bullet => [bullet.id, bullet.text]))));
      const meaningfulCount = candidate => ['experience', 'projects'].flatMap(section => candidate[section].flatMap(entry => entry.bullets))
        .filter(bullet => originalBullets.has(bullet.id) && isMeaningfulBulletRewrite(originalBullets.get(bullet.id), bullet.text)).length;
      const newlyChangedBullets = Math.max(0, meaningfulCount(result.resume) - meaningfulCount(source));
      const updates = [result.resume.summary !== source.summary ? 'summary' : '', JSON.stringify(result.resume.skillGroups) !== JSON.stringify(source.skillGroups) ? 'skills' : '', newlyChangedBullets ? `${newlyChangedBullets} additional experience/project bullets` : ''].filter(Boolean);
      const needsReview = result.matchComparison?.status === 'unavailable' || result.tailoringReport?.roles.some(role => role.validation_failures.length);
      setNotice(needsReview ? `${updates.length ? `Current resume updated: ${updates.join(', ')}. ` : ''}Some resume wording was retained; review each section before exporting.` : updates.length ? `Current resume updated: ${updates.join(', ')}. ATS match recalculated.` : 'Rewrite completed. No supported content changes were needed.');
    } catch (error) {
      if (request === generationRequest.current && currentKey === currentTailoringKey.current) {
        if (error.code === 'AI_RATE_LIMITED' && error.retryAfterSeconds) {
          setCooldownNow(Date.now());
          setRetryUntil(Date.now() + error.retryAfterSeconds * 1000);
        }
        setRetailorError(formatResumeError(error));
      }
    }
    finally { setRetailoring(false); }
  };
  const stateForBackup = { masterResume: resume.masterResume, workingResume: resume.workingResume, resumeLibrary: resume.resumeLibrary, sourceName: resume.sourceName, job, current: tailoring.current, versions: tailoring.versions };
  const restoreBackup = async (file) => {
    try { const data = await importBackup(file); dispatch(resumeActions.hydrateResume({ masterResume: data.masterResume, workingResume: data.workingResume, resumeLibrary: data.resumeLibrary || (data.masterResume ? [{ resume: data.masterResume, sourceName: data.sourceName || '', updatedAt: '', isMaster: true }] : []), workingSaved: false, sourceName: data.sourceName })); dispatch(jobActions.hydrateJob(data.job || {})); dispatch(tailoringActions.hydrateTailoring({ current: data.current, versions: data.versions })); setSelectedAtsResumeId(data.masterResume?.id || ''); setAtsChecked(false); setAiAtsReview(null); setAtsError(''); setNotice('Backup imported.'); }
    catch (error) { setNotice(error.message); }
  };
  const clearAll = () => { if (!window.confirm('Clear the master resume, job description, and all saved versions from this browser?')) return; uploadRequest.current += 1; localStorage.removeItem(STORAGE_KEY); dispatch(resumeActions.clearResume()); dispatch(jobActions.clearJob()); dispatch(tailoringActions.clearTailoring()); setSelectedAtsResumeId(''); setAtsChecked(false); setAiAtsReview(null); setAtsError(''); setStage(1); setNotice('Saved data cleared.'); };

  const selectResume = (entry) => { atsRequest.current += 1; setAtsLoading(false); setSelectedAtsResumeId(entry.resume.id); uploadRequest.current += 1; dispatch(resumeActions.loadResumeFromLibrary(entry)); dispatch(tailoringActions.clearCurrent()); setAtsChecked(false); setAiAtsReview(null); setAtsError(''); setStage(2); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const updateJob = (changes) => { generationRequest.current += 1; dispatch(jobActions.updateJob(changes)); dispatch(tailoringActions.clearCurrent()); setAtsChecked(false); setAiAtsReview(null); setSelectedKeywords([]); setAtsError(''); };
  const runAtsCheck = async () => {
    if (!atsResume || job.text.trim().length < 80) return;
    const request = ++atsRequest.current;
    const key = activeAnalysisKey;
    setAtsLoading(true); setAtsChecked(false); setSelectedKeywords([]); setAtsError(''); setAiAtsReview(null); dispatch(tailoringActions.clearCurrent());
    try {
      const review = await analyzeAtsWithAI(atsResume, job.text, { force: true });
      if (request === atsRequest.current && review.key === requestKey.current) { setAiAtsReview(review); setAtsChecked(true); }
    } catch (error) {
      if (request === atsRequest.current && key === requestKey.current) setAtsError(error.message || 'The job match could not be completed. Please check the job description.');
    } finally { if (request === atsRequest.current) setAtsLoading(false); }
  };

  const viewToggle = <div className={styles.viewToggle} aria-label="Choose mobile view"><button className={mobileView === 'editor' ? styles.active : ''} onClick={() => setMobileView('editor')}>Editor</button><button className={mobileView === 'preview' ? styles.active : ''} onClick={() => setMobileView('preview')}>Preview</button></div>;
  const exportTailoredResume = async () => {
    if (!tailoring.current) return;
    try {
      await downloadResumePdf(tailoring.current.resume, `${job.company || 'tailored'}-${job.jobTitle || 'resume'}.pdf`, { keywords: match.matched });
    } catch {
      if (import.meta.env.DEV) console.warn('[resume-ai]', JSON.stringify({ stage: 'document_rendering', event: 'failed' }));
      setNotice('PDF export failed while rendering the document. Your saved resume was not changed. Please retry.');
    }
  };

  return <div className={styles.app}>
    <aside className={styles.sidebar}>
      <div className={styles.siteWrapper}>
      <a className={styles.brand} href="#top" aria-label="doitnext.ai home">
        <span className={styles.brandMark} aria-hidden="true">✦</span>
        <span className={styles.brandCopy}><strong>doitnext<span>.ai</span></strong><small>Resume intelligence studio</small></span>
      </a>
      <nav className={styles.sideNav} aria-label="Primary navigation">
        <button className={stage === 1 ? styles.sideActive : ''} onClick={() => setStage(1)}><NavIcon name="resume" />My resumes</button>
        <button className={stage === 2 ? styles.sideActive : ''} disabled={!resume.workingResume?.name && !resume.sourceName} onClick={() => setStage(2)}><NavIcon name="tailor" />Edit base resume</button>
        <button className={stage === 3 ? styles.sideActive : ''} disabled={!atsResume?.name} onClick={() => setStage(3)}><NavIcon name="history" />Check ATS</button>
        <button className={stage === 4 ? styles.sideActive : ''} disabled={!tailoring.current && !tailoring.versions.length && !atsChecked} onClick={() => { if (tailoring.current) openDraft(tailoring.current); else if (tailoring.versions.length) openDraft(tailoring.versions[0]); else setStage(4); }}><NavIcon name="tailor" />Tailor & review{tailoring.versions.length > 0 && <em>{tailoring.versions.length}</em>}</button>
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
          <div className={styles.uploadBox} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}><div className={styles.uploadIcon}>↥</div><div className={styles.uploadCopy}><h3>Upload existing resume</h3><p>PDF, DOCX, TXT, or image · up to 10 MB</p></div><button className={styles.primary} onClick={() => fileRef.current?.click()}>Choose file</button><input hidden ref={fileRef} type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; handleFile(file); }} /></div>
          <details className={styles.pasteFallback}><summary>Paste resume text</summary><textarea rows="5" value={resume.extractedText} onChange={(e) => dispatch(resumeActions.setExtractedText(e.target.value))} placeholder="Paste all resume text here…" /><button className={styles.secondary} disabled={resume.extractedText.trim().length < 40} onClick={() => parseText(resume.extractedText)}>Parse pasted text</button></details>
        </div>
        {(resume.upload.status !== 'idle') && <div className={styles.progressWrap}><div className={styles.progressLabel}><span>{resume.upload.message || (resume.upload.status === 'error' ? 'Could not process file' : 'Ready to review')}</span><strong>{resume.upload.progress}%</strong></div><div className={styles.progress}><span style={{ width: `${resume.upload.progress}%` }} /></div>{resume.upload.error && <Status type="error">{resume.upload.error} {resume.extractedText && <button className={styles.inlineButton} onClick={() => parseText(resume.extractedText, resume.sourceName)}>Retry parsing</button>}</Status>}</div>}
        {savedParseMissingExperience && <Status type="warning">This saved resume has jobs but no experience bullets. Re-upload {resume.sourceName} to parse the original file again. Your master and drafts will stay saved.</Status>}
        {resume.workingResume?.name && <button type="button" className={styles.continueResume} onClick={() => setStage(2)}><span><strong>Continue editing base resume</strong><small>{resume.workingResume.name}{resume.sourceName ? ` · ${resume.sourceName}` : ''}</small></span><span>Open base editor →</span></button>}
        <section className={styles.librarySection}><div className={styles.libraryHeading}><div><h3>All resumes</h3><p>Stored in this browser. Select one to review and edit.</p></div></div>{resume.resumeLibrary.length ? <div className={styles.resumeLibraryGrid}>{resume.resumeLibrary.map((entry) => <button type="button" className={styles.resumeLibraryCard} key={entry.resume.id} onClick={() => entry.resume.id === resume.workingResume?.id && !resume.workingSaved ? setStage(2) : selectResume(entry)}><span className={styles.resumeFileIcon}>PDF</span><span className={styles.resumeCardCopy}><strong>{entry.resume.name || 'Untitled resume'}</strong><small>{entry.resume.title || entry.sourceName || 'Resume'}{entry.isMaster ? ' · Current master' : ''}</small><small>{entry.sourceName || 'Pasted resume'}{entry.updatedAt ? ` · ${new Date(entry.updatedAt).toLocaleDateString()}` : ''}</small></span><span className={styles.resumeCardAction}>Review →</span></button>)}</div> : <div className={styles.emptyLibrary}>No resumes yet. Upload a file or paste resume text to get started.</div>}</section>
      </section>}

      {stage === 2 && <section className={styles.stage}>
        {job.text.trim().length >= 80 && <Status>This screen shows the original parsed Experience; tailoring does not overwrite it. {tailoring.current?.sourceResume?.id === resume.workingResume.id ? <button className={styles.inlineButton} onClick={() => openDraft(tailoring.current)}>Open rewritten Experience →</button> : <button className={styles.inlineButton} onClick={() => { setSelectedAtsResumeId(resume.workingResume.id); setStage(3); }}>Tailor this copy for the job →</button>}</Status>}
        {savedParseMissingExperience && <Status type="warning">This saved resume has jobs but no experience bullets. Re-upload {resume.sourceName} from My resumes to parse the original file again.</Status>}
        {['succeeded', 'fallback'].includes(resume.upload.status) && <Status type={resume.upload.status === 'fallback' ? 'warning' : 'info'}>{resume.upload.message} {resume.upload.error}</Status>}
        {resume.extractedText && <details className={styles.pasteFallback}><summary>Review text extracted from this upload</summary><textarea readOnly rows="8" value={resume.extractedText} aria-label="Extracted resume text" /></details>}
        <div className={styles.resumeWorkspaceHeader}><div><span className={styles.eyebrow}>Editing base resume</span><h2>{resume.workingResume.name || resume.sourceName || 'Untitled resume'}</h2></div><div className={styles.resumeHeaderActions}><span className={styles.liveBadge}>Base preview</span>{viewToggle}</div></div>
        <div className={`${styles.workspace} ${styles[mobileView]}`}><div className={styles.editorPane}><nav className={styles.editorSectionNav} aria-label="Resume sections">{editorSections.map(([id, label], index) => <button type="button" key={id} className={editorSection === id ? styles.editorSectionActive : ''} onClick={() => setEditorSection(id)}><span>{index + 1}</span>{label}</button>)}</nav><ResumeEditor resume={resume.workingResume} activeSection={editorSection} onChange={(value) => { setAtsChecked(false); dispatch(resumeActions.setWorkingResume(value)); }} />{resume.workingResume.ambiguities.length > 0 && <Status type="warning"><strong>Review needed:</strong> {resume.workingResume.ambiguities.join(' ')}</Status>}<div className={styles.sectionPager}><button className={styles.secondary} onClick={() => editorSectionIndex === 0 ? setStage(1) : setEditorSection(editorSections[editorSectionIndex - 1][0])}>{editorSectionIndex === 0 ? '← Back to resumes' : '← Previous'}</button><span>{editorSectionIndex + 1} of {editorSections.length} · {editorSections[editorSectionIndex][1]}</span>{editorSectionIndex < editorSections.length - 1 ? <button className={styles.primary} onClick={() => setEditorSection(editorSections[editorSectionIndex + 1][0])}>Next: {editorSections[editorSectionIndex + 1][1]} →</button> : <button className={styles.primary} onClick={saveMaster}>Save and check ATS →</button>}</div></div><div className={styles.previewPane} ref={previewRef}><div className={styles.previewLabel}>Resume preview · A4</div><ResumePreview resume={resume.workingResume} activeSection={editorSection} /></div></div>
      </section>}

      {stage === 3 && <section className={styles.stage}>
        <div className={styles.stageIntro}><div><span className={styles.stageNumber}>STEP 3 · JOB DESCRIPTION</span><h2>Check the job match first</h2><p>Paste the job description, check your base ATS match, select the keywords to prioritize, then rewrite the resume with AI.</p></div><span className={styles.filePill}>Your base resume stays unchanged</span></div>
        <div className={styles.jobGrid}>
          <div className={styles.jobForm}>
            <span className={styles.formLabel}>Resume to check</span>
            <div className={styles.resumePicker} role="group" aria-label="Choose a resume to check">{atsResumeOptions.map((entry) => { const selected = entry.resume.id === (atsResume?.id || selectedAtsResumeId); return <button type="button" key={entry.resume.id} aria-pressed={selected} className={`${styles.resumeChoice} ${selected ? styles.resumeChoiceActive : ''}`} onClick={() => { setSelectedAtsResumeId(entry.resume.id); setAtsChecked(false); dispatch(tailoringActions.clearCurrent()); }}><span>▤</span>{entry.isMaster ? 'Master resume' : entry.resume.title || entry.resume.name || entry.sourceName || 'Resume'}</button>; })}</div>
            <label>Job description<textarea rows="18" value={job.text} onChange={(e) => updateJob({ text: e.target.value })} placeholder="Paste the complete job description here…" /></label>
            <p className={styles.charCount}>{job.text.length.toLocaleString()} / 30,000 characters</p>
            <small className={styles.inputHint}>Paste the complete posting. The tailored copy will use only source-supported keywords and experience.</small>
            {job.text.trim().length > 0 && <button className={styles.primary} disabled={job.text.trim().length < 80 || atsLoading} onClick={runAtsCheck}>{atsLoading ? 'Checking base ATS score…' : 'Check ATS Score & Keywords →'}</button>}
            {job.text.trim().length > 0 && <small className={styles.inputHint}>This first check runs locally and does not use your Groq quota. A second ATS check runs after the rewrite.</small>}
            {job.text.trim().length > 0 && job.text.trim().length < 80 && <small className={styles.inputHint}>Add a little more detail to run the check (80 characters minimum).</small>}
            {atsError && <Status type="error">{atsError}</Status>}
          </div>
          <div className={styles.atsReportColumn}>
          <aside className={styles.matchCard}>
            {atsLoading ? <AiLoading title="Analyzing your job match" message="Reading the job description and comparing it with evidence across your resume." steps={['Extracting requirements', 'Matching experience', 'Calculating score']} /> : !atsChecked ? <div className={styles.atsEmpty}>
              <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path d="M10 43a22 22 0 0 1 44 0" /><path d="m32 40 10-13" /><circle cx="32" cy="40" r="2.5" /></svg>
              <h3>First, check your base ATS match</h3>
              <p>Paste the job description and check the score. Then choose the keywords you want the AI to emphasize in your verified experience.</p>
            </div> : <>
            <div className={styles.reportTitle}><span className={styles.eyebrow}>RESUME MATCH REVIEW</span><small>{atsResume.name || atsResume.title || 'Selected resume'}</small></div>
            <div className={styles.score}>{atsLoading ? <span className={styles.scoreLoading}>···</span> : atsChecked ? aiAtsReview.score : '—'}<small>/100</small></div>
            <h3>ATS match score</h3>
            <p>Checked document: <strong>{atsSourceName}</strong></p>
            <p>Local requirement and keyword analysis · no Groq request{aiAtsReview.warning ? ` · ${aiAtsReview.warning}` : ''}</p>
            <p role="status">Check complete · {aiAtsReview.requirements.length} requirements compared with {atsResume.name || 'your selected resume'}.</p>
            <p>{atsChecked ? aiAtsReview.summary : 'Local review of job requirements and resume evidence.'}</p>
            <div className={styles.scoreBreakdown}><div><span>JD keyword match</span><strong>{atsChecked && match.keywords.length > 0 ? `${match.coverage}%` : '—'}</strong></div><div><span>Assessment</span><strong>App estimate</strong></div></div>
            <div className={styles.keywordColumns}>
              <div className={styles.termGroup}><strong>Matched keywords</strong><div>{atsChecked ? match.matched.map((term) => <span className={styles.match} key={term}>{term}</span>) : <em>—</em>}</div></div>
              <div className={styles.termGroup}><strong>Missing keywords</strong><div>{atsChecked ? match.missing.map((term) => <span className={styles.missing} key={term}>{term}</span>) : <em>—</em>}</div></div>
            </div>
            <div className={styles.termGroup}><strong>Needs review</strong><div>{match.uncertain.map((term) => <span className={styles.missing} key={term}>{term}</span>)}</div></div><details><summary>Score calculation and resume evidence</summary><p>{aiAtsReview.rubric.earnedWeight} of {aiAtsReview.rubric.totalWeight} weighted points. Required qualifications: 3 points; preferred: 1. Only supported requirements earn points.</p>{aiAtsReview.requirements.map((r) => <p key={r.term}><strong>{r.term}</strong> · {r.priority} · {r.status === 'matched' ? 'Supported' : r.status === 'missing' ? 'No evidence' : 'Needs review'}<br />Job posting: {r.source}<br />Resume: {r.evidence.join(' / ') || 'No supporting evidence found.'}</p>)}</details><small className={styles.scoreNote}>App estimate for guidance—not an employer ATS score or a hiring prediction.</small>
            <div className={styles.keywordSelector} role="group" aria-label="Choose keywords to prioritize"><strong>Choose keywords for the rewrite</strong><p>Select the JD terms you want emphasized. Selection is a priority, not proof that you have a missing skill; unsupported claims will not be added.</p><div>{[...new Set([...match.matched, ...match.missing, ...match.uncertain])].map(term => <label key={term}><input type="checkbox" checked={selectedKeywords.includes(term)} onChange={() => setSelectedKeywords(current => current.includes(term) ? current.filter(value => value !== term) : [...current, term])} />{term}</label>)}</div><small>{selectedKeywords.length} selected</small></div>
            </>}
          </aside>
          {atsChecked && <div className={`${styles.generateBar} ${styles.atsTailorBar}`}><div><strong>Ready to rewrite your resume?</strong><span>Experience, summary, projects, education details, and skills are reviewed against the selected keywords.</span></div><button className={styles.primary} disabled={!selectedKeywords.length || retrySecondsRemaining > 0} onClick={generate}>{retrySecondsRemaining ? `Groq rate limit · retry in ${Math.floor(retrySecondsRemaining / 60)}:${String(retrySecondsRemaining % 60).padStart(2, '0')}` : 'Rewrite resume with AI →'}</button></div>}
          </div>
        </div>
        {tailoring.error && <Status type="error">{tailoring.error}</Status>}
      </section>}

      {stage === 4 && !tailoring.current && <section className={`${styles.stage} ${styles.tailorStage}`}>
        <div className={styles.stageIntro}><div><span className={styles.stageNumber}>STEP 4 · TAILOR</span><h2>{tailoring.status === 'loading' ? 'Rewriting your Experience' : 'Ready to tailor your resume'}</h2><p>AI rewrites source-backed Experience bullets, checks supported skills, then calculates the ATS score from the finished copy.</p></div><span className={styles.filePill}>Base resume stays unchanged</span></div>
        <div className={styles.tailorWorkspace}>
          <div className={styles.tailorControls}>
            <div className={styles.tailorSource}><div><span className={styles.eyebrow}>JOB DESCRIPTION</span><strong>{job.jobTitle || 'Job description ready'}</strong><small>{job.text.length.toLocaleString()} characters provided</small></div><button type="button" className={styles.textAction} onClick={() => { setStage(3); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit job →</button></div>
            <TailoringProgress status={tailoring.status === 'loading' ? 'working' : 'ready'} sourceResume={atsResume} />
            <section className={styles.tailorMatchPanel}>
              <div className={styles.tailorMatchHeading}><div><span className={styles.eyebrow}>BEFORE TAILORING</span><h3>Your match at a glance</h3></div><span className={styles.tailorScore}>{basePreviewAnalysis?.score ?? '—'}<small>/100</small></span></div>
              <div className={styles.tailorScoreTrack} role="meter" aria-label="Resume match estimate" aria-valuemin="0" aria-valuemax="100" aria-valuenow={basePreviewAnalysis?.score ?? 0}><span style={{ width: `${basePreviewAnalysis?.score ?? 0}%` }} /></div>
              <p className={styles.tailorSummary}>{basePreviewAnalysis?.summary || 'The final score is calculated after tailoring.'}</p>
              <div className={styles.tailorTerms}><h4>Already represented <span>{match.matched.length}</span></h4><div>{match.matched.length ? match.matched.map((term) => <span className={styles.match} key={term}>{term}</span>) : <small>No exact keyword matches found.</small>}</div></div>
              <div className={styles.tailorTerms}><h4>Needs attention <span>{match.missing.length + match.uncertain.length}</span></h4><div>{match.missing.length + match.uncertain.length ? [...match.missing, ...match.uncertain].map((term) => <span className={styles.missing} key={term}>{term}</span>) : <small>No missing keywords found.</small>}</div></div>
              <p className={styles.tailorGuidance}>We’ll emphasize relevant experience already in your resume. Missing qualifications won’t be invented.</p>
              <button type="button" className={`${styles.primary} ${styles.tailorGenerate}`} disabled={tailoring.status === 'loading' || retrySecondsRemaining > 0} onClick={generate}>{tailoring.status === 'loading' ? <><span className={styles.spinner} /> Rewriting Experience…</> : retrySecondsRemaining ? `Groq rate limit · retry in ${Math.floor(retrySecondsRemaining / 60)}:${String(retrySecondsRemaining % 60).padStart(2, '0')}` : 'Rewrite resume with AI →'}</button>
              {tailoring.error && <Status type="error">{tailoring.error}</Status>}
            </section>
          </div>
          <aside className={`${styles.previewPane} ${styles.tailorPreview}`} ref={previewRef}><div className={styles.previewHeader}><div><h3>Resume area · base copy</h3><span>{tailoring.status === 'loading' ? 'Experience is highlighted while AI prepares the tailored copy.' : 'This source version will not be changed.'}</span></div></div><ResumePreview resume={atsResume} label="Base resume preview" activeSection={tailoring.status === 'loading' ? 'experience' : ''} /></aside>
        </div>
      </section>}

      {stage === 4 && tailoring.current && <section className={`${styles.stage} ${styles.reviewStage}`}>
        <div className={styles.mobileReviewToggle}>{viewToggle}</div>
        <div className={`${styles.reviewGrid} ${styles[mobileView]}`}>
          <div className={styles.reviewColumn}>
            <TailoringProgress status={retailoring ? 'working' : 'complete'} sourceResume={tailoring.current.sourceResume} tailoredResume={tailoring.current.resume} score={tailoredMatch?.score} />
            <TailorOverview key={tailoring.current.resume.id} resume={tailoring.current.resume} sourceResume={tailoring.current.sourceResume} jd={job.text} title={job.jobTitle} before={displayedAnalysis?.score ?? tailoring.current.matchComparison?.before} analysis={tailoredMatch} onEditJob={() => setStage(3)} onViewExperience={() => { setPreviewSource(false); setMobileView('preview'); previewRef.current?.querySelector('[data-preview-section="experience"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }} onRetailor={retailor} onRestartFromOriginal={(skills) => retailor(skills, true)} retailoring={retailoring} retailorError={retailorError} retrySecondsRemaining={retrySecondsRemaining} editingUnavailable={tailoring.current.matchComparison?.status === 'unavailable'} />
            <section className={styles.tailoredEditor} aria-label="Tailored resume editor">
              <header>
                <div><span className={styles.eyebrow}>FULL TAILORED RESUME</span><h3>Review and edit every section</h3></div>
                <small>Edits update the tailored preview and export. Your base resume stays unchanged.</small>
              </header>
              <ResumeEditor resume={tailoring.current.resume} onChange={(value) => dispatch(tailoringActions.updateTailoredResume(value))} />
            </section>
          </div>
          <aside className={styles.previewPane} ref={previewRef}><div className={styles.previewHeader}><div><h3>Resume preview</h3></div><div role="group" aria-label="Compare resume versions"><button aria-pressed={!previewSource} onClick={() => setPreviewSource(false)}>Tailored</button><button disabled={!tailoring.current.sourceResume} aria-pressed={previewSource} onClick={() => setPreviewSource(true)}>Base resume</button></div><div className={styles.previewActions}><button onClick={exportTailoredResume}>Export PDF</button></div></div><ResumePreview resume={previewSource ? tailoring.current.sourceResume : tailoring.current.resume} label={previewSource ? 'Base resume preview' : 'Tailored resume preview'} keywords={match.keywords} /></aside>
        </div>
      </section>}
    </main>
    </div>
  </div>;
}
