// Small layout helper on top of pdf-lib: wrapping text, sections, key/value tables,
// boxes, signature lines, automatic page breaks and footers.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const COLORS = {
  text: rgb(0.11, 0.12, 0.14),
  muted: rgb(0.42, 0.45, 0.5),
  accent: rgb(0.11, 0.24, 0.47),
  line: rgb(0.82, 0.84, 0.88),
  fill: rgb(0.955, 0.962, 0.975),
};

// Standard PDF fonts only cover Latin-1 + a few symbols; replace anything else.
const EXTRA = new Set('–—‘’“”•€…'.split(''));
export const safe = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .replace(/[‎‏]/g, '')
    .split('')
    .map((c) => (c.charCodeAt(0) <= 255 || EXTRA.has(c) ? c : '?'))
    .join('');

export async function createDoc({ footerLeft = '' } = {}) {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const W = 595.28, H = 841.89, M = 56, BOTTOM = 70;
  const doc = { pdf, fonts, W, H, M, width: W - 2 * M, page: null, y: 0 };

  doc.newPage = () => { doc.page = pdf.addPage([W, H]); doc.y = H - M; };
  doc.ensure = (h) => { if (!doc.page || doc.y - h < BOTTOM) doc.newPage(); };

  doc.wrap = (str, font, size, width) => {
    const out = [];
    for (const para of safe(str).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(test, size) <= width) line = test;
        else { if (line) out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  };

  doc.text = (str, { font = fonts.regular, size = 10, color = COLORS.text, x = M, width = doc.width, gap = 4, align = 'left' } = {}) => {
    const lh = size + gap;
    for (const line of doc.wrap(str, font, size, width)) {
      doc.ensure(lh);
      const tx = align === 'right' ? x + width - font.widthOfTextAtSize(line, size) : align === 'center' ? x + (width - font.widthOfTextAtSize(line, size)) / 2 : x;
      doc.page.drawText(line, { x: tx, y: doc.y - size, size, font, color });
      doc.y -= lh;
    }
  };

  doc.space = (h) => { doc.y -= h; };

  doc.section = (title) => {
    doc.ensure(60);
    doc.space(14);
    doc.page.drawText(safe(title).toUpperCase(), { x: M, y: doc.y - 11, size: 10.5, font: fonts.bold, color: COLORS.accent });
    doc.y -= 17;
    doc.page.drawLine({ start: { x: M, y: doc.y }, end: { x: M + doc.width, y: doc.y }, thickness: 0.8, color: COLORS.accent });
    doc.space(8);
  };

  // Rows of [label, value]. Empty values get a blank line to fill in by hand.
  doc.table = (rows, { labelWidth = 165 } = {}) => {
    const size = 10, lh = 14, vx = M + labelWidth, vw = doc.width - labelWidth;
    for (const [label, value] of rows) {
      const lines = value ? doc.wrap(value, fonts.regular, size, vw) : [''];
      const h = lines.length * lh + 8;
      doc.ensure(h);
      doc.page.drawText(safe(label), { x: M, y: doc.y - size - 3, size: 9.5, font: fonts.regular, color: COLORS.muted });
      if (value) lines.forEach((l, i) => doc.page.drawText(l, { x: vx, y: doc.y - size - 3 - i * lh, size, font: fonts.bold, color: COLORS.text }));
      else doc.page.drawLine({ start: { x: vx, y: doc.y - size - 4 }, end: { x: vx + Math.min(220, vw), y: doc.y - size - 4 }, thickness: 0.6, color: COLORS.muted, dashArray: [2, 2] });
      doc.y -= h;
      doc.page.drawLine({ start: { x: M, y: doc.y + 3 }, end: { x: M + doc.width, y: doc.y + 3 }, thickness: 0.4, color: COLORS.line });
    }
  };

  // Side-by-side boxes, each { title, rows: [[label, value]] }.
  doc.boxes = (boxes) => {
    const gap = 14, bw = (doc.width - gap * (boxes.length - 1)) / boxes.length, pad = 10, lh = 13;
    const heights = boxes.map((b) => 26 + b.rows.length * (lh * 2 + 4) + pad);
    const h = Math.max(...heights);
    doc.ensure(h + 6);
    boxes.forEach((b, i) => {
      const x = M + i * (bw + gap), top = doc.y;
      doc.page.drawRectangle({ x, y: top - h, width: bw, height: h, color: COLORS.fill, borderColor: COLORS.line, borderWidth: 0.8 });
      doc.page.drawText(safe(b.title).toUpperCase(), { x: x + pad, y: top - pad - 9, size: 9, font: fonts.bold, color: COLORS.accent });
      let y = top - 26 - pad;
      for (const [label, value] of b.rows) {
        doc.page.drawText(safe(label), { x: x + pad, y: y - 8, size: 8, font: fonts.regular, color: COLORS.muted });
        if (value) doc.page.drawText(doc.wrap(value, fonts.bold, 10, bw - 2 * pad)[0], { x: x + pad, y: y - 8 - lh, size: 10, font: fonts.bold, color: COLORS.text });
        else doc.page.drawLine({ start: { x: x + pad, y: y - 8 - lh }, end: { x: x + bw - pad, y: y - 8 - lh }, thickness: 0.6, color: COLORS.muted, dashArray: [2, 2] });
        y -= lh * 2 + 4;
      }
    });
    doc.y -= h + 6;
  };

  // Signature blocks, two per row: { role, name }
  doc.signatures = (blocks) => {
    const gap = 30, bw = (doc.width - gap) / 2, h = 96;
    for (let i = 0; i < blocks.length; i += 2) {
      doc.ensure(h);
      blocks.slice(i, i + 2).forEach((b, j) => {
        const x = M + j * (bw + gap), top = doc.y;
        doc.page.drawText(safe(b.role).toUpperCase(), { x, y: top - 10, size: 9, font: fonts.bold, color: COLORS.accent });
        const line = (y, label, value) => {
          doc.page.drawLine({ start: { x: x + 52, y }, end: { x: x + bw, y }, thickness: 0.6, color: COLORS.text });
          doc.page.drawText(label, { x, y: y + 2, size: 8.5, font: fonts.regular, color: COLORS.muted });
          if (value) doc.page.drawText(safe(value), { x: x + 56, y: y + 3, size: 10, font: fonts.regular, color: COLORS.text });
        };
        line(top - 34, 'Name', b.name);
        line(top - 60, 'Signature', '');
        line(top - 84, 'Date', '');
      });
      doc.y -= h + 8;
    }
  };

  doc.finish = async () => {
    const pages = pdf.getPages();
    pages.forEach((p, i) => {
      p.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.4, color: COLORS.line });
      p.drawText(safe(footerLeft), { x: M, y: 32, size: 8, font: fonts.regular, color: COLORS.muted });
      const label = `Page ${i + 1} of ${pages.length}`;
      p.drawText(label, { x: W - M - fonts.regular.widthOfTextAtSize(label, 8), y: 32, size: 8, font: fonts.regular, color: COLORS.muted });
    });
    return pdf.save();
  };

  return doc;
}
