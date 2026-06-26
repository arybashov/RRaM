// Конвертер RRaM_browser_2d_TZ.md → docx. Заточен под конструкции этого ТЗ:
// заголовки #..####, маркированные списки, нумерованные пункты, pipe-таблицы,
// inline **жирный** и `код`.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType, ShadingType,
} = require('docx');

const SRC = process.argv[2];
const OUT = process.argv[3];
// Вычищаем C0-control символы (кроме \t,\n), недопустимые в XML 1.0.
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
const lines = fs.readFileSync(SRC, 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(CONTROL, '')
  .split('\n');

const CONTENT_W = 9360; // US Letter, поля 1"

function runs(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(new TextRun({ text: tok.slice(2, -2), bold: true }));
    else out.push(new TextRun({ text: tok.slice(1, -1), font: 'Consolas' }));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(new TextRun(text.slice(last)));
  if (out.length === 0) out.push(new TextRun(text));
  return out;
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
const children = [];

function parseRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

const border = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
const borders = { top: border, bottom: border, left: border, right: border };

function buildTable(block) {
  const header = parseRow(block[0]);
  const bodyRows = block.slice(2).map(parseRow); // [1] — разделитель
  const cols = header.length;
  const colW = Math.floor(CONTENT_W / cols);
  const widths = Array(cols).fill(colW);
  widths[cols - 1] = CONTENT_W - colW * (cols - 1);
  const mkCell = (txt, head, idx) => new TableCell({
    borders,
    width: { size: widths[idx], type: WidthType.DXA },
    shading: head ? { fill: 'D5E8F0', type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: runs(txt) })],
  });
  const rows = [];
  rows.push(new TableRow({ children: header.map((h, idx) => mkCell(h, true, idx)) }));
  for (const r of bodyRows) {
    while (r.length < cols) r.push('');
    rows.push(new TableRow({ children: r.slice(0, cols).map((c, idx) => mkCell(c, false, idx)) }));
  }
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, rows });
}

for (let i = 0; i < lines.length; i += 1) {
  const raw = lines[i];
  const line = raw.replace(/\s+$/, '');
  if (line.trim() === '') continue;

  // Таблица
  if (line.trim().startsWith('|')) {
    const block = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i]); i += 1; }
    i -= 1;
    if (block.length >= 2) children.push(buildTable(block));
    children.push(new Paragraph({ children: [new TextRun('')] }));
    continue;
  }

  // Заголовки
  const h = line.match(/^(#{1,4})\s+(.*)$/);
  if (h) {
    const level = h[1].length - 1;
    children.push(new Paragraph({ heading: HEADINGS[level], children: runs(h[2]) }));
    continue;
  }

  // Маркированный список (уровень по отступу)
  const b = raw.match(/^(\s*)-\s+(.*)$/);
  if (b) {
    const level = Math.min(2, Math.floor(b[1].length / 2));
    children.push(new Paragraph({ numbering: { reference: 'bullets', level }, children: runs(b[2]) }));
    continue;
  }

  // Нумерованный пункт — сохраняем литеральный номер из md (без авто-нумерации,
  // чтобы не сбивать множественные независимые списки в документе).
  const n = raw.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (n) {
    children.push(new Paragraph({
      indent: { left: 480, hanging: 300 },
      spacing: { after: 40 },
      children: runs(`${n[2]}. ${n[3]}`),
    }));
    continue;
  }

  // Обычный абзац
  children.push(new Paragraph({ children: runs(line.trim()), spacing: { after: 80 } }));
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 34, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 160, after: 100 }, outlineLevel: 2 } },
      { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, italics: true, font: 'Arial' }, paragraph: { spacing: { before: 120, after: 80 }, outlineLevel: 3 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 480, hanging: 280 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 960, hanging: 280 } } } },
        { level: 2, format: LevelFormat.BULLET, text: '▪', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 280 } } } },
      ] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log('OK', OUT, buf.length, 'bytes'); });
