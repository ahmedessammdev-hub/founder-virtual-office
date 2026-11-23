# Phase 9 — خطة التوسّع الاحترافي (`ASO AI HQ Pro Expansion`)

> **بوابة الدخول (`Entry Gate`):** لا يبدأ تنفيذ `Phase 9` إلا بعد إكمال واعتماد جميع شرائح `Phase 7` و`Phase 8` واجتياز فحوصات الأداء والاستقرار الكاملة.

---

## 1. نظرة عامة على القدرات الخمس في Phase 9

| الحزمة الفرعية | القدرة الرئيسية | الارتكاز على البنية الحالية |
| :--- | :--- | :--- |
| **9A** | **الموجز التنفيذي اليومي + الصوتيات الاختيارية** | `CronScheduler` + `AnalyticsService` + Web Speech TTS / Web Audio API |
| **9B** | **شاشات الـ 3D الحيّة فوق المكاتب (`Live Monitor Textures`)** | `useOfficeStore` (`liveDeltaByRunId`, `eventsByRunId`) + Three.js `CanvasTexture` |
| **9C** | **بوابة Webhooks وتكاملات الأحداث الخارجية الحقيقية** | Fastify `/api/webhooks/*` + `PolicyGuard` + `JobSupervisor` + Taint Tracking |
| **9D** | **تعدد الطوابق وقوالب الشركات الجاهزة (`Multi-Floor & Presets`)** | `CompanyConfigSchema` + `OfficeFloorplan` + `Studio3DCanvas` |
| **9E** | **تطبيق Windows الأصلي (`Tauri v2 .msi` + System Tray)** | `scripts/start-desktop.mjs` ← Rust Sidecar / WebView2 Native Wrapper |

---

## 2. التفاصيل الهندسية لكل حزمة (`9A → 9E`)

### Phase 9A: الموجز التنفيذي اليومي والصوتيات الهادئة
1. **الموجز التنفيذي اليومي (`Daily Morning Executive Briefing`):**
   - مهمة مجدولة اختيارية (أو زر يدوي في شريط القيادة) تولّد عبر `general-manager` + `AnalyticsService` ملخصاً صباحياً مركزاً: أهم الإنجازات، التكلفة الحية أمس، الموافقات المعلّقة، والمهام المتأخرة — مع خيار إرساله تلقائياً إلى Telegram المصرّح به.
2. **قراءة صوتية اختيارية (`AR/EN Web Speech TTS`):**
   - زر **"قراءة الملخص صوتياً"** داخل بطاقة الموجز أو رد الموظف مع اختيار صوت `ar-*` / `en-*` وسرعة القراءة (بالمتصفح محلياً بدون أي API مدفوع).
3. **مؤثرات صوتية مكتبية اختيارية (`Subtle Office Acoustics`):**
   - **مكتومة افتراضياً 100%**؛ عند تفعيلها بالمتصفح تُصدر نغمات Web Audio API هادئة جداً عند وصول موافقة `Tier 3` أو اكتمال مهمة `DAG` أو إشارة تنبيه، بدون تحميل ملفات صوت ضخمة.

### Phase 9B: شاشات 3D حيّة فوق المكاتب (`Live Terminal / Code Monitors`)
- **التصميم الآمن للأداء على `RTX 3050`:**
  - استخدام `THREE.CanvasTexture` ذي دقة خفيفة (`256×128`) يُرسم **فقط** للموظفين الذين في حالة `RUNNING` أو `WAITING_APPROVAL`، بمعدل تحديث مقيّد (`2–4 FPS` max — كل `250–500ms`) عند تغيّر `liveDeltaByRunId` أو آخر Tool Call.
  - يعرض في 3D على شاشة الموظف آخر أداة ينفذها (مثلاً: `> read_file packages/shared/...` أو `🛡️ Awaiting Tier 3 Sign-off`)؛ وعند عودة الموظف لـ `IDLE` يعرض شاشة توقف هادئة ثابتة (`0 CPU redraw`).

