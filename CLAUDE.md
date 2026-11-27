# CLAUDE.md — دليل العمل على «خلفون»

هذا المستودع فيه مشروعان. **العمل كله على «خلفون» داخل مجلد `khalfoun/`.** باقي الملفات في الجذر (index.html و js و css...) تخص تطبيق «مِداد» المستقل، فلا تعدّلها.

## من تكلم
- صاحب المشروع معلّم عُماني. **كلّمه بالعربية وباللهجة العُمانية الخفيفة**، بجمل قصيرة وواضحة، ووصف خطوات عملية. هو ليس مبرمجاً.
- يجرّب خلفون على جهازه (ويندوز)، ويصف الأخطاء بكلامه. مهمتك: تعيد الخطأ، وتفهم سببه، وتصلحه، وتتأكد بنفسك أن الإصلاح يعمل على جهازه، ثم تخبره بالنتيجة بصدق: ما الذي صلح، وما الذي لم تتأكد منه.

## ما هو خلفون
شخصية كرتونية عُمانية تعيش على سطح المكتب (Electron، ويندوز أولاً). نافذة شفافة فوق كل شيء، والنقر يمر من خلالها ما عدا على خلفون ومربعاته.
- **عقله** (`src/core/`): فهم الأوامر باللهجة العُمانية (`intents.js`)، المشاعر، بنك الردود (`templates/ar-om.js`)، الذاكرة، الصلاحيات، الحساب، جدول الحصص، أدوات الصف، فهم النوافذ. كله دون اعتماد على النظام، ومغطّى باختبارات.
- **الواجهة** (`src/renderer/`): رسم الشخصية والحركات، `overlay.js` يربط كل شيء، الصوت والاستماع والإملاء والألعاب.
- **النظام** (`src/main/`): `main.js` (النافذة، الأيقونة، الاختصارات، الـ IPC، سجل التشخيص)، `actions/` (تنفيذ الأوامر: فتح، إغلاق، كتابة، أزرار، PDF، قراءة النص المحدد)، `stt.js` (whisper)، `ocr.js` (قارئ الشاشة في ويندوز)، `chat.js` (Ollama: حوار، مهام، عيون ذكية)، `setup.js` (التنزيل بضغطة زر)، `windows-watcher.js` (النوافذ المفتوحة).
- **مخ Claude (النسخة 2، من اشتراك المعلم):** `src/main/brain/` — `claude-brain.js` (جلسة Claude Agent SDK طويلة، بدون أدوات ملفات أو أوامر، فقط أدوات خلفون والبحث)، `tools.js` (أدوات Claude: look_screen، find_text، click/drag/scroll، type_text، press_keys، open_app، screen_write/draw/mark، office_*، classroom، remember، feel، ask_user)، `eyes.js` (الصورة ↔ الشاشة ↔ النافذة)، `hands.ps1` (الماوس والكيبورد في ويندوز)، `claude-setup.js` (تنزيل برنامج Claude الرسمي من npm بالبصمة)، `index.js` (الربط بـ `claude auth login`). الشخصية في `core/claude-persona.js`، وجهة الصفحة في `renderer/mind-ui.js`. أي أداة تنفّذ شي تمر على `executor.run` (الفحص المزدوج). المخ العادي يبقى احتياطاً.
- **الريموت والأذن:** `core/remote-keys.js` (زر ريموت العرض)، `core/ear-plan.js` + `renderer/ear-ui.js` (تسجيلات تدريب الأذن)، `renderer/ear-model.js` (أذن «يا خلفون» على الجهاز، onnxruntime-web)، `tools/ear/train.py` (التدريب). الأذن المدرّبة في `%APPDATA%\Khalfoun\ear\`.
- **السحابة (اختيارية، بمفاتيح المستخدم):** `src/main/cloud.js` (Azure للسماع `ar-OM` والصوت، Claude للعقل عبر أداة `respond` تعطي أوامر خلفون النصية فقط)، `src/main/secrets.js` (المفاتيح مشفّرة بـ safeStorage، لا تصل للصفحة). المحلي يبقى احتياطاً.
- **خلفون ٣ (3.0):** تطبيق مستقل جنب خلفون ٢ (`app.setName('Khalfoun3')`، appId `om.khalfoun.desktop3`، النسخ من خلفون ٢ في `main/migrate.js`). عقل واحد عبر `main/brain/provider.js`. الطبقة السريعة `core/fast-layer.js`. الرياضيات: `main/math/` (SymPy في Pyodide، worker) + `core/math-input.js` (الفحص الأول) + `core/math-deck.js` + `core/spoken-math.js` + `core/geometry.js`. الأمان: `core/privacy.js`، `core/permissions.js` (`colorOf`, `undoFor`)، `renderer/safety-ui.js`، الطوارئ Ctrl+Alt+End. السماع المتدفق `main/stream-stt.js`. الصف: `core/report.js`، `core/inbox.js` (صندوق الجوال)، `renderer/quiz-board.js`. الذكاء الاستباقي والروتينات والقاموس: `core/proactive.js`، `renderer/memory-panel.js`. الحالات: `core/persona-state.js`. القياسات: `core/latency.js`. الخطة: `khalfoun/docs/ROADMAP.md`.
- خلفون ٢ محفوظ عند commit `dc8bf50` (علامة `khalfoun-v2.0.13` محلية).
- التفاصيل والأوامر كلها في `khalfoun/README.md`.

## التشغيل والفحص (من داخل `khalfoun/`)
```
npm install            # أول مرة
npm start              # يشغّل خلفون من الكود (أدوات المطور متاحة هنا)
npm test               # اختبارات العقل والنظام (أكثر من 340 اختبار، يجب أن تنجح كلها)
npm run smoke          # يشغّل التطبيق الحقيقي في وضع الفحص الذاتي
npm run check:windows  # فحوصات ويندوز الحقيقية (النوافذ، فتح البرامج، الصوت، اللصق)
node tools/real-use-check.mjs   # يستخدم خلفون بالكيبورد الحقيقي مثل الشخص (ويندوز)
npm run test:ui        # سيناريوهات الواجهة في متصفح (يحتاج: npm install --no-save playwright@1.49.1 ثم npx playwright install chromium)
npm run dist:win       # يبني ملف التثبيت في khalfoun\dist (يعمل على ويندوز مباشرة)
```
- لا تغلق نسخة خلفون المثبتة عند المستخدم دون أن تخبره؛ لتشغيل نسخة الكود أغلق المثبتة أولاً من أيقونتها (خروج)، لأن التطبيق يسمح بنسخة واحدة فقط.

## أين تجد الأخطاء
- **سجل التشخيص:** `%APPDATA%\Khalfoun3\khalfoun-log.txt` (خلفون ٢: `%APPDATA%\Khalfoun\`) (والجزء الأقدم `.old`). فيه: حالة البدء، كل جملة سمعها وما قرره (`page: heard «...» → situation`)، كل أمر ونتيجته (`action ... → ok / failed: ...`)، نتائج الاستماع، أخطاء الصفحة، وصحة كل فقاعة كلام (كم حرفاً ظهر، سرعة الرسم).
- **الذاكرة والإعدادات:** `%APPDATA%\Khalfoun\memory.json` و `settings.json` (لا تحذفها دون إذن؛ فيها اسم المستخدم وجدوله وطلابه).
- **الاستماع:** برنامج whisper ونماذجه في `%APPDATA%\Khalfoun\voice\`.
- لرؤية ما يحدث أثناء التشغيل من الكود: `npm start` ثم راقب السجل، وأدوات المطور متاحة لأن النسخة غير مغلّفة.

## قواعد مهمة في الكود
- **كل أمر يُفحص مرتين:** في العقل (`core/permissions.js` → `decide`) ثم في النظام (`main/actions/index.js` → `validateAction` + `decide`). أي نوع أمر جديد يحتاج: قيمة في `ACTION_RISK`، وفحص شكل في `validateAction`، وتنفيذ في `createExecutor`.
- **لا شيء مما يقوله الشخص يمر إلى سطر أوامر.** البرامج والمواقع والأزرار من قوائم ثابتة.
- **قوالب الردود:** كل `id` فريد. المتغير `{name}` محجوز لاسم المستخدم (استخدم `{student}` لاسم طالب)، و `{minutes}` ممنوع (استخدم `{duration}`). كل قيمة `a:` (حركة) يجب أن تكون موجودة في `renderer/animations.js`.
- **الفهم:** النص يُوحَّد بـ `normalize` (ة→ه، ى→ي، ئ→ي، ؤ→و، أ/إ/آ→ا) قبل المقارنة؛ اكتب العبارات الجديدة بهذا الشكل. ترتيب الفحوص في `recognizeText` مهم.
- **أضف اختباراً لكل خطأ تصلحه** في `khalfoun/tests/` (وجملة المستخدم الحقيقية إلى `tests/corpus.test.js` إذا كان الخطأ في الفهم).
- الكود والتعليقات بالإنجليزية، والنصوص الظاهرة للمستخدم بالعربية العُمانية.

## سير العمل عند إصلاح خطأ يصفه المستخدم
1. اطلب منه (أو اقرأ بنفسك) السجل، وأعد الخطأ بتشغيل `npm start` أو بفحص صغير.
2. ابحث عن السبب الحقيقي، لا تُخفِ العَرَض.
3. اكتب اختباراً يفشل، ثم أصلحه، ثم شغّل `npm test` و `npm run smoke`، وعلى ويندوز `npm run check:windows` و `node tools/real-use-check.mjs`.
4. جرّب الإصلاح بنفسك في التطبيق الحقيقي، ثم ابنِ نسخة جديدة بـ `npm run dist:win` إذا أراد المستخدم تثبيتها.
5. احفظ العمل على الفرع `claude/omani-cartoon-ai-assistant-f2oxcq` (commit ثم push). GitHub Actions يعيد كل الفحوص على ويندوز ولينكس ويرفع ملف التثبيت.
6. أخبر المستخدم بالعربية: ما الخطأ، وما سببه، وما الذي تغيّر، وكيف يجرّبه.
