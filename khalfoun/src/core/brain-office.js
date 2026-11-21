// The brain's part for writing and drawing: composing with the cloud brain, writing the
// person's own words into Word/PowerPoint/Excel, drawing shapes and diagrams, formatting,
// equations, and the pen on the screen. Every change to a document goes through the brain's
// plan() so permissions apply exactly as for any other action.

import { KINDS, APP_LABEL, SHAPES, COLORS, cleanPlan } from './office-plan.js';
import { toArabicDigitsAll, toLatinDigits } from './office-math.js';

/** Numbers the way the teacher chose: Arabic (١٢٣) or Latin (123). */
const inDigits = (b, t) => (digitsOf(b) === 'arabic' ? toArabicDigitsAll(t) : toLatinDigits(t).replace(/٫/g, '.'));

const WAIT_TOPIC_MS = 60000;
const FORMAT_LABEL = {
  bold: 'الخط العريض', italic: 'الخط المائل', underline: 'الخط تحت الكلام', grow: 'تكبير الخط', shrink: 'تصغير الخط', center: 'التوسيط',
  right: 'المحاذاة لليمين', left: 'المحاذاة لليسار', heading: 'العنوان', bullets: 'النقاط', numbers: 'الترقيم', highlight: 'التظليل', color: 'لون الخط', size: 'حجم الخط',
};

export const digitsOf = (b) => (b.memory.data.writeDigits === 'latin' ? 'latin' : 'arabic');

function composeReply(b, s, now) {
  const req = { kind: s.kind, topic: s.topic, app: s.app, count: s.count || null, fresh: Boolean(s.fresh), raw: s.raw || s.topic, digits: digitsOf(b) };
  b.emotions.feel('working', now);
  b.composing = { ...req, at: now };
  const what = KINDS[s.kind]?.ar || 'المحتوى';
  return { ...b.reply('compose_working', { vars: { what, topic: s.topic, app: APP_LABEL[s.app] || 'الوورد' } }), compose: req };
}

