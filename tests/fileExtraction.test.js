import { beforeAll, describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { cleanOcrText, extractResumeText, mergePdfTextLayers, pdfPageNeedsOcr, pdfItemsToText } from '../src/services/fileExtraction';

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
    expect(cleanOcrText('Ul/UX Designer\nSaas products\nReact.Js\npixel- perfect')).toBe('UI/UX Designer\nSaaS products\nReact.js\npixel-perfect');
  });

  it('keeps selectable experience bullets when OCR reads more of a short PDF page', () => {
    const merged = mergePdfTextLayers(
      'EXPERIENCE\nDesigned Figma prototypes and user flows for SaaS products.\nCollaborated with engineers on design reviews.',
      'EXPERIENCE\nDesigned Figma prototypes\nConducted usability tests with customers.',
    );
    expect(merged).toContain('Designed Figma prototypes and user flows for SaaS products.');
    expect(merged).toContain('Conducted usability tests with customers.');
    expect(merged).toContain('Collaborated with engineers on design reviews.');
    expect(merged.match(/Designed Figma prototypes/g)).toHaveLength(1);
  });

  it('does not append duplicate contact lines or sparse date fragments after OCR', () => {
    const merged = mergePdfTextLayers(
      'Kerala, India +91 8089911973 mail4ashh@gmail.com\nDec Sep\nBachelor of Arts Distance Education pected July',
      'Kerala, India | +918089911973 | mail4ashh@gmail.com\nBachelor of Arts Distance Education Expected July 2026',
    );
    expect(merged.split('\n')).toHaveLength(2);
    expect(merged).not.toContain('Dec Sep');
  });

  it('does not overwrite an OCR section heading with a longer text-layer line containing that word', () => {
    const merged = mergePdfTextLayers(
      'Bachelor of Arts - Distance Education, expected July 2026',
      'EDUCATION\nBachelor of Arts - Distance Education, expected July 2026',
    );
    expect(merged.split('\n')[0]).toBe('EDUCATION');
  });

  it('avoids appending duplicate OCR-corrupted education lines', () => {
    const merged = mergePdfTextLayers(
      'Final ear Student\nImage Creative ducation, erala',
      'EDUCATION\nFinal Year Student\nImage Creative Education, Kerala',
    );
    expect(merged.split('\n')).toEqual(['EDUCATION', 'Final Year Student', 'Image Creative Education, Kerala']);
  });

  it('keeps an OCR-only bullet when a long text layer is otherwise complete', () => {
    const merged = mergePdfTextLayers(
      'Created accessible mobile and web interfaces.',
      'Asha Rao\nExperience\nBuilt product design systems.',
    );
    expect(merged).toContain('Built product design systems.');
    expect(merged).toContain('Created accessible mobile and web interfaces.');
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

it('orders PDF text by position', () => {
 const item = (str, x, y) => ({str, transform: [1,0,0,1,x,y]});
 expect(pdfItemsToText([item('2024',400,700),item('Engineer',30,700),item('Alex',30,740)])).toBe('Alex\nEngineer 2024');
});

it('reads sidebar columns separately while preserving a full-width name and footer', () => {
  const item = (str, x, y, width) => ({ str, width, transform: [1, 0, 0, 1, x, y] });
  const items = [item('Alex Morgan - Frontend Engineer', 30, 780, 500)];
  ['SKILLS', 'React, TypeScript', 'LANGUAGES', 'English, Malayalam'].forEach((str, i) => items.push(item(str, 30, 720 - i * 20, 140)));
  ['EXPERIENCE - Frontend developer at Acme', 'Built accessible customer-facing applications.', 'Improved application performance and reliability.', 'Delivered reusable components across product teams.'].forEach((str, i) => items.push(item(str, 240, 720 - i * 20, 300)));
  items.push(item('Footer spanning the complete document width', 30, 50, 500));
  const text = pdfItemsToText(items.reverse());
  expect(text.indexOf('English, Malayalam')).toBeLessThan(text.indexOf('EXPERIENCE'));
  expect(text.startsWith('Alex Morgan')).toBe(true);
  expect(text.endsWith('Footer spanning the complete document width')).toBe(true);
});

it('keeps right-aligned employment dates beside their roles', () => {
  const item = (str, x, y, width) => ({ str, width, transform: [1, 0, 0, 1, x, y] });
  const items = Array.from({ length: 4 }, (_, i) => [item(`Engineer at Company ${i}`, 30, 700 - i * 40, 180), item('Jan 2020 - Present', 400, 700 - i * 40, 100)]).flat();
  expect(pdfItemsToText(items).split('\n').every((line) => /Engineer.*Present/.test(line))).toBe(true);
});
