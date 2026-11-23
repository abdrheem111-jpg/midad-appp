// Khalfoun's hands, as tools Claude calls: seeing the screen, the mouse and keyboard, writing
// and drawing on the screen and in Office, the classroom features, memory, feelings, and
// asking the teacher before anything risky. Every action still goes through the executor's
// double check (validateAction + decide), like the rest of Khalfoun.
//
// Coordinates: Claude works in the picture look_screen returns (pixels from its top-left).
// `ctx.screen` turns them into physical screen pixels (mouse) and overlay pixels (ink).

import { z } from 'zod';
import { FEELINGS, keysNeedConsent } from '../../core/claude-persona.js';
import { SHAPES, COLORS, cleanPlan, KINDS } from '../../core/office-plan.js';
import { OFFICE_FORMATS } from '../actions/index.js';
import { APPS } from '../../core/intents.js';

const text = (t) => ({ content: [{ type: 'text', text: String(t) }] });
const fail = (t) => ({ content: [{ type: 'text', text: String(t) }], isError: true });
const SHAPE_IDS = Object.keys(SHAPES);
const COLOR_IDS = Object.keys(COLORS);
const APP_LIST = APPS.filter((a) => a.kind === 'app').map((a) => a.id);

/** Why an action failed, said plainly to Claude so it can try another way. */
function why(res) {
  const e = String(res?.error || 'failed');
  const map = {
    no_office: 'ما فيه وورد/بوربوينت/إكسل مفتوح.', not_running: 'البرنامج مو شغال.', no_selection: 'ما فيه شي محدد.',
    off_screen: 'النقطة خارج الشاشة.', bad_point: 'إحداثيات غير صحيحة.', bad_key: 'اسم مفتاح غير معروف.', unsupported: 'هذا الجهاز ما يدعم هالعملية.',
    not_installed: 'البرنامج مو مثبت.', level_too_low: 'مستوى الصلاحيات ما يسمح.', timeout: 'تأخر وما رد.',
  };
  return map[e] || e;
}

/**
 * @param {object} ctx
 * @param {(action: object) => Promise<{ok: boolean, data?: any, error?: string}>} ctx.run the executor
 * @param {(o?: {zoom?: object}) => Promise<object>} ctx.look a screenshot with words and their places
 * @param {(t: string) => Promise<object>} ctx.find word boxes on screen (picture coordinates)
 * @param {{toPhysical: Function, toOverlay: Function, size: () => {width: number, height: number}}} ctx.screen
 * @param {(kind: string, payload: object, timeoutMs?: number) => Promise<any>} ctx.ui asks the page (ink, feelings, questions, classroom, memory)
 * @param {(ms: number) => Promise<void>} [ctx.sleep]
 * @param {(...a: any[]) => void} [ctx.log]
 * @returns {Array<{name: string, description: string, schema: object, handler: Function}>}
 */
