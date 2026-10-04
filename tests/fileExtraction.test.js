import { beforeAll, describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { extractResumeText } from '../src/services/fileExtraction';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: `file:///${process.cwd().replace(/\\/g, '/')}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`,
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
    pdf.text('Experience creating accessible design systems for web products.', 20, 30);
    const bytes = pdf.output('arraybuffer');
    const result = await extractResumeText(fileLike('resume.pdf', bytes));
    expect(result.text).toContain('Asha Rao');
    expect(result.text).toContain('accessible design systems');
    expect(result.text).toContain('\n');
  }, 15000);

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
});
