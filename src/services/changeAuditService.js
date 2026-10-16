import { canonicalTerm, containsTerm, normalizeAliases, resumeEvidence } from './atsAnalysis.js';

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const same = (left, right) => clean(left) === clean(right);
const emptyLabel = '(not present)';

function keywordHits(text, keywords) {
  const lower = normalizeAliases(text);
  return keywords.filter((keyword) => containsTerm(lower, canonicalTerm(keyword)));
}

function addChange(changes, location, before, after, keywords, target = null) {
  if (same(before, after)) return;
  changes.push({
    id: `${location}-${changes.length}`,
    location,
    before: clean(before) || emptyLabel,
    after: clean(after) || emptyLabel,
    jdTerms: keywordHits(after, keywords).filter((term) => !keywordHits(before, [term]).length),
    target,
  });
}

function itemName(item, fallback) {
  return clean(item?.role || item?.name || item?.qualification || item?.company || item?.institution || fallback);
}

function compareEntries(changes, section, sectionKey, masterItems, tailoredItems, keywords) {
  const originals = new Map(masterItems.map((item) => [item.id, item]));
  tailoredItems.forEach((item, itemIndex) => {
    const original = originals.get(item.masterId || item.id);
    const label = `${section} · ${itemName(item, `Item ${itemIndex + 1}`)}`;
    if (!original) {
      addChange(changes, label, '', [item.role, item.name, item.company, item.subtitle].filter(Boolean).join(' — '), keywords, { type: 'entry', sectionKey, itemId: item.id });
      (item.bullets || []).forEach((bullet, index) => addChange(changes, `${label} · Bullet ${index + 1}`, '', bullet.text, keywords, { type: 'bullet', sectionKey, itemId: item.id, index }));
      return;
    }
    const headingFields = section === 'Experience'
      ? ['role', 'company', 'location', 'startDate', 'endDate']
      : ['name', 'subtitle', 'link', 'startDate', 'endDate'];
    headingFields.forEach((field) => addChange(changes, `${label} · ${field.replace(/([A-Z])/g, ' $1')}`, original[field], item[field], keywords, { type: 'entryField', sectionKey, itemId: item.id, masterId: original.id, field }));
    const maxBullets = Math.max(original.bullets?.length || 0, item.bullets?.length || 0);
    for (let index = 0; index < maxBullets; index += 1) {
      addChange(changes, `${label} · Bullet ${index + 1}`, original.bullets?.[index]?.text, item.bullets?.[index]?.text, keywords, { type: 'bullet', sectionKey, itemId: item.id, masterId: original.id, index });
    }
  });
}

export function buildChangeAudit(master, tailored, jdKeywords = []) {
  if (!master || !tailored) return { changes: [], introducedTerms: [] };
  const introducedTerms = keywordHits(resumeEvidence(tailored), jdKeywords).filter((term) => !keywordHits(resumeEvidence(master), [term]).length);
  const changes = [];

  addChange(changes, 'Professional summary', master.summary, tailored.summary, jdKeywords, { type: 'rootField', field: 'summary' });
  const skills = (resume) => resume.skillGroups.map((group) => `${group.name}: ${group.skills.join(', ')}`).join(' | ');
  addChange(changes, 'Skills and ordering', skills(master), skills(tailored), jdKeywords, { type: 'rootField', field: 'skillGroups' });

  const originalExperienceOrder = master.experience.map((item) => item.id).join('|');
  const tailoredExperienceOrder = tailored.experience.map((item) => item.masterId || item.id).join('|');
  if (originalExperienceOrder !== tailoredExperienceOrder) {
    addChange(changes, 'Experience order', master.experience.map((item) => item.role || item.company).join(' → '), tailored.experience.map((item) => item.role || item.company).join(' → '), jdKeywords, { type: 'order', sectionKey: 'experience' });
  }
  compareEntries(changes, 'Experience', 'experience', master.experience, tailored.experience, jdKeywords);

  const originalProjectOrder = master.projects.map((item) => item.id).join('|');
  const tailoredProjectOrder = tailored.projects.map((item) => item.masterId || item.id).join('|');
  if (originalProjectOrder !== tailoredProjectOrder) {
    addChange(changes, 'Project order', master.projects.map((item) => item.name).join(' → '), tailored.projects.map((item) => item.name).join(' → '), jdKeywords, { type: 'order', sectionKey: 'projects' });
  }
  compareEntries(changes, 'Project', 'projects', master.projects, tailored.projects, jdKeywords);

  return { changes, introducedTerms };
}

export function rejectAuditChange(tailored, master, change) {
  if (!tailored || !master || !change?.target) return tailored;
  const next = structuredClone(tailored);
  const target = change.target;

  if (target.type === 'rootField') next[target.field] = structuredClone(master[target.field]);
  if (target.type === 'order') {
    const current = next[target.sectionKey] || [];
    const bySourceId = new Map(current.map((item) => [item.masterId || item.id, item]));
    const restored = (master[target.sectionKey] || []).map((item) => bySourceId.get(item.id) || structuredClone(item));
    const additions = current.filter((item) => !master[target.sectionKey]?.some((source) => source.id === (item.masterId || item.id)));
    next[target.sectionKey] = [...restored, ...additions];
  }
  if (target.type === 'entry') next[target.sectionKey] = (next[target.sectionKey] || []).filter((item) => item.id !== target.itemId);
  if (target.type === 'entryField' || target.type === 'bullet') {
    const entry = (next[target.sectionKey] || []).find((item) => item.id === target.itemId || item.masterId === target.masterId);
    const source = (master[target.sectionKey] || []).find((item) => item.id === target.masterId);
    if (entry && source && target.type === 'entryField') entry[target.field] = source[target.field];
    if (entry && target.type === 'bullet') {
      const sourceBullet = source?.bullets?.[target.index];
      if (sourceBullet) entry.bullets[target.index] = structuredClone(sourceBullet);
      else entry.bullets.splice(target.index, 1);
    }
  }
  return next;
}