/** Handles the writing/drawing intents; undefined when not one of them. */
export function routeOffice(b, r, raw, now) {
  const s = r.slots || {};
  switch (r.intent) {
    case 'compose': {
      if (s.vague || !s.topic) {
        b.composeWaiting = { kind: s.kind, app: s.app, count: s.count, fresh: s.fresh, at: now };
        b.emotions.feel('curious', now);
        return b.reply('compose_what', { vars: { what: KINDS[s.kind]?.ar || 'المحتوى' } });
      }
      return composeReply(b, s, now);
    }
    case 'office_write': {
      const text = inDigits(b, s.text);
      const plan = { kind: 'text', title: '', blocks: [{ type: s.style === 'heading' ? 'heading' : 'paragraph', text }] };
      return b.plan({ type: 'office_put', params: { app: s.app, plan, fresh: false, verbatim: true, digits: digitsOf(b) } },
        { situation: 'office_written', sayOn: 'result', vars: { app: APP_LABEL[s.app] }, summary: `كتابة في ${APP_LABEL[s.app]}`, confirmWhat: `أكتب في ${APP_LABEL[s.app]}` }, now);
    }
    case 'draw_shape':
      return b.plan({ type: 'office_draw', params: { app: s.app || null, shape: s.shape, color: s.color || null, count: s.count || 1, text: s.text || '' } },
        { situation: 'office_drawn', sayOn: 'result', vars: { shape: SHAPES[s.shape].ar }, draw: { shape: s.shape, color: s.color, count: s.count || 1, text: s.text || '' }, summary: `رسم ${SHAPES[s.shape].ar}`, confirmWhat: `أرسم ${SHAPES[s.shape].ar}` }, now);
    case 'office_format':
      return b.plan({ type: 'office_format', params: { op: s.op, ...(s.value !== undefined ? { value: s.value } : {}) } },
        { situation: 'office_formatted', sayOn: 'result', vars: { what: FORMAT_LABEL[s.op] || 'التنسيق' }, summary: FORMAT_LABEL[s.op] || 'تنسيق', confirmWhat: FORMAT_LABEL[s.op] || 'التنسيق' }, now);
    case 'office_slide':
      return b.plan({ type: 'office_slide', params: { title: s.title || '' } },
        { situation: 'office_slide_added', sayOn: 'result', summary: 'شريحة جديدة', confirmWhat: 'أضيف شريحة' }, now);
    case 'office_pdf':
      return b.plan({ type: 'office_pdf', params: {} }, { situation: 'office_pdf_saved', sayOn: 'result', summary: 'حفظ PDF' }, now);
    case 'office_equation': {
      const text = inDigits(b, s.text);
      return b.plan({ type: 'office_equation', params: { app: s.app || null, text } },
        { situation: 'office_equation_done', sayOn: 'result', vars: { eq: text }, screenText: text, summary: 'كتابة معادلة', confirmWhat: 'أكتب المعادلة' }, now);
    }
    case 'screen_find':
      b.emotions.feel('focus_mode', now);
      return b.plan({ type: 'find_on_screen', params: { text: s.text } },
        { situation: 'screen_finding', sayOn: 'start', vars: { word: s.text }, find: { text: s.text, mark: s.mark || 'circle', color: s.color || 'red' },
          summary: `البحث عن «${s.text}» في الشاشة`, confirmWhat: `أقرأ الشاشة وأعلّم على «${s.text}»` }, now);
    case 'office_circle':
      return b.plan({ type: 'office_circle', params: {} }, { situation: 'office_circled', sayOn: 'result', summary: 'دائرة حول المحدد', confirmWhat: 'أرسم دائرة حول المحدد' }, now);
    case 'screen_write': {
      b.emotions.feel('focus_mode', now);
      const text = inDigits(b, s.text);
      return { ...b.reply('screen_written'), ink: { text } };
    }
    case 'screen_draw':
      b.emotions.feel('focus_mode', now);
      return { ...b.reply('screen_drawn', { vars: { shape: SHAPES[s.shape].ar } }), ink: { shape: s.shape, color: s.color, count: s.count || 1, text: s.text || '' } };
    case 'screen_pen':
      if (s.color || s.width) {
        b.emotions.feel('curious', now);
        const r = s.color ? b.reply('pen_color', { vars: { color: COLORS[s.color]?.ar || '' } }) : b.reply(s.width >= 8 ? 'pen_thick' : 'pen_thin');
        return { ...r, pen: true, penStyle: { color: s.color || null, width: s.width || null } };
      }
      b.emotions.feel(s.on ? 'curious' : 'success', now);
      return { ...b.reply(s.on ? 'pen_on' : 'pen_off'), pen: Boolean(s.on) };
    case 'screen_clear':
      return { ...b.reply('screen_cleared'), ink: { clear: true }, effect: 'none' };
    case 'set_digits':
      b.memory.set({ writeDigits: s.digits });
      return b.reply(s.digits === 'arabic' ? 'digits_arabic' : 'digits_latin');
    default:
      return undefined;
  }
}

/** While he waits for «عن شو؟» after «سو عرض». Returns a reply or null. */
export function composeTopicTurn(b, r, raw, now) {
  const w = b.composeWaiting;
  if (!w) return null;
  b.composeWaiting = null;
  if (now - w.at > WAIT_TOPIC_MS) return null;
  if (!['unknown', 'open_unknown'].includes(r.intent)) return null; // a real command: do that instead
  const topic = String(raw).trim().replace(/^(?:عن|حول|بخصوص|موضوع)\s+/u, '').slice(0, 200);
  if (topic.length < 2) return null;
  return composeReply(b, { kind: w.kind, topic, app: w.app, count: w.count, fresh: w.fresh, raw: `${KINDS[w.kind]?.ar || ''} عن ${topic}` }, now);
}

/**
 * The cloud brain finished writing. `res`: {ok, plan?, error?}. Builds the document action,
 * or says why not.
 */
