import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pdfLib from 'pdf-lib';
import { findLatestPdf, copyName, overlayHtml, stampPdf, writeIntoLatestPdf } from '../src/main/actions/pdf.js';
import { recognize } from '../src/core/intents.js';
import { validateAction } from '../src/main/actions/index.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';

const { PDFDocument, StandardFonts } = pdfLib;

async function makePdf(file, pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([595, 842]);
  await writeFile(file, await doc.save());
}

async function latinOverlay(size) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([size.width, size.height]);
  page.drawText('Khalfoun', { x: 40, y: size.height - 60, size: 16, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

test('the newest PDF is picked; other files and folders are ignored', async () => {
  const a = await mkdtemp(join(tmpdir(), 'kf-pdf-a-'));
  const b = await mkdtemp(join(tmpdir(), 'kf-pdf-b-'));
  await makePdf(join(a, 'قديم.pdf'));
  await makePdf(join(b, 'جديد.PDF'));
  await writeFile(join(b, 'صورة.png'), 'x');
  const old = new Date(Date.now() - 3600e3);
  await utimes(join(a, 'قديم.pdf'), old, old);
  assert.equal(await findLatestPdf([a, b, '/nope']), join(b, 'جديد.PDF'));
  assert.equal(await findLatestPdf(['/nope']), null);
  await rm(a, { recursive: true, force: true });
  await rm(b, { recursive: true, force: true });
});

test('copies get a clear name and never overwrite', async () => {
  const d = await mkdtemp(join(tmpdir(), 'kf-pdf-n-'));
  const src = join(d, 'تقرير.pdf');
  assert.equal(await copyName(src), join(d, 'تقرير - خلفون.pdf'));
  await writeFile(join(d, 'تقرير - خلفون.pdf'), 'x');
  assert.equal(await copyName(src), join(d, 'تقرير - خلفون (2).pdf'));
  assert.equal(await copyName(join(d, 'تقرير - خلفون.pdf')), join(d, 'تقرير - خلفون (2).pdf'), 'no double suffix');
  await rm(d, { recursive: true, force: true });
});

test('overlay HTML escapes text, sizes the page and places top or bottom', () => {
  const h = overlayHtml({ width: 595, height: 842, text: '<b>اسم</b> & توقيع', position: 'bottom' });
  assert.ok(h.includes('&lt;b&gt;اسم&lt;/b&gt; &amp; توقيع'));
  assert.ok(h.includes('size: 595pt 842pt'));
  assert.ok(h.includes('bottom: 48pt'));
  assert.ok(overlayHtml({ width: 100, height: 100, text: 'x', position: 'top' }).includes('top: 44pt'));
  assert.ok(h.includes('dir="rtl"'));
});

test('stamping keeps every page, writes a new file and leaves the original untouched', async () => {
  const d = await mkdtemp(join(tmpdir(), 'kf-pdf-s-'));
  const src = join(d, 'نموذج.pdf');
  await makePdf(src, 3);
  const before = await readFile(src);
  const out = await stampPdf(src, await latinOverlay({ width: 595, height: 842 }));
  assert.equal(out, join(d, 'نموذج - خلفون.pdf'));
  assert.deepEqual(await readFile(src), before, 'original unchanged');
  const result = await PDFDocument.load(await readFile(out));
  assert.equal(result.getPageCount(), 3);
  assert.ok((await readFile(out)).length > before.length);
  await rm(d, { recursive: true, force: true });
});

test('the whole action reports missing or broken PDFs instead of failing', async () => {
  const d = await mkdtemp(join(tmpdir(), 'kf-pdf-w-'));
  const render = async (html, size) => latinOverlay(size);
  assert.deepEqual(await writeIntoLatestPdf({ dirs: [d], text: 'x', position: 'top', render }), { ok: false, error: 'no_pdf' });
  await writeFile(join(d, 'خربان.pdf'), 'not a pdf');
  assert.deepEqual(await writeIntoLatestPdf({ dirs: [d], text: 'x', position: 'top', render }), { ok: false, error: 'pdf_unreadable' });
  await rm(join(d, 'خربان.pdf'));
  await makePdf(join(d, 'سليم.pdf'));
  let seenHtml = '';
  const res = await writeIntoLatestPdf({ dirs: [d], text: 'مرحبا', position: 'top', render: async (html, size) => { seenHtml = html; return latinOverlay(size); } });
  assert.equal(res.ok, true);
  assert.ok(res.data.file.endsWith('سليم - خلفون.pdf'));
  assert.ok(seenHtml.includes('مرحبا'));
  await rm(d, { recursive: true, force: true });
});

for (const [text, intent, slots] of [
  ['اكتب اسمي عبدالرحيم في ملف البي دي اف', 'pdf_write', { text: 'اسمي عبدالرحيم', position: 'top' }],
  ['اكتب تمت المراجعة في الـ pdf تحت', 'pdf_write', { text: 'تمت المراجعة', position: 'bottom' }],
  ['اكتب موافق في ملف pdf', 'pdf_write', { text: 'موافق', position: 'top' }],
  ['وقع الملف', 'pdf_sign', { position: 'bottom' }],
  ['حط توقيعي فوق', 'pdf_sign', { position: 'top' }],
  ['اكتب السلام عليكم', 'type_text', { text: 'السلام عليكم' }],
]) {
  test(`pdf intent: "${text}" -> ${intent}`, () => {
    const r = recognize(text);
    assert.equal(r.intent, intent);
    for (const [k, v] of Object.entries(slots)) assert.equal(r.slots[k], v, k);
  });
}

test('main validates PDF actions', () => {
  assert.equal(validateAction({ type: 'pdf_write', params: { text: 'x', position: 'top' } }), null);
  assert.equal(validateAction({ type: 'pdf_write', params: { text: '', position: 'top' } }), 'bad_pdf');
  assert.equal(validateAction({ type: 'pdf_write', params: { text: 'x', position: 'middle' } }), 'bad_pdf');
});

test('brain: writing asks first at level 2, signing needs a name and uses today', () => {
  const now = new Date(2026, 10, 10, 9).getTime();
  const b = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 2, name: '' }, clock: () => now });
  const ask = b.hear('اكتب موافق في ملف البي دي اف');
  assert.equal(ask.awaitingConfirm, true);
  assert.match(ask.say, /نسخة جديدة/);
  const go = b.hear('ايوه');
  assert.deepEqual(go.action.params, { text: 'موافق', position: 'top' });
  assert.equal(b.actionResult(go.action.id, { ok: false, error: 'no_pdf' }).situation, 'pdf_none');
  assert.equal(b.hear('وقع الملف').situation, 'pdf_need_name');
  b.hear('اسمي سعيد');
  b.memory.set({ level: 3 });
  const sign = b.hear('وقع الملف');
  assert.match(sign.action.params.text, /^سعيد — /);
  assert.match(sign.action.params.text, /نوفمبر|تشرين/);
  assert.equal(b.actionResult(sign.action.id, { ok: true, data: { file: '/x - خلفون.pdf' } }).situation, 'pdf_ok');
  const kids = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 3, kidsMode: true }, clock: () => now });
  assert.equal(kids.hear('اكتب موافق في ملف البي دي اف').situation, 'kids_blocked');
});