### Phase 9C: بوابة Webhooks والأحداث الخارجية المؤمّنة (`Signed Inbound Webhooks`)
- **المسار المقترح:** `POST /api/webhooks/:source` (`github`, `linear`, `custom`) مسجّل في `apps/server/src/api/server.ts`.
- **الضوابط الأمنية الصارمة (Zero Trust):**
  1. حفظ سر التوقيع في **`CredentialVault`** (مثل `WEBHOOK_SECRET_GITHUB`)؛ يرفض الخادم الطلبات بـ `401/403` إذا لم يُضبط السر أو لم يطابق توقيع **HMAC-SHA256** (`X-Hub-Signature-256` أو `X-Signature-256`) عبر `crypto.timingSafeEqual`.
  2. حماية ضد الإعادة (`Replay Protection`) عبر سجل `webhook_deliveries` في SQLite يمنع معالجة نفس `deliveryId` مرتين.
  3. أي حمولة Webhook خارجية تُعامل كـ **`Untrusted External Input`** إجبارياً (مع Tagging و`taintedByExternalInput = true` في `JobSupervisor`) وتُضبط بقواعد ترشيح صريحة (`eventWhitelist`, `targetEmployeeId`, `maxRunsPerHour`, و`riskTier` افتراضي `tier1_auto` أو `tier2_guarded`) — مع استعراض آخر الأحداث في شاشة الأتمتة.

### Phase 9D: تعدد الطوابق وقوالب الشركات الجاهزة (`Multi-Floor & Presets`)
1. **توسيع متوافق خلفياً في `CompanyConfigSchema`:**
   - إبقاء `floorplan` الحالي كطابق أول افتراضي، وإضافة حقل اختياري `floors?: Array<{ id, name, nameAr, floorplan }>` ومبدّل طوابق سريع في `2D` و`3D` (مثلاً: الطابق 1 للإدارة والهندسة، الطابق 2 للنمو والعمليات عند نمو الشركة لأكثر من 10 موظفين).
2. **قوالب شركات جاهزة (`Company Templates`):**
   - قوالب تأسيس سريعة للشركات الجديدة أو إعادة التهيئة الآمنة (مع Backup تلقائي بـ Git أولاً!):
     - `SaaS Engineering Squad` (الحالي)
     - `AI Product Studio`
     - `Technical Marketing & Growth Agency`

### Phase 9E: حزمة سطح المكتب الأصلية (`Tauri v2 Windows Installer .msi`)
- **الشرط المسبق الموثّق على Windows:** تثبيت **Visual Studio C++ Build Tools** وتبديل هدف Rust من `x86_64-pc-windows-gnu` إلى **`x86_64-pc-windows-msvc`**.
- **البنية:** تغليف تطبيق الـ Node backend كـ Sidecar (`apps/desktop/src-tauri/`) يُدار تلقائياً مع دورة حياة النافذة، مع:
  - أيقونة **System Tray** في شريط مهام Windows لإبقاء المكتب وCron/Telegram يعملان في الخلفية وإظهار القائمة السريعة (`Open Office`, `Approvals`, `Quit`).
  - **Windows Native Toast Notifications** لطلبات موافقة `Tier 3` وتنبيهات انتهاء مهام `DAG`.
  - توليد مثبّت `.msi` محلي خفيف يفتح نفس الأمان المحلي (`127.0.0.1` + DPAPI Vault).

---

## 3. بوابة القبول لـ Phase 9
- اجتياز اختبارات HMAC Signature Verification + Replay Rejection + Untrusted Taint Propagation لـ Webhooks في Vitest.
- التحقق من عدم تجاوز استهلاك `CanvasTexture` في `9B` حد `2ms/frame` أثناء تشغيل 3 موظفين متزامنين.
- إثبات التوافق الخلفي الكامل لملفات `company.json` التي لا تحتوي `floors[]`.