export function composed(b, req, res, now) {
  b.composing = null;
  if (!res?.ok) {
    b.emotions.feel('error', now);
    const sit = res?.error === 'no_cloud' ? 'compose_no_cloud' : res?.error === 'bad_key' || res?.error === 'no_credit' ? 'cloud_bad_key' : 'compose_failed';
    return b.reply(sit);
  }
  // The plan is checked again here: nothing from the model is trusted as-is.
  const plan = res.plan && cleanPlan(res.plan.kind, res.plan.raw || res.plan);
  if (!plan) { b.emotions.feel('error', now); return b.reply('compose_failed'); }
  const app = req.app || KINDS[req.kind]?.app || 'word';
  return b.plan({ type: 'office_put', params: { app, plan, fresh: Boolean(req.fresh), digits: digitsOf(b) } },
    { situation: 'office_composed', sayOn: 'result', vars: { what: KINDS[req.kind]?.ar || 'المحتوى', app: APP_LABEL[app] }, summary: `${KINDS[req.kind]?.ar || 'كتابة'} في ${APP_LABEL[app]}`, confirmWhat: `أكتب ${KINDS[req.kind]?.ar || 'المحتوى'} في ${APP_LABEL[app]}` }, now);
}

/**
 * After an office action: which reply fits the result («كتبتها في ملف جديد», «ما لقيت وورد مفتوح» ...).
 * Returns a reply, or undefined to let the brain use its normal result reply.
 */
export function officeResult(b, spec, result, now) {
  const type = spec.action.type;
  if (type === 'find_on_screen') {
    const word = spec.find?.text || '';
    if (!result?.ok) {
      b.emotions.feel('error', now);
      if (result?.error === 'unsupported') return b.reply('screen_unsupported');
      if (result?.error === 'no_ocr_language') return b.reply('screen_no_language');
      return b.reply('screen_failed');
    }
    const boxes = result.data?.boxes || [];
    if (!boxes.length) { b.emotions.feel('not_understood', now); return b.reply('screen_find_none', { vars: { word } }); }
    b.markSuccess(now);
    b.emotions.feel('success', now);
    return { ...b.reply(boxes.length === 1 ? 'screen_found' : 'screen_found_many', { vars: { word, count: String(boxes.length) } }),
      ink: { marks: boxes, mark: spec.find.mark, color: spec.find.color } };
  }
  if (!/^office_/.test(type)) return undefined;
  if (!result?.ok) {
    // No Office app in front: draw or write on the screen instead.
    if (result?.error === 'no_office' && type === 'office_draw' && spec.draw) {
      b.emotions.feel('focus_mode', now);
      return { ...b.reply('screen_drawn', { vars: { shape: SHAPES[spec.draw.shape].ar } }), ink: { ...spec.draw } };
    }
    if (result?.error === 'no_office' && type === 'office_equation' && spec.screenText) {
      return { ...b.reply('screen_written'), ink: { text: spec.screenText } };
    }
    // «دور عليه» with no Office in front: a red circle on the screen where the mouse is.
    if (result?.error === 'no_office' && type === 'office_circle') {
      return { ...b.reply('screen_circled'), ink: { shape: 'circle', color: 'red', count: 1, text: '', at: 'pointer', outline: true } };
    }
    if (result?.error === 'no_office') { b.emotions.feel('not_understood', now); return b.reply('office_none'); }
    if (result?.error === 'no_selection') { b.emotions.feel('not_understood', now); return b.reply('office_need_selection'); }
    if (result?.error === 'no_office_installed') { b.emotions.feel('error', now); return b.reply('office_not_installed'); }
    return undefined;
  }
  const d = result.data || {};
  b.markSuccess(now);
  b.emotions.feel('success', now);
  if (d.mode === 'file') return b.reply('office_new_file', { vars: { ...(spec.vars || {}), app: APP_LABEL[d.app] || spec.vars?.app || '' } });
  if (d.mode === 'pasted') return b.reply('office_pasted', { vars: spec.vars || {} });
  if (d.mode === 'keys') return b.reply('office_formatted_keys', { vars: spec.vars || {} });
  return undefined;
}

export const COLOR_NAMES = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, v.ar]));
