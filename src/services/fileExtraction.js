import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

function pdfItemsToText(items) {
  const lines = []; let current = []; let previousY = null;
  const flush = () => { const value = current.join(' ').replace(/\s+([,.;:!?])/g, '$1').trim(); if (value) lines.push(value); current = []; };
  items.forEach((item) => {
    const y = item.transform?.[5];
    if (previousY !== null && Number.isFinite(y) && Math.abs(y - previousY) > 2) flush();
    if (item.str?.trim()) current.push(item.str.trim());
    if (item.hasEOL) flush();
    if (Number.isFinite(y)) previousY = y;
  });
  flush(); return lines.join('\n');
}

export async function extractResumeText(file, onProgress = () => {}) {
  if (!file) throw new Error('Choose a PDF or DOCX file.');
  if (file.size > MAX_FILE_BYTES) throw new Error('The file is larger than the 10 MB limit.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['pdf', 'docx'].includes(extension)) throw new Error('Only PDF and DOCX files are supported.');
  onProgress({ stage: 'extracting', percent: 15 });
  const buffer = await file.arrayBuffer();
  let value = '';
  let warnings = [];
  if (extension === 'pdf') {
    Promise.try ||= (callback, ...args) => new Promise((resolve) => resolve(callback(...args)));
    Uint8Array.prototype.toHex ||= function toHex() { return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join(''); };
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(pdfItemsToText(content.items));
      onProgress({ stage: 'extracting', percent: 15 + Math.round((pageNumber / document.numPages) * 55) });
    }
    value = pages.join('\n\n');
  } else {
    const { default: mammoth } = await import('mammoth/mammoth.browser');
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    value = result.value;
    warnings = result.messages.map((message) => message.message);
    onProgress({ stage: 'extracting', percent: 70 });
  }
  if (value.replace(/\s/g, '').length < 40) {
    const error = new Error('No readable text was found. This may be a scanned or image-only PDF. Paste the resume text below instead.');
    error.code = 'IMAGE_ONLY';
    throw error;
  }
  return { text: value.trim(), warnings };
}