export function khalfounTools(ctx) {
  const sleep = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = ctx.log || (() => {});
  const P = (x, y) => ctx.screen.toPhysical(x, y);
  const act = async (action, okText) => {
    const res = await ctx.run(action);
    log('claude action', action.type, res.ok ? 'ok' : `failed: ${res.error}`);
    if (!res.ok) return fail(`ما زبط: ${why(res)}`);
    return text(`${okText || 'تم.'}${res.data?.window ? ` النافذة اللي انكتب فيها: ${res.data.window}` : ''}`);
  };
  const ask = async (question) => {
    const r = await ctx.ui('ask', { question }, 60000);
    return r?.answer === 'yes';
  };

  const tools = [
    {
      name: 'feel',
      description: 'Show Khalfoun\'s feeling on his face and body before speaking (once per reply, or when the feeling changes). He is a living character: be genuine.',
      schema: { feeling: z.enum(FEELINGS) },
      handler: async ({ feeling }) => { ctx.ui('feel', { feeling }, 2000).catch(() => {}); return text('ok'); },
    },
    {
      name: 'look_screen',
      description: 'See the teacher\'s whole screen now: a picture plus the text Windows reads on it with each line\'s position (x,y width×height) in the same picture pixels, the mouse position and the window in front. All coordinates for other tools are in this picture\'s pixels. Use zoom {x,y,w,h} to see a small area in more detail (coordinates stay in the full picture).',
      schema: { zoom: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional() },
      handler: async ({ zoom }) => {
        const r = await ctx.look({ zoom });
        if (!r?.ok) return fail(`ما قدرت أشوف الشاشة: ${why(r)}`);
        const lines = [
          `الصورة ${r.width}×${r.height}${zoom ? ` (تكبير للمنطقة ${Math.round(zoom.x)},${Math.round(zoom.y)} ${Math.round(zoom.w)}×${Math.round(zoom.h)}؛ الإحداثيات تبقى بنظام الشاشة الكاملة ${r.full.width}×${r.full.height})` : ''}.`,
          r.window ? `النافذة قدام: ${r.window}` : '',
          r.cursor ? `الماوس عند (${r.cursor.x},${r.cursor.y}).` : '',
          r.layout ? `النص اللي على الشاشة ومواقعه:\n${r.layout}` : 'ما قريت نص على الشاشة.',
        ].filter(Boolean);
        return { content: [{ type: 'image', data: r.data, mimeType: r.mime }, { type: 'text', text: lines.join('\n') }] };
      },
    },
    {
      name: 'find_text',
      description: 'Find a word or a few words on the screen exactly: returns each place as a box (x,y,w,h) in look_screen picture pixels. Use it before clicking on, circling, underlining or highlighting text.',
      schema: { text: z.string().min(1).max(60) },
      handler: async ({ text: t }) => {
        const r = await ctx.find(t);
        if (!r?.ok) return fail(`ما قدرت أقرأ الشاشة: ${why(r)}`);
        if (!r.boxes.length) return text(`ما لقيت «${t}» في الشاشة.`);
        return text(r.boxes.map((b, i) => `${i + 1}) «${b.text}» عند x=${b.x} y=${b.y} w=${b.w} h=${b.h}`).join('\n'));
      },
    },
    {
      name: 'click',
      description: 'Click at a point (look_screen picture pixels). clicks: 2 for double click, 3 to select a paragraph. modifiers like "ctrl" or "shift".',
      schema: { x: z.number(), y: z.number(), button: z.enum(['left', 'right', 'middle']).optional(), clicks: z.number().int().min(1).max(3).optional(), modifiers: z.string().max(20).optional() },
      handler: async ({ x, y, button, clicks, modifiers }) => {
        const p = P(x, y);
        const res = await act({ type: 'mouse_click', params: { x: p.x, y: p.y, ...(button ? { button } : {}), ...(clicks ? { clicks } : {}), ...(modifiers ? { modifiers: modifiers.toLowerCase().replace(/\s/g, '') } : {}) } }, 'نقرت.');
        await sleep(250);
        return res;
      },
    },
    {
      name: 'move_mouse',
      description: 'Move the mouse to a point (picture pixels), e.g. to show something or hover.',
      schema: { x: z.number(), y: z.number() },
      handler: async ({ x, y }) => { const p = P(x, y); return act({ type: 'mouse_move', params: { x: p.x, y: p.y } }, 'حركت الماوس.'); },
    },
    {
      name: 'drag',
      description: 'Press, drag and release the mouse from one point to another (select text, move things, draw a line in a drawing app).',
      schema: { from_x: z.number(), from_y: z.number(), to_x: z.number(), to_y: z.number() },
      handler: async (a) => {
        const p1 = P(a.from_x, a.from_y); const p2 = P(a.to_x, a.to_y);
        return act({ type: 'mouse_drag', params: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y } }, 'سحبت.');
      },
    },
    {
      name: 'scroll',
      description: 'Scroll with the mouse wheel at a point.',
      schema: { x: z.number(), y: z.number(), direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().int().min(1).max(30).optional() },
      handler: async ({ x, y, direction, amount }) => { const p = P(x, y); return act({ type: 'mouse_scroll', params: { x: p.x, y: p.y, direction, amount: amount || 3 } }, 'سكرولت.'); },
    },
    {
      name: 'type_text',
      description: 'Type text where the keyboard focus is now (Arabic and English, new lines allowed). Click the right place first.',
      schema: { text: z.string().min(1).max(2000) },
      handler: async ({ text: t }) => act({ type: 'type_text', params: { text: t, here: true } }, 'كتبت.'),
    },
    {
      name: 'press_keys',
      description: 'Press a key or shortcut like "enter", "ctrl+s", "ctrl+z", "alt+tab", "win", "f5", "ctrl+shift+n". times repeats it. Shortcuts that close or delete ask the teacher first.',
      schema: { keys: z.string().min(1).max(40), times: z.number().int().min(1).max(50).optional() },
      handler: async ({ keys, times }) => {
        const k = keys.toLowerCase().replace(/\s+/g, '').replace(/control/g, 'ctrl').replace(/escape/g, 'esc');
        if (keysNeedConsent(k) && !(await ask(`أضغط ${keys}؟ ممكن يسكّر أو يحذف شي.`))) return text('المعلم ما وافق، ما ضغطت.');
        return act({ type: 'key_combo', params: { keys: k, ...(times ? { times } : {}) } }, `ضغطت ${keys}.`);
      },
    },
    {
      name: 'open_app',
      description: `Open a program. Known ids: ${APP_LIST.join(', ')}. Any other installed program: give its name as in the Start menu (e.g. "Microsoft Teams", "GeoGebra").`,
      schema: { name: z.string().min(1).max(60) },
      handler: async ({ name }) => {
        const id = APP_LIST.find((a) => a === name.toLowerCase());
        const res = id ? await act({ type: 'open_app', params: { app: id } }, `فتحت ${name}.`) : await act({ type: 'open_installed', params: { name } }, `فتحت ${name}.`);
        await sleep(1200);
        return res;
      },
    },
    {
      name: 'open_website',
      description: 'Open an https web page in the teacher\'s browser.',
      schema: { url: z.string().url().max(2000) },
      handler: async ({ url }) => act({ type: 'open_web', params: { url } }, 'فتحت الصفحة.'),
    },
    {
      name: 'screen_write',
      description: 'Write text ON the screen itself (a transparent board over everything, like a smart pen). x,y = the CENTRE of the text in picture pixels (e.g. top middle of a 1568-wide picture: x=784, y=80). Without x,y it goes near the middle top. size = letter height in picture pixels (default about 40). Use for writing on a PDF, a picture, a slide being shown, or anything not editable. No need to look first unless the place depends on what is on the screen.',
      schema: { text: z.string().min(1).max(300), x: z.number().optional(), y: z.number().optional(), size: z.number().min(12).max(160).optional(), color: z.enum(COLOR_IDS).optional() },
      handler: async (a) => {
        const at = a.x !== undefined && a.y !== undefined ? ctx.screen.toOverlay(a.x, a.y) : null;
        await ctx.ui('ink', { op: 'write', text: a.text, at, anchor: 'center', size: a.size ? Math.round(a.size * ctx.screen.pictureScale()) : null, color: a.color || 'blue' });
        return text('كتبت على الشاشة.');
      },
    },
    {
      name: 'screen_draw',
      description: `Draw a hand-drawn shape ON the screen in a box (picture pixels): ${SHAPE_IDS.join(', ')}. label writes text inside.`,
      schema: { shape: z.enum(SHAPE_IDS), x: z.number(), y: z.number(), w: z.number().min(4), h: z.number().min(4), color: z.enum(COLOR_IDS).optional(), label: z.string().max(40).optional() },
      handler: async (a) => {
        const box = ctx.screen.boxToOverlay(a);
        await ctx.ui('ink', { op: 'shape', shape: a.shape, box, color: a.color || 'red', label: a.label || '' });
        return text('رسمت.');
      },
    },
    {
      name: 'screen_mark',
      description: 'Mark something ON the screen where it is: circle, underline or highlight a box (picture pixels, usually from find_text).',
      schema: { x: z.number(), y: z.number(), w: z.number().min(1), h: z.number().min(1), kind: z.enum(['circle', 'underline', 'highlight']), color: z.enum(COLOR_IDS).optional() },
      handler: async (a) => {
        const box = ctx.screen.boxToOverlay(a);
        await ctx.ui('ink', { op: 'mark', boxes: [box], mark: a.kind, color: a.color || (a.kind === 'highlight' ? 'yellow' : 'red') });
        return text('علّمت عليه.');
      },
    },
    {
      name: 'screen_clear',
      description: 'Erase everything Khalfoun wrote or drew on the screen.',
      schema: {},
      handler: async () => { await ctx.ui('ink', { op: 'clear' }); return text('مسحت.'); },
    },
    {
      name: 'office_write',
      description: 'Write into the open Word / PowerPoint / Excel (where the cursor is), or create a new nicely designed file (new_file true, or nothing open). For Word: blocks of heading/paragraph/bullets/numbered, and questions [{q, choices?, answer?, lines?}] for worksheets and quizzes (answer key goes on its own page). For PowerPoint: slides [{title, bullets}]. For Excel or a table: columns + rows. Arabic right to left, digits Arabic by default.',
      schema: {
        app: z.enum(['word', 'powerpoint', 'excel']),
        kind: z.enum(Object.keys(KINDS)).optional(),
        title: z.string().max(120).optional(),
        blocks: z.array(z.object({ type: z.enum(['heading', 'paragraph', 'bullets', 'numbered']), text: z.string().max(2000).optional(), items: z.array(z.string().max(300)).max(15).optional() })).max(40).optional(),
        questions: z.array(z.object({ q: z.string().max(400), choices: z.array(z.string().max(120)).max(6).optional(), answer: z.string().max(200).optional(), lines: z.number().int().min(0).max(4).optional() })).max(30).optional(),
        slides: z.array(z.object({ title: z.string().max(90), bullets: z.array(z.string().max(160)).max(7).optional() })).max(15).optional(),
        columns: z.array(z.string().max(60)).max(8).optional(),
        rows: z.array(z.array(z.union([z.string().max(120), z.number()]))).max(60).optional(),
        new_file: z.boolean().optional(),
        digits: z.enum(['arabic', 'latin']).optional(),
        exact: z.boolean().optional().describe('true when the teacher dictated the exact words'),
      },
      handler: async (a) => {
        const kind = a.slides ? 'slides' : a.columns ? 'table' : (a.kind && !['slides', 'table', 'diagram'].includes(a.kind) ? a.kind : (a.questions ? 'worksheet' : 'text'));
        const plan = cleanPlan(kind, { title: a.title || '', blocks: a.blocks || [], questions: a.questions || [], slides: a.slides || [], columns: a.columns || [], rows: a.rows || [] });
        if (!plan) return fail('المحتوى فاضي أو ناقص.');
        const res = await ctx.run({ type: 'office_put', params: { app: a.app, plan, fresh: Boolean(a.new_file), verbatim: Boolean(a.exact), digits: a.digits || 'arabic' } });
        if (!res.ok) return fail(`ما انكتب: ${why(res)}`);
        const m = res.data?.mode;
        return text(m === 'file' ? `انعمل ملف جديد وانفتح${res.data?.file ? `: ${res.data.file}` : ''}.` : m === 'pasted' ? 'انلصق في البرنامج.' : 'انكتب في المستند المفتوح.');
      },
    },
    {
      name: 'office_equation',
      description: 'Write a maths equation into the open Word/PowerPoint at the cursor, already in symbols, e.g. "س + ٢ = ٥" or "x² + 3x = 10".',
      schema: { text: z.string().min(1).max(300) },
      handler: async ({ text: t }) => act({ type: 'office_equation', params: { app: null, text: t } }, 'كتبت المعادلة.'),
    },
    {
      name: 'office_format',
      description: `Format the selected text in Word/PowerPoint/Excel: ${[...OFFICE_FORMATS].join(', ')}. value: size in points for "size", a colour id for "color" (${COLOR_IDS.join(', ')}). Select the text first (click, drag or ctrl+a).`,
      schema: { op: z.enum([...OFFICE_FORMATS]), value: z.union([z.number(), z.string()]).optional() },
      handler: async ({ op, value }) => act({ type: 'office_format', params: { op, ...(value !== undefined ? { value: op === 'size' ? Math.round(Number(value)) : value } : {}) } }, 'نسّقته.'),
    },
    {
      name: 'office_draw',
      description: `Draw shapes into the open Word/PowerPoint/Excel: ${SHAPE_IDS.join(', ')}.`,
      schema: { shape: z.enum(SHAPE_IDS), color: z.enum(COLOR_IDS).optional(), count: z.number().int().min(1).max(12).optional(), text: z.string().max(80).optional() },
      handler: async (a) => act({ type: 'office_draw', params: { app: null, shape: a.shape, color: a.color || null, count: a.count || 1, text: a.text || '' } }, 'رسمت في المستند.'),
    },
    {
      name: 'office_pdf',
      description: 'Save the open Word/PowerPoint/Excel document as a PDF (Documents\\خلفون) and open it.',
      schema: {},
      handler: async () => {
        const res = await ctx.run({ type: 'office_pdf', params: {} });
        return res.ok ? text(`انحفظ PDF${res.data?.file ? `: ${res.data.file}` : ''}.`) : fail(`ما زبط: ${why(res)}`);
      },
    },
    {
      name: 'classroom',
      description: 'Run one of Khalfoun\'s ready classroom features with a short Arabic command, e.g. «لف العجلة», «احتفل», «العاب نارية», «مؤقت ٥ دقايق», «غايب أحمد», «منو غايب اليوم», «نجمة لمريم», «لغز», «سباق الهجن», «مقياس الهدوء», «وضع الصف», «افتح السبورة», «اختبار القراءة», «اختبر السمع», «ذكرني بعد ١٠ دقايق». Returns what happened.',
      schema: { command: z.string().min(1).max(120) },
      handler: async ({ command }) => {
        const r = await ctx.ui('classroom', { command }, 15000);
        if (!r) return fail('ما رد.');
        return r.understood ? text(`تم: ${r.say || r.situation || ''}`) : fail(`هالأمر مو من ميزات الصف الجاهزة (${r.situation}).`);
      },
    },
    {
      name: 'remember',
      description: 'Remember something lasting the teacher said about himself, his school, classes or students (it will appear in your context next time). Not passwords or private numbers.',
      schema: { fact: z.string().min(2).max(200) },
      handler: async ({ fact }) => { await ctx.ui('remember', { fact }); return text('حفظتها.'); },
    },
    {
      name: 'ask_user',
      description: 'Ask the teacher a yes/no question and wait for the answer (by voice or button). Required before deleting, closing unsaved work, sending, paying, installing or changing settings.',
      schema: { question: z.string().min(3).max(200) },
      handler: async ({ question }) => {
        const r = await ctx.ui('ask', { question }, 60000);
        return text(r?.answer === 'yes' ? 'المعلم قال: نعم.' : r?.answer === 'no' ? 'المعلم قال: لا.' : 'ما رد المعلم.');
      },
    },
    {
      name: 'wait',
      description: 'Wait a few seconds (a program is opening, a page is loading).',
      schema: { seconds: z.number().min(0.2).max(10) },
      handler: async ({ seconds }) => { await sleep(seconds * 1000); return text('انتظرت.'); },
    },
  ];
  return tools;
}

/** The tools as an in-process MCP server for the Claude Agent SDK. */
export function khalfounServer(sdk, tools) {
  return sdk.createSdkMcpServer({
    name: 'khalfoun',
    version: '2.0.0',
    tools: tools.map((t) => sdk.tool(t.name, t.description, t.schema, async (args) => {
      try { return await t.handler(args); } catch (err) { return fail(`خطأ: ${String(err?.message || err).slice(0, 200)}`); }
    })),
  });
}
