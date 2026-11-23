# ASO AI HQ 2.0 — خطة إعادة التصميم الشاملة (`Executive Obsidian Redesign`)

> **الاتجاه البصري:** **`Executive Obsidian`** (فخامة داكنة محايدة مستوحاة من `Linear` و`Raycast` و`Apple Pro` — أسود فحمي نقي `#09090B` بدون كحلي باهت، لمسة ذهبية مطفية `#D4A853` للبيانات النشطة فقط، أزرار رئيسية معكوسة عالية التباين، ومكتب حيّ يملأ الشاشة بالكامل مع وضع نهاري معماري دافئ `#F8F7F4`).

---

## الموجات التنفيذية (`Wave R1 → R4`)

1. **`Wave R1` — الأساس البصري والهيكل النظيف (`Tokens + Shell + Primitives`):**
   - استبدال ألوان `Slate/Navy/Indigo` المتعبة بألوان فحمية محايدة (`#09090B` / `#111113` / `#18181B`) وحدود شعرية `#1F1F23`.
   - تحميل خطوط `IBM Plex Sans Arabic` + `Inter` + `JetBrains Mono` (`tabular-nums`).
   - تجديد شعار [icon.svg](file:///d:/virtual%20office/apps/web/public/icon.svg) إلى مونوجرام معماري بلون Obsidian & Champagne Brass.
   - تقليص الشريط الجانبي إلى `216px` على نفس أرضية الشاشة، وإعادة بناء الهيدر بارتفاع `48px` مع دعم `Full-Bleed` لشاشة المكتب عبر [AppShell.tsx](file:///d:/virtual%20office/apps/web/src/components/AppShell.tsx).
   - تأسيس مكونات موحدة في [Primitives.tsx](file:///d:/virtual%20office/apps/web/src/components/ui/Primitives.tsx) (`PageFrame`, `PageHeader`, `StatStrip`, `Panel`, `EmptyPanel`).

2. **`Wave R2` — مكتب يملأ الشاشة + `2D` معماري + درج محادثة مريح:**
   - إزالة صف الكروت الـ 4 وشريط الإعداد العريض من فوق المكتب واستبدالهما بشريط قياس علوي عائم ومختصر + قائمة إعداد منبثقة في [OnboardingStrip.tsx](file:///d:/virtual%20office/apps/web/src/components/common/OnboardingStrip.tsx).
   - إضافة شريط أوامر سفلي عائم (`Floating Command Dock`) في [OfficeFloorplan.tsx](file:///d:/virtual%20office/apps/web/src/components/office/OfficeFloorplan.tsx) يجمع مبدّل الأوضاع (`2D` / `3D` / `WASD` / `Design`) وأفاتار الفريق السريع وزر المحادثة مع رامي.
   - تحويل [EmployeeDrawer.tsx](file:///d:/virtual%20office/apps/web/src/components/drawer/EmployeeDrawer.tsx) إلى مساحة قراءة هادئة بوضع إعدادات المحرك والموديل والصلاحيات داخل شريط مدمج قابل للطي بأسفل المحرر.

3. **`Wave R3` — استوديو `3D` منحوت + شخصيات عضوية + إضاءة معمارية:**
   - إعادة بناء [generate-sample-avatar-glb.mjs](file:///d:/virtual%20office/scripts/generate-sample-avatar-glb.mjs) و[ProceduralAvatar.tsx](file:///d:/virtual%20office/apps/web/src/components/office3d/adapters/ProceduralAvatar.tsx) بأشكال كبسولية وكروية ناعمة وتفاصيل شعر وياقة وسماعات بدل المكعبات.
   - ضبط الإضاءة الافتراضية على **`Obsidian Evening`** (`#09090B` المتطابق مع الواجهة + مصابيح معلّقة دافئة + `<ContactShadows>`) مع إبقاء **`Warm Daylight`** متاحًا بنقرة واحدة.
   - ترقية خامات الخشب والسجاد والشاشات (`CanvasTexture`) والمفروشات والسبورة الاستراتيجية في [ArchitecturalRoom.tsx](file:///d:/virtual%20office/apps/web/src/components/office3d/ArchitecturalRoom.tsx) و[DynamicFurniture.tsx](file:///d:/virtual%20office/apps/web/src/components/office3d/DynamicFurniture.tsx)، وتبسيط الـ HUD في [Studio3DCanvas.tsx](file:///d:/virtual%20office/apps/web/src/components/office3d/Studio3DCanvas.tsx).

4. **`Wave R4` — توحيد الشاشات الداخلية التسع + جولة مراجعة بصرية متعددة الشاشات:**
   - توحيد التباعد والخطوط والجداول والشاشات عبر جميع الصفحات في `apps/web/src/components/views/`.
   - تشغيل البوابة الكاملة (`pnpm typecheck && pnpm test && pnpm build`) ثم مراجعة لقطات حية عند `1440×900` و`1280×800` مع التحقق البصري وإغلاق أي عيوب.
