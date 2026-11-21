// Excel workbooks (.xlsx) from a checked table plan: a right-to-left sheet, a title row,
// a coloured header, numbers kept as numbers, column widths, and a frozen header.

import JSZip from 'jszip';
import { THEME } from './theme.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const col = (i) => { let s = ''; let n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** «١٢» or «12» or «3.5» → a number for Excel; anything else stays text. */
function asNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = String(v ?? '').trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace('٫', '.');
  return /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

function cell(ref, value, style) {
  const n = asNumber(value);
  if (n !== null) return `<c r="${ref}" s="${style}"><v>${n}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

/**
 * @param {{title?: string, columns: string[], rows: any[][]}} plan
 * @returns {Promise<Buffer>}
 */
export async function buildXlsx(plan) {
  const cols = plan.columns.length;
  const rows = [];
  let r = 1;
  if (plan.title) {
    rows.push(`<row r="${r}" ht="30" customHeight="1">${cell(`A${r}`, plan.title, 1)}</row>`);
    r += 2;
  }
  const headRow = r;
  rows.push(`<row r="${r}" ht="24" customHeight="1">${plan.columns.map((c, i) => cell(`${col(i)}${r}`, c, 2)).join('')}</row>`);
  r += 1;
  for (const row of plan.rows) {
    rows.push(`<row r="${r}">${row.map((c, i) => cell(`${col(i)}${r}`, c, (r - headRow) % 2 ? 3 : 4)).join('')}</row>`);
    r += 1;
  }
  const widths = plan.columns.map((c, i) => Math.min(50, Math.max(10, ...[c, ...plan.rows.map((x) => x[i])].map((v) => String(v ?? '').length * 1.3 + 4))));
  const merge = plan.title && cols > 1 ? `<mergeCells count="1"><mergeCell ref="A1:${col(cols - 1)}1"/></mergeCells>` : '';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="20"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>${merge}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="12"/><name val="${THEME.headFont}"/></font><font><b/><sz val="16"/><color rgb="FF${THEME.primary}"/><name val="${THEME.headFont}"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="${THEME.headFont}"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${THEME.primary}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBF7EE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF${THEME.sandDark}"/></left><right style="thin"><color rgb="FF${THEME.sandDark}"/></right><top style="thin"><color rgb="FF${THEME.sandDark}"/></top><bottom style="thin"><color rgb="FF${THEME.sandDark}"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(plan.title || 'خلفون')}</dc:title><dc:creator>خلفون</dc:creator></cp:coreProperties>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${esc(String(plan.title || 'ورقة1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/worksheets/sheet1.xml', sheet);
  zip.file('xl/styles.xml', styles);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Any plan as a table: tables as they are; other kinds as one column of lines. */
export function planAsTable(plan, lines) {
  if (plan.kind === 'table') return plan;
  return { title: plan.title, columns: [plan.title || 'المحتوى'], rows: lines.filter(Boolean).map((l) => [l]) };
}
