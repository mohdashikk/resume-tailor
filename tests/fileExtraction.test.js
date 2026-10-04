import { beforeAll, describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { cleanOcrText, extractResumeText, pdfPageNeedsOcr } from '../src/services/fileExtraction';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: `file:///${process.cwd().replace(/\\/g, '/')}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`,
}));

vi.mock('tesseract.js', () => ({
  createWorker: async () => ({
    recognize: async () => ({ data: { text: 'Asha Rao\nProduct Designer\nCreated accessible mobile and web interfaces.' } }),
    terminate: async () => {},
  }),
}));

const fileLike = (name, bytes) => ({ name, size: bytes.byteLength, arrayBuffer: async () => bytes });

describe('browser document extraction', () => {
  beforeAll(() => {
    globalThis.DOMMatrix ||= class DOMMatrix {};
    globalThis.Path2D ||= class Path2D {};
    globalThis.ImageData ||= class ImageData {};
  });
  it('extracts selectable text from a PDF', async () => {
    const pdf = new jsPDF();
    pdf.text('Asha Rao Product Designer asha@example.com', 20, 20);
    Array.from({ length: 18 }, (_, index) => pdf.text(`Experience creating accessible design systems for web products and teams ${index + 1}.`, 20, 30 + index * 8));
    const bytes = pdf.output('arraybuffer');
    const result = await extractResumeText(fileLike('resume.pdf', bytes));
    expect(result.text).toContain('Asha Rao');
    expect(result.text).toContain('accessible design systems');
    expect(result.text).toContain('\n');
  }, 15000);

  it('detects a partially broken PDF text layer that needs OCR', () => {
    expect(pdfPageNeedsOcr('SUMMARY\nEXPERIENCE\nUI/UX Designer\nCompany')).toBe(true);
    expect(pdfPageNeedsOcr('Complete resume content '.repeat(45))).toBe(false);
  });

  it('normalizes common resume OCR ambiguities', () => {
    expect(cleanOcrText('Ul/UX Designer\nSaas products\nReact.Js')).toBe('UI/UX Designer\nSaaS products\nReact.js');
  });

  it('extracts paragraphs from a DOCX', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.folder('_rels').file('.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.folder('word').file('document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Asha Rao — Product Designer</w:t></w:r></w:p><w:p><w:r><w:t>Built accessible design systems and improved delivery quality across product teams.</w:t></w:r></w:p></w:body></w:document>');
    const bytes = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await extractResumeText(fileLike('resume.docx', bytes));
    expect(result.text).toContain('Asha Rao');
    expect(result.text).toContain('accessible design systems');
  }, 15000);

  it('accepts plain-text resumes', async () => {
    const bytes = new TextEncoder().encode('Asha Rao\nProduct Designer\nCreated accessible product experiences.').buffer;
    const result = await extractResumeText(fileLike('resume.txt', bytes));
    expect(result.text).toContain('Product Designer');
  });

  it('uses OCR for image resumes', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
    const result = await extractResumeText(fileLike('resume.png', bytes));
    expect(result.text).toContain('accessible mobile and web interfaces');
    expect(result.warnings.join(' ')).toContain('OCR');
  });
});
