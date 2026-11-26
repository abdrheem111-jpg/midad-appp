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
import { cleanSketch, mathText, SKETCH_TYPES } from '../../core/math-sketch.js';
import { parse as parseExpr } from '../../core/math-expr.js';

/** «hwnd\tprocess\tstate\tx,y,w,h\ttitle» lines from the hands process. */
export function parseWindows(data) {
  return String(data || '').split('\n').map((l) => l.split('\t')).filter((f) => f.length >= 5 && /^\d+$/.test(f[0]))
    .map(([hwnd, proc, state, rect, ...t]) => ({ id: hwnd, program: proc, state, rect, title: t.join(' ') }))
    .filter((w) => !/^khalfoun$/i.test(w.program));
}

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
    no_file: 'الملف مو موجود أو مو في مجلداته.', bad_file: 'نوع الملف ما ينفتح من هني.',
    no_window: 'النافذة ما عادت موجودة.', bad_window: 'رقم نافذة غير صحيح.',
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
  // The teacher's digits (Omani schools: Arabic ٠١٢٣ and the unknowns س ص ع) unless he chose otherwise.
  const digitsNow = () => (ctx.digits?.() === 'latin' ? 'latin' : 'arabic');
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
      name: 'open_file',
      description: 'Find and open one of the teacher\'s own files (lesson PDFs, Word, PowerPoint, Excel, pictures, videos) from his Desktop, Documents and Downloads by what he calls it, e.g. query "الصف العاشر" kind "pdf". One clear match opens at once; several come back as a list, then call again with the chosen path. Use this (not open_app or classroom) for «افتح الملف / البي دي إف / الدرس…».',
      schema: { query: z.string().max(120).optional(), kind: z.enum(['pdf', 'word', 'powerpoint', 'excel', 'picture', 'video']).optional(), path: z.string().max(600).optional() },
      handler: async ({ query, kind, path }) => {
        const open = async (p, name) => {
          const res = await ctx.run({ type: 'open_file', params: { path: p } });
          if (!res.ok) return fail(`ما قدرت أفتحه: ${why(res)}`);
          await sleep(1500); // let the program show it before the next step
          return text(`فتحت «${name}».`);
        };
        if (path) return open(path, path.split(/[\\/]/).pop());
        if (!query) return fail('قول اسم الملف أو كلمة منه.');
        const res = await ctx.run({ type: 'find_files', params: { query, ...(kind ? { kind } : {}) } });
        if (!res.ok) return fail(`ما قدرت أدوّر: ${why(res)}`);
        const list = Array.isArray(res.data) ? res.data : [];
        if (!list.length) return text(`ما لقيت ملف اسمه فيه «${query}» في سطح المكتب والمستندات والتنزيلات.`);
        const [best, next] = list;
        if (list.length === 1 || (best.score >= 0.99 && (!next || next.score < best.score))) return open(best.path, best.name);
        return text(`لقيت أكثر من ملف، اختار واحد (أو اسأل المعلم):\n${list.slice(0, 8).map((f, i) => `${i + 1}. «${f.name}» path=${f.path}`).join('\n')}`);
      },
    },
    {
      name: 'windows',
      description: 'The windows open on the computer, and control over them: action "list" gives each window\'s id, program, state (normal/min/max), place and title. Then "focus" (bring to front), "minimize", "maximize", "restore" or "close" one by its id. Closing asks the program to close normally (it asks to save if needed).',
      schema: { action: z.enum(['list', 'focus', 'minimize', 'maximize', 'restore', 'close']), id: z.string().regex(/^\d{1,20}$/).optional() },
      handler: async ({ action, id }) => {
        if (action === 'list') {
          const res = await ctx.run({ type: 'window_list', params: {} });
          if (!res.ok) return fail(`ما قدرت أشوف النوافذ: ${why(res)}`);
          const list = parseWindows(res.data);
          return text(list.length ? list.map((w) => `id=${w.id} · ${w.program} · ${w.state} · «${w.title}»`).join('\n') : 'ما فيه نوافذ مفتوحة.');
        }
        if (!id) return fail('حدد id النافذة من القائمة (action list).');
        if (action === 'close') {
          const res = await ctx.run({ type: 'window_list', params: {} });
          const w = res.ok ? parseWindows(res.data).find((x) => x.id === id) : null;
          if (w && /\*|غير محفوظ|unsaved/i.test(w.title) && !(await ask(`أسكّر «${w.title}»؟ يمكن فيه شغل مو محفوظ.`))) return text('المعلم ما وافق، ما سكرت.');
        }
        const res = await ctx.run({ type: 'window_op', params: { hwnd: id, op: action } });
        const done = { focus: 'جبتها قدام.', minimize: 'صغّرتها.', maximize: 'كبّرتها.', restore: 'رجعتها.', close: 'سكرتها.' }[action];
        return res.ok ? text(done) : fail(`ما زبط: ${why(res)}`);
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
        await ctx.ui('ink', { op: 'write', text: mathText(a.text, { digits: digitsNow() }), at, anchor: 'center', size: a.size ? Math.round(a.size * ctx.screen.pictureScale()) : null, color: a.color || 'blue' });
        return text('كتبت على الشاشة.');
      },
    },
    {
      name: 'screen_draw',
      description: `Draw maths and diagrams ON the screen (over a PDF, a slide, anything) in ONE call, like a teacher at the board. items: a list, each {type, ...} in picture pixels:
point {x,y,label?} · line {x1,y1,x2,y2,arrow?:'end'|'both'|'start',dashed?,label?} · circle {x,y,r,label?} · rect {x,y,w,h} · polygon {points:[[x,y],...],labels?:['أ','ب','ج']} (triangles, shapes) · angle {x,y (vertex),from,to (degrees, 0 = right, counter-clockwise),r?,right?:true for a right-angle square,label?} · text {x,y (centre),text,size?} · fraction {x,y (centre),top,bottom,size?} (stacked) · axes {x,y (origin),left,right,up,down,step} (coordinate plane with numbered ticks) · numberline {x1,x2,y,from,to,step?,marks?:[values]} · curve {points:[[x,y],...]} (a smooth graph) · check {x,y,size?} ✓ · cross {x,y,size?} ✗.
Any item may have color (${COLOR_IDS.join(', ')}) and width. Write maths the Omani way: Arabic digits ٠١٢٣٤٥٦٧٨٩ and the unknowns س ص ع. Powers as ^ (س^٢ shows a small raised ٢), sqrt → √, * → ×, >= → ≥. Western digits and x y z are converted automatically.`,
      schema: {
        items: z.array(z.object({ type: z.enum(SKETCH_TYPES) }).passthrough()).min(1).max(60),
        color: z.enum(COLOR_IDS).optional(),
      },
      handler: async ({ items, color }) => {
        const scale = ctx.screen.pictureScale();
        const shapes = cleanSketch(items, { pt: (x, y) => ctx.screen.toOverlay(x, y), len: (v) => Math.round(v * scale), digits: digitsNow() });
        if (!shapes.length) return fail('ما فهمت الرسم: تأكد من الأنواع والإحداثيات.');
        await ctx.ui('ink', { op: 'sketch', shapes, color: color || 'blue' });
        return text(`رسمت ${shapes.length} ${shapes.length === 1 ? 'شي' : 'أشياء'} على الشاشة${shapes.length < items.length ? ` (تركت ${items.length - shapes.length} ناقصة)` : ''}.`);
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
      name: 'screen_fx',
      description: `A playful effect to change the mood of the lesson, on ANY piece of the screen (a question in the PDF, a slide, a picture, a word…) or over all of it. The real window is never changed: Khalfoun animates a picture of that piece.
Region effects (x,y,w,h = the piece in picture pixels, from the screenshot): crumple (crumpled into a paper ball and thrown in a bin), shatter (breaks like glass), burn (burns away), plane (folds into a paper plane and flies off), flip (a card that flips to show text: put the answer in "text"), zoom (a magnifying lens), spotlight (everything dark except it), shake (shakes to draw attention), pop (blows up like a balloon and bursts), melt (melts down).
The piece looks gone for a few seconds (hold, 1-60) then the screen shows again; keep:true keeps it hidden until screen_clear.
Over the whole screen (no x,y,w,h): confetti, fireworks, balloons, stars, hearts, bubbles, snow, rain, lanterns, national (Omani flag).`,
      schema: {
        effect: z.enum(['crumple', 'shatter', 'burn', 'plane', 'flip', 'zoom', 'spotlight', 'shake', 'pop', 'melt', 'confetti', 'fireworks', 'balloons', 'stars', 'hearts', 'bubbles', 'snow', 'rain', 'lanterns', 'national']),
        x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(),
        text: z.string().max(80).optional(), hold: z.number().min(1).max(60).optional(), keep: z.boolean().optional(),
        color: z.enum(COLOR_IDS).optional(),
      },
      handler: async ({ effect, x, y, w, h, text: label, hold, keep, color }) => {
        if (!['crumple', 'shatter', 'burn', 'plane', 'flip', 'zoom', 'spotlight', 'shake', 'pop', 'melt'].includes(effect)) {
          await ctx.ui('fx', { op: 'celebrate', name: effect });
          return text('احتفلنا!');
        }
        if (![x, y, w, h].every(Number.isFinite) || w < 8 || h < 8) return fail('حدد مكان الشي في الشاشة (x,y,w,h) من صورة الشاشة.');
        const shot = await ctx.snap?.({ x, y, w, h });
        if (!shot?.ok) return fail('ما قدرت آخذ صورة لهالجزء من الشاشة.');
        await ctx.ui('fx', { op: 'region', effect, rect: shot.rect, image: shot.image, text: label || '', hold, keep: Boolean(keep), color: color ? COLORS[color] || color : undefined });
        return text(keep ? 'سويتها، وبيبقى مخفي لين تمسح الشاشة.' : 'سويتها!');
      },
    },
    {
      name: 'graph',
      description: `Draw live graphs of functions on a board beside the lesson («ارسم ص = ٢س + ١»). functions: up to 5, each {expr} written like "2x+1", "x^2-4", "sin(x)", "a x^2" (x is س; parameters a b c k m; × ÷ √ ² allowed). x / y: the ranges [min, max] (y is found by itself if left out). roots: true marks where the graph crosses the س axis. points: [{x,y,label?}]. animate: {param:"a", from, to, seconds} moves a parameter so the class sees what it changes («غيّر الميل»). place: right (default), left, center.`,
      schema: {
        functions: z.array(z.object({ expr: z.string().min(1).max(80), color: z.enum(COLOR_IDS).optional(), label: z.string().max(60).optional() })).min(1).max(5),
        x: z.array(z.number()).length(2).optional(), y: z.array(z.number()).length(2).optional(),
        params: z.record(z.string().regex(/^[abcdkmn]$/), z.number()).optional(),
        animate: z.object({ param: z.string().regex(/^[abcdkmn]$/), from: z.number(), to: z.number(), seconds: z.number().min(1).max(20).optional() }).optional(),
        roots: z.boolean().optional(),
        points: z.array(z.object({ x: z.number(), y: z.number(), label: z.string().max(30).optional() })).max(12).optional(),
        place: z.enum(['right', 'left', 'center']).optional(),
      },
      handler: async (g) => {
        for (const f of g.functions) { try { parseExpr(f.expr); } catch (err) { return fail(`ما فهمت الدالة «${f.expr}»: ${err.message}`); } }
        const r = await ctx.ui('graph', { ...g, functions: g.functions.map((f) => ({ ...f, color: f.color ? `#${COLORS[f.color]?.hex || '1D70B8'}` : undefined })), digits: digitsNow() });
        return r?.ok ? text(`رسمت ${g.functions.length === 1 ? 'الدالة' : `${g.functions.length} دوال`}${g.animate ? ' وأحرّك الرسم' : ''}.`) : fail(`ما قدرت أرسم: ${r?.error || ''}`);
      },
    },
    {
      name: 'steps',
      description: 'Show a solution STEP BY STEP for the teacher to move through himself (remote Page Down / Page Up, his phone, or «كمل» / «ارجع»): give all the steps at once; only the first is shown now. Each step: items (the same drawing items as screen_draw, in picture pixels) and say (one short sentence for that step). Use it when he asks «بالخطوات / خطوة خطوة».',
      schema: {
        title: z.string().max(60).optional(),
        steps: z.array(z.object({ items: z.array(z.object({ type: z.enum(SKETCH_TYPES) }).passthrough()).max(30).optional(), say: z.string().max(200).optional() })).min(1).max(20),
        color: z.enum(COLOR_IDS).optional(),
      },
      handler: async ({ title, steps, color }) => {
        const scale = ctx.screen.pictureScale();
        const deck = steps.map((s) => ({
          shapes: s.items?.length ? cleanSketch(s.items, { pt: (x, y) => ctx.screen.toOverlay(x, y), len: (v) => Math.round(v * scale), digits: digitsNow() }) : [],
          say: s.say ? mathText(s.say, { digits: digitsNow() }).replace(/[\uE000-\uE003]/g, '') : '',
        }));
        const r = await ctx.ui('steps', { title: title || '', color: color || 'blue', steps: deck });
        return r?.ok ? text(`جهزت ${deck.length} خطوات، والأولى طالعة. المعلم يكمل بالريموت أو الجوال أو «كمل».`) : fail('ما قدرت أعرض الخطوات.');
      },
    },
    {
      name: 'camera_pick',
      description: 'Choose a student at random with the camera («اختار طالب بالكاميرا»): Khalfoun takes a photo of the class with the computer\'s camera, finds every face on this computer (the photo is never sent anywhere), and a light jumps between the faces and lands on one, fairly (no one twice while others are left). With the teacher\'s phone page, he can also take the photo with the 🎯 button.',
      schema: {},
      handler: async () => { await ctx.ui('pick', {}); return text('بدأت الاختيار بالكاميرا.'); },
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
        const res = await ctx.run({ type: 'office_put', params: { app: a.app, plan, fresh: Boolean(a.new_file), verbatim: Boolean(a.exact), digits: a.digits || digitsNow() } });
        if (!res.ok) return fail(`ما انكتب: ${why(res)}`);
        const m = res.data?.mode;
        return text(m === 'file' ? `انعمل ملف جديد وانفتح${res.data?.file ? `: ${res.data.file}` : ''}.` : m === 'pasted' ? 'انلصق في البرنامج.' : 'انكتب في المستند المفتوح.');
      },
    },
    {
      name: 'office_equation',
      description: 'Write a maths equation into the open Word/PowerPoint at the cursor, already in symbols, e.g. "س + ٢ = ٥" or "x² + 3x = 10".',
      schema: { text: z.string().min(1).max(300) },
      handler: async ({ text: t }) => act({ type: 'office_equation', params: { app: null, text: mathText(t, { digits: digitsNow(), office: true }) } }, 'كتبت المعادلة.'),
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
      description: 'ONLY for Khalfoun\'s ready classroom games and tools (not for opening files or programs: use open_file / open_app). A short Arabic command, e.g. «لف العجلة», «احتفل», «العاب نارية», «مؤقت ٥ دقايق», «غايب أحمد», «منو غايب اليوم», «نجمة لمريم», «لغز», «سباق الهجن», «مقياس الهدوء», «وضع الصف», «افتح السبورة», «اختبار القراءة», «اختبر السمع», «ذكرني بعد ١٠ دقايق». Returns what happened.',
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
      handler: async ({ fact }) => { await ctx.ui('remember', { fact }); await ctx.learn?.('fact', fact); return text('حفظتها.'); },
    },
    {
      name: 'learn',
      description: 'Learn something lasting about how this teacher works, so you understand him better every time (read back to you at the start of every session). kind: "word" (a word or phrase of his and what he means by it), "like" (how he likes things done: colours, sizes, steps, length of replies), "fix" (something he corrected you on), "fact" (his classes, students, files). Do it quietly while working; never passwords or private numbers.',
      schema: { kind: z.enum(['word', 'like', 'fix', 'fact']), note: z.string().min(3).max(240) },
      handler: async ({ kind, note }) => { await ctx.learn?.(kind, note); return text('تعلمتها.'); },
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
