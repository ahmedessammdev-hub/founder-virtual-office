# Phase 7 — خطة تطوير الواجهة وتجربة المستخدم (`Adaptive Command Center UI/UX`)

> **الهدف:** تحويل واجهة **ASO AI HQ** إلى مركز قيادة سريع واحترافي (`Restrained Dark Glass Command Center` + `Sunlit Architectural Light`) متناغم مع المكتب ثلاثي الأبعاد، بحيث يرى المؤسس الإشارة الأهم فوراً وينجز قراراته بضغطة أو اختصار لوحة مفاتيح.

---

## 1. نظام التصميم الموحّد (`Unified Design System & Tokens`)

مستند إلى قواعد [`app-screens.md`](file:///C:/Users/ahmed%20essam/.gemini/config/skills/design-taste-frontend/references/app-screens.md):
- **الوضعان المتاحان عبر مبدّل في الشريط العلوي (`uiTheme`: `"dark_glass"` الافتراضي للعمل الطويل / `"sunlit_light"`):**
  - **`dark_glass` (`Restrained Dark Glass Command Center`):** خلفية عميقة هادئة (`#0E1117`), أسطح بطاقات داكنة نظيفة (`#151A23`), حدود `1px` دقيقة (`#262E3D`), زجاج مقيّد للوحات العائمة بدون إبهار أو نيون مبالغ فيه، ونصوص عالية التباين (`#E6EAF2` و`#94A3B8`).
  - **`sunlit_light` (`Sunlit Architectural Light`):** استمرار لوحة الاستوديو المعمارية الدافئة (`#F6F4EF`, `#FFFFFF`, `#1A1917`).
- **الاتساق البصري:** إعادة تعريف متغيرات Tailwind `studio-*` في `apps/web/tailwind.config.ts` و`apps/web/src/index.css` لقراءة `CSS Custom Properties` (`rgb(var(--studio-...) / <alpha-value>)`)، مع إضافة مخزن `uiTheme` في `useOfficeStore` (يُحفظ محلياً في `localStorage`) وتمرير نفس الدلالات إلى إضاءة وثيم الـ 3D.
- **قواعد صارمة للواجهة:**
  1. اللون للبيانات والحالات فقط (`emerald` يعمل، `amber` موافقة معلقة، `crimson` خطأ/رفض)، لا للزينة.
  2. أرقام محاذية بـ `tabular-nums` و`dir="ltr"` للمبالغ والمؤشرات، و`dir="auto"` لأي محتوى عربي/إنجليزي مختلط.
  3. خيار `Reduced Motion` يحترم `prefers-reduced-motion` + زر تحكم داخل الإعدادات.

---

## 2. التقسيم المرحلي (`7A → 7B → 7C`) بالتوازي مع Phase 8

### Phase 7A: الهيكل، الهوية، والقيادة السريعة *(تُبنى مع `Phase 8A`)*

| المكون | الملفات المستهدفة | المواصفات التنفيذية |
| :--- | :--- | :--- |
| **تطوير نظام الألوان والثيم** | `apps/web/tailwind.config.ts`<br>`apps/web/src/index.css`<br>`apps/web/src/store/office-store.ts` | - نقل ألوان `studio.*` إلى متغيرات CSS متكيفة (`[data-theme="dark"]` و`[data-theme="light"]`).<br>- إضافة `uiTheme`, `toggleUiTheme()`, ومزامنة مفضلة المستخدم تلقائياً. |
| **إعادة هيكلة الغلاف (`AppShell`)** | `apps/web/src/components/AppShell.tsx`<br>`apps/web/src/i18n/translations.ts` | - شعار **ASO AI HQ** باستخدام `icon.svg` + شارة الحالة الحية (`متصل لحظياً`, عدد المهام الجارية، شارة الموافقات).<br>- تقسيم عناصر الملاحة العشرة إلى **3 مجموعات واضحة**:<br>  1. **العمليات (`Operations`):** المكتب الحي، التنسيق والاجتماعات، المشاريع والمهام، الأتمتة وTelegram.<br>  2. **الحوكمة والفريق (`Team & Governance`):** الموافقات، الذاكرة الموثّقة، التوظيف والفريق.<br>  3. **البنية والرقابة (`System`):** الأدوات والـ MCPs، المزودات والتكلفة، التحليلات والنسخ.<br>- أزرار سريعة في الشريط العلوي: **`Ctrl+K` للبحث**، زر تبديل الثيم (`Dark / Sunlit`)، وزر مركز الإشعارات مع عدّاد غير مقروء. |
| **لوحة الأوامر الفورية (`Command Palette`)** | `apps/web/src/components/common/CommandPalette.tsx` *(جديد)* | - تفتح عبر `Ctrl+K` أو `Cmd+K` أو من شريط الهيدر وتُغلق بـ `Esc`.<br>- تبحث لحظياً عبر العربية (`arabic-normalize` مبسط على العميل) والإنجليزية في:<br>  - الموظفين (فتح الدرج + تركيز كاميرا الـ 3D).<br>  - الشاشات العشر.<br>  - المشاريع المسجلة.<br>  - الأوامر السريعة (تبديل `Live / Mock`, تبديل `3D / 2D / Design / First-Person`, تبديل `AR / EN`, فتح لوحة الموافقات). |
| **مركز الإشعارات الفورية (`Notification Center`)** | `apps/web/src/components/common/NotificationCenter.tsx` *(جديد)*<br>`apps/web/src/store/office-store.ts` | - التقاط أحداث WebSocket الحية (`approval_created`, `run_status` عند `COMPLETED`/`FAILED`/`BUDGET_EXCEEDED`, `hiring_updated`) إلى قائمة تنبيهات مؤقتة (`Toast` غير مزعجة تختفي تلقائياً خلال `6s`) وسجل إشعارات جانبي.<br>- إتاحة زر انتقال مباشر من الإشعار إلى الموافقة أو درج الموظف. |
| **شريط التجهيز الذكي (`Founder Onboarding Strip`)** | `apps/web/src/components/common/OnboardingStrip.tsx` *(جديد)* | - يظهر بشكل هادئ وقابل للإخفاء (`localStorage`) فقط عندما ينقص المكتب أحد المقومات الأساسية:<br>  - ربط أول مشروع (`projects.length === 0`).<br>  - جاهزية مزوّد/مفتاح Vault (أو تفعيل تجربة `Mock`).<br>  - تهيئة `Git Backup` لمجلد `company/`.<br>  - إرسال أول مهمة لـ `general-manager`. |

### Phase 7B: أدوات المشغّل المحترف (`Power Operator UX`) *(تُبنى مع `Phase 8B`)*

| المكون | الملفات المستهدفة | المواصفات التنفيذية |
| :--- | :--- | :--- |
| **درج الموظف المرقّى (`EmployeeDrawer`)** | `apps/web/src/components/drawer/EmployeeDrawer.tsx`<br>`apps/web/src/components/common/MarkdownMessage.tsx` *(جديد)* | - زر تبديل عرض الدرج (**`480px` قياسي** ↔ **`780px` موسّع**) لحفظ راحة قراءة التقارير والأكواد.<br>- عارض Markdown خفيف وآمن (بدون `dangerouslySetInnerHTML`) يدعم العناوين، القوائم، الروابط، الجداول، وكتل الكود بلون واضح + زر **`نسخ الكود`** بضغطة واحدة.<br>- **شرائح أوامر سريعة (`Quick Role Prompts`)** حسب تخصص الموظف فوق حقل الإدخال (مثلاً لكريم: مراجعة آخر تغييرات / فحص الاختبارات؛ لليلى: اقتراح دور جديد).<br>- تحسين تتبع التنفيذ (`RunTraceCard`) بتمييز لوني واضح لطبقة الخطورة (`tier1` / `tier2` / `tier3`). |
| **طابور الموافقات Split-Pane (`ApprovalsView`)** | `apps/web/src/components/views/ApprovalsView.tsx` | - تقسيم الشاشة على الديسكتوب (`lg:grid-cols-[360px_1fr]`): قائمة الطلبات باليمين، ولوحة القرار والـ **Diff / Payload Inspector** باليسار مع أزرار فورية.<br>- اختصارات لوحة المفاتيح داخل الشاشة: `↓ / ↑` لتبديل الطلب، `A` للموافقة السريعة (أو فتح تأكيد إضافي لـ `taintedByExternalInput`)، `R` للتركيز على حقل سبب الرفض. |
| **ترقية محرر المخطط 2D (`Office Design Mode`)** | `packages/shared/src/schemas/office.ts`<br>`packages/shared/src/schemas/phase6.ts`<br>`apps/server/src/company/company-store.ts`<br>`apps/web/src/components/office/OfficeFloorplan.tsx` | - إضافة **`rotationDeg?: 0 | 90 | 180 | 270`** اختيارياً لـ `FloorplanDeskSchema` (متوافق خلفياً مع `company.json` الحالي).<br>- إضافة مكدّس **`Undo / Redo`** كامل (`Ctrl+Z` / `Ctrl+Y`, حتى 30 خطوة) في وضع تعديل المخطط.<br>- إظهار **شرائح نشاط مصغّرة (`Live Tool Pills`)** فوق المكاتب النشطة، ورسم **أقواس تسليم الـ DAG** عندما تتعاون مهام `TaskPlan` نشط، بالإضافة لـ **Quick Hover Bar** لرسالة سريعة بدون فتح الدرج. |

### Phase 7C: صقل التحليلات والتدقيق البصري الشامل *(تُبنى مع `Phase 8C`)*

1. **لوحة التحليلات والتكلفة (`AuditView.tsx` + `AnalyticsService`):**
   - إضافة حساب **الفارق عن الفترة السابقة (`Baseline Delta`)** في `AnalyticsService` (مثلاً: مقارنة آخر `7` أيام بالـ `7` أيام السابقة لها).
   - عرض **جملة الخلاصة التنفيذية (`Headline Finding`)** أعلى تبويب التحليلات قبل البطاقات والرسم البياني.
   - ضبط كل الأعمدة الرقمية لتستخدم `text-end font-mono tabular-nums` بوضوح.
2. **تدقيق جودة الـ UI/UX الشامل:**
   - تشغيل مراجعة [`design-taste-frontend`](file:///C:/Users/ahmed%20essam/.gemini/config/skills/design-taste-frontend/SKILL.md) على 3 مقاسات عرض (`1440×900`, `1280×800`, `1024×768`) في اللغتين العربية والإنجليزية.
   - ضمان إمكانية الوصول باللوحة الكاملة (`Tab` order, `aria-label`s, `Esc` لإغلاق النوافذ والدرج ولوحة الأوامر).

---

## 3. اختبارات الجودة والقبول لـ Phase 7

- **اختبارات Vitest إضافية (`apps/server`):**
  - التحقق من قبول `rotationDeg` في `FloorplanDeskSchema` و`PUT /api/company/floorplan` مع رفض الزوايا غير المسموحة (`400`).
  - التحقق من دقة `Baseline Delta` في `AnalyticsService` عند توفر بيانات نافذتين متتاليتين.
- **بوابة البناء والفحص:**
  - `cmd /c "pnpm typecheck && pnpm test && pnpm build"` يخرج بكود `0`.
- **التحقق الحي في المتصفح:**
  - تبديل الثيم (`Dark Glass ⇄ Sunlit Light`) واستمراره بعد التحديث.
  - فتح `Ctrl+K` والقفز لموظف وتبديل وضع `Mock`.
  - اختبار توسيع `EmployeeDrawer` + نسخ كتلة كود Markdown + إشعار Toast + اختصار الموافقة `Split-Pane` + `Undo/Redo` وتدوير مكتب في `2D` دون تداخل (`0 console errors`, `0 HTTP >= 400`).
