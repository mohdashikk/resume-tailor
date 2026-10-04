const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const same = (left, right) => clean(left) === clean(right);
const emptyLabel = '(not present)';

function keywordHits(text, keywords) {
  const lower = clean(text).toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

function addChange(changes, location, before, after, keywords) {
  if (same(before, after)) return;
  changes.push({
    id: `${location}-${changes.length}`,
    location,
    before: clean(before) || emptyLabel,
    after: clean(after) || emptyLabel,
    jdTerms: keywordHits(after, keywords).filter((term) => !clean(before).toLowerCase().includes(term.toLowerCase())),
  });
}

function itemName(item, fallback) {
  return clean(item?.role || item?.name || item?.qualification || item?.company || item?.institution || fallback);
}

function compareEntries(changes, section, masterItems, tailoredItems, keywords) {
  const originals = new Map(masterItems.map((item) => [item.id, item]));
  tailoredItems.forEach((item, itemIndex) => {
    const original = originals.get(item.masterId || item.id);
    const label = `${section} · ${itemName(item, `Item ${itemIndex + 1}`)}`;
    if (!original) {
      addChange(changes, label, '', [item.role, item.name, item.company, item.subtitle].filter(Boolean).join(' — '), keywords);
      (item.bullets || []).forEach((bullet, index) => addChange(changes, `${label} · Bullet ${index + 1}`, '', bullet.text, keywords));
      return;
    }
    const headingFields = section === 'Experience'
      ? ['role', 'company', 'location', 'startDate', 'endDate']
      : ['name', 'subtitle', 'link', 'startDate', 'endDate'];
    headingFields.forEach((field) => addChange(changes, `${label} · ${field.replace(/([A-Z])/g, ' $1')}`, original[field], item[field], keywords));
    const maxBullets = Math.max(original.bullets?.length || 0, item.bullets?.length || 0);
    for (let index = 0; index < maxBullets; index += 1) {
      addChange(changes, `${label} · Bullet ${index + 1}`, original.bullets?.[index]?.text, item.bullets?.[index]?.text, keywords);
    }
  });
}

export function buildChangeAudit(master, tailored, jdKeywords = []) {
  if (!master || !tailored) return { changes: [], introducedTerms: [] };
  const masterText = JSON.stringify(master).toLowerCase();
  const tailoredText = JSON.stringify(tailored).toLowerCase();
  const introducedTerms = jdKeywords.filter((term) => !masterText.includes(term.toLowerCase()) && tailoredText.includes(term.toLowerCase()));
  const changes = [];

  addChange(changes, 'Professional summary', master.summary, tailored.summary, jdKeywords);
  const skills = (resume) => resume.skillGroups.map((group) => `${group.name}: ${group.skills.join(', ')}`).join(' | ');
  addChange(changes, 'Skills and ordering', skills(master), skills(tailored), jdKeywords);

  const originalExperienceOrder = master.experience.map((item) => item.id).join('|');
  const tailoredExperienceOrder = tailored.experience.map((item) => item.masterId || item.id).join('|');
  if (originalExperienceOrder !== tailoredExperienceOrder) {
    addChange(changes, 'Experience order', master.experience.map((item) => item.role || item.company).join(' → '), tailored.experience.map((item) => item.role || item.company).join(' → '), jdKeywords);
  }
  compareEntries(changes, 'Experience', master.experience, tailored.experience, jdKeywords);

  const originalProjectOrder = master.projects.map((item) => item.id).join('|');
  const tailoredProjectOrder = tailored.projects.map((item) => item.masterId || item.id).join('|');
  if (originalProjectOrder !== tailoredProjectOrder) {
    addChange(changes, 'Project order', master.projects.map((item) => item.name).join(' → '), tailored.projects.map((item) => item.name).join(' → '), jdKeywords);
  }
  compareEntries(changes, 'Project', master.projects, tailored.projects, jdKeywords);

  return { changes, introducedTerms };
}
