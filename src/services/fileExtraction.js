import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'webp'];
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MAX_OCR_PAGES = 8;

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
      return String(result.data?.text || '').trim();
    },
    terminate: () => worker.terminate(),
  };
}

async function renderPdfPage(page) {
  const viewport = page.getViewport({ scale: 2 });
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
        if (pageText.replace(/\s/g, '').length < 30 && pageNumber <= MAX_OCR_PAGES) {
          ocr ||= await createOcrReader(onProgress);
          pageText = await ocr.recognize(await renderPdfPage(page));
          warnings.push(`Page ${pageNumber} was read with OCR because it contained no selectable text.`);
        } else if (pageText.replace(/\s/g, '').length < 30) {
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
