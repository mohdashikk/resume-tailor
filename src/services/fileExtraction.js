import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'webp'];
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MAX_OCR_PAGES = 8;
const MIN_COMPLETE_PDF_PAGE_CHARS = 700;

export function pdfItemsToText(items) {
  // PDF drawing order is not reading order. Rebuild baselines before parsing.
  const positioned = items.filter((item) => item.str?.trim());
  if (!positioned.every((item) => Number.isFinite(item.transform?.[4]) && Number.isFinite(item.transform?.[5]))) {
    return positioned.map((item) => item.str.trim()).join('\n');
  }
  const rows = [];
  for (const item of [...positioned].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    let row = rows.find((candidate) => Math.abs(candidate.y - item.transform[5]) <= 2);
    if (!row) { row = { y: item.transform[5], items: [] }; rows.push(row); }
    row.items.push(item);
  }
  const text = (row) => row.items.sort((a, b) => a.transform[4] - b.transform[4]).map((item) => item.str.trim()).join(' ').replace(/\s+([,.;:!?])/g, '$1');
  const rightEdge = (item) => item.transform[4] + Math.max(0, item.width || 0);
  // A repeated vertical gutter separates columns. Date labels alone must not
  // turn a normal role/date row into two independent reading streams.
  const read = (region, depth = 0) => {
    if (depth >= 2 || region.length < 4 || region.some((row) => row.items.some((item) => !Number.isFinite(item.width)))) return region.map(text);
    const candidates = new Set();
    for (const row of region) {
      const ordered = [...row.items].sort((a, b) => a.transform[4] - b.transform[4]);
      ordered.slice(1).forEach((item, index) => {
        const gapStart = rightEdge(ordered[index]);
        if (item.transform[4] - gapStart >= 24) candidates.add(Math.round((gapStart + item.transform[4]) / 2));
      });
    }
    for (const gutter of candidates) {
      const spans = (row) => row.items.some((item) => item.transform[4] < gutter && rightEdge(item) > gutter);
      // Full-width headers and footers stay outside the column region.
      const bands = []; let band = [];
      for (const row of region) {
        if (spans(row)) { if (band.length) bands.push(band); bands.push([row]); band = []; }
        else band.push(row);
      }
      if (band.length) bands.push(band);
      for (const columnBand of bands) {
        const left = columnBand.map((row) => ({ ...row, items: row.items.filter((item) => rightEdge(item) <= gutter) })).filter((row) => row.items.length);
        const right = columnBand.map((row) => ({ ...row, items: row.items.filter((item) => item.transform[4] >= gutter) })).filter((row) => row.items.length);
        const sharedRows = columnBand.filter((row) => row.items.some((item) => rightEdge(item) <= gutter) && row.items.some((item) => item.transform[4] >= gutter));
        if (sharedRows.length < 3 || left.length < 3 || right.filter((row) => text(row).length >= 32).length < 3) continue;
        const before = region.slice(0, region.indexOf(columnBand[0]));
        const after = region.slice(region.indexOf(columnBand.at(-1)) + 1);
        return [...read(before, depth + 1), ...read(left, depth + 1), ...read(right, depth + 1), ...read(after, depth + 1)];
      }
    }
    return region.map(text);
  };
  return read(rows).join('\n');
}

export function pdfPageNeedsOcr(text) {
  return String(text || '').replace(/\s/g, '').length < MIN_COMPLETE_PDF_PAGE_CHARS;
}

export function cleanOcrText(text) {
  return String(text || '')
    .replace(/\bUl\b/g, 'UI')
    .replace(/React\.Js\b/g, 'React.js')
    .replace(/\bSaas\b/g, 'SaaS')
    .replace(/(?<=\p{L})-[ \t]+(?=\p{L})/gu, '-')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function mergePdfTextLayers(textLayer, ocrText) {
  const base = String(ocrText || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const source = String(textLayer || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const key = (line) => line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (line) => new Set((key(line).match(/[a-z0-9]{3,}/g) || []));
  const nearWord = (left, right) => {
    if (left === right) return true;
    if (Math.abs(left.length - right.length) > 1) return false;
    let a = 0; let b = 0; let edits = 0;
    while (a < left.length && b < right.length) {
      if (left[a] === right[b]) { a += 1; b += 1; continue; }
      if (++edits > 1) return false;
      if (left.length >= right.length) a += 1;
      if (right.length >= left.length) b += 1;
    }
    return edits + Number(a < left.length || b < right.length) <= 1;
  };
  for (const line of source) {
    const normalized = key(line);
    if (normalized.length < 15) continue;
    const index = base.findIndex((existing) => {
      const candidate = key(existing);
      if (!candidate) return false;
      if (candidate === normalized) return true;
      if (Math.min(candidate.length, normalized.length) >= 15
        && Math.min(candidate.length, normalized.length) / Math.max(candidate.length, normalized.length) >= 0.3
        && (candidate.includes(normalized) || normalized.includes(candidate))) return true;
      const sourceWords = words(line); const candidateWords = words(existing);
      return sourceWords.size >= 3 && [...sourceWords].filter((word) => [...candidateWords].some((candidateWord) => nearWord(word, candidateWord))).length / sourceWords.size >= 0.7;
    });
    if (index < 0) base.push(line);
    else if (normalized.length > key(base[index]).length * 1.2 && !/\ufffd/.test(line)) base[index] = line;
  }
  return base.join('\n');
}

async function createOcrReader(onProgress) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (message) => {
      if (message.status === 'recognizing text') {
        onProgress({ stage: 'ocr', percent: 20 + Math.round((message.progress || 0) * 65) });
      }
    },
  });
  return {
    async recognize(image) {
      const result = await worker.recognize(image);
      return cleanOcrText(result.data?.text);
    },
    terminate: () => worker.terminate(),
  };
}

