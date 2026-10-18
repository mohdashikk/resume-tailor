const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');

export function educationDetails(item) {
  const redundant = new Set([item.qualification, item.institution, item.location, [item.qualification, item.location].filter(Boolean).join(' ')].map(key).filter(Boolean));
  const seen = new Set();
  return clean(item.details).split(/\s*\|\s*|\n+/).filter(part => {
    const normalized = key(part);
    if (!normalized || redundant.has(normalized) || seen.has(normalized)) return false;
    seen.add(normalized); return true;
  }).join(' · ');
}

export function resumeLink(link) {
  const raw = clean(link.url);
  const url = /^https?:\/\//i.test(raw) ? raw : /^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(raw) ? `https://${raw}` : '';
  const generic = /^(?:github|gitlab|linkedin|personal website|website|portfolio|website link|profile)$/i.test(clean(link.label));
  return { ...link, url, label: generic || !clean(link.label) ? url.replace(/^https?:\/\//i, '').replace(/\/$/, '') : clean(link.label) };
}