async function renderPdfPage(page) {
  const viewport = page.getViewport({ scale: 3 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not prepare the scanned PDF for OCR.');
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

function imageMime(extension) {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  return `image/${extension}`;
}

export async function extractResumeText(file, onProgress = () => {}) {
  if (!file) throw new Error('Choose a PDF or DOCX file.');
  if (file.size > MAX_FILE_BYTES) throw new Error('The file is larger than the 10 MB limit.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(extension)) throw new Error('Use PDF, DOCX, TXT, PNG, JPG, or WebP for the resume.');
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
    let ocr = null;
    let skippedOcrPages = 0;
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        let pageText = pdfItemsToText(content.items);
        // A PDF can contain plenty of selectable header/skills text while its
        // experience bullets are vector outlines. Character count alone cannot
        // prove the page is complete, so inspect every bounded page with OCR.
        if (pageNumber <= MAX_OCR_PAGES) {
          try {
            ocr ||= await createOcrReader(onProgress);
            const ocrText = await ocr.recognize(await renderPdfPage(page));
            const layerLength = pageText.replace(/\s/g, '').length;
            const ocrLength = ocrText.replace(/\s/g, '').length;
            if (ocrLength >= Math.max(40, layerLength * 1.15) || pdfPageNeedsOcr(pageText)) {
              pageText = mergePdfTextLayers(pageText, ocrText);
              warnings.push(`Page ${pageNumber} contained text not fully available in its PDF text layer. OCR was used; review its reading order.`);
            } else if (ocrLength >= 40) {
              const merged = mergePdfTextLayers(ocrText, pageText);
              if (merged.length > pageText.length) warnings.push(`Page ${pageNumber} included additional OCR-only text; review its reading order.`);
              pageText = merged;
            }
          } catch (error) {
            if (pdfPageNeedsOcr(pageText)) {
              throw new Error(`Page ${pageNumber} has an incomplete text layer and OCR could not recover it. No partial resume was saved. Try again when OCR is available, or upload a text-based PDF/DOCX.`);
            }
          }
        } else if (pdfPageNeedsOcr(pageText)) {
          skippedOcrPages += 1;
        }
        pages.push(pageText);
        onProgress({ stage: 'extracting', percent: 15 + Math.round((pageNumber / document.numPages) * 55) });
      }
    } finally {
      if (ocr) await ocr.terminate();
    }
    if (skippedOcrPages) warnings.push(`OCR is limited to the first ${MAX_OCR_PAGES} pages; ${skippedOcrPages} later image-only page(s) were skipped.`);
    value = pages.join('\n\n');
  } else {
    if (extension === 'docx') {
      const { default: mammoth } = await import('mammoth/mammoth.browser');
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      value = result.value;
      warnings = result.messages.map((message) => message.message);
      onProgress({ stage: 'extracting', percent: 70 });
    } else if (extension === 'txt') {
      value = new TextDecoder('utf-8').decode(buffer);
      onProgress({ stage: 'extracting', percent: 70 });
    } else if (IMAGE_EXTENSIONS.has(extension)) {
      const ocr = await createOcrReader(onProgress);
      try {
        value = await ocr.recognize(new Blob([buffer], { type: imageMime(extension) }));
        warnings.push('This image resume was read with OCR. Review names, dates, email addresses, and numbers carefully.');
      } finally {
        await ocr.terminate();
      }
    }
  }
  if (value.replace(/\s/g, '').length < 40) {
    const error = new Error('No readable resume text was found, even after OCR. Try a clearer file or paste the resume text below.');
    error.code = 'IMAGE_ONLY';
    throw error;
  }
  return { text: value.trim(), warnings };
}
