<p align="center">
  <img src=".github/assets/banner.svg" alt="رسن — Rasan" width="100%">
</p>

# رسن — Rasan

> **"خيطٌ يربط، لا يقطع"** — تطبيق دردشة حديث يجمع خير WhatsApp + Telegram + Signal، ويحل عيوبهم: الثقل، التبعية للرقم، وضعف E2EE.

<p align="center">
  <a href="https://github.com/tibatechapp-ship-it/Rasan/actions/workflows/ci.yml"><img src="https://github.com/tibatechapp-ship-it/Rasan/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white" alt="Node ≥20">
  <img src="https://img.shields.io/badge/%D8%A7%D9%84%D9%84%D8%BA%D8%A7%D8%AA-12-blue" alt="12 languages">
  <img src="https://img.shields.io/badge/%D8%AD%D8%AC%D9%85%20%D8%A7%D9%84%D9%88%D8%A7%D8%AC%D9%87%D8%A9-~7KB%20gzipped-orange" alt="7KB gzipped">
</p>

---

## الميزات

- ✅ E2EE (ECDH P-256 + AES-GCM + TOFU identity + per-session forward secrecy + AAD anti-replay)
- ✅ تحقق من الهوية (TOFU + أرقام أمان + QR) — vendored qrcode-generator (MIT, ~20KB)
- ✅ بدون رقم هاتف (اسم مستخدم)
- ✅ قنوات بث (50K) + مجموعات (50K)
- ✅ Stories 24h
- ✅ رسائل تختفي (TTL)
- ✅ حجم تحميل أولي ~21KB (gzipped ~7KB)
- ✅ Vanilla JS (لا build step، لا node_modules للعميل)
- ✅ i18n — 12 لغة من اليوم الأول (ar/en/fr/es/tr/ru/zh/ja/ko/de/pt/it)
- ✅ PWA قابل للتثبيت
- ✅ وصولية a11y: تنقل كامل بالكيبورد، aria-live، تباين AA، مقياس خط rem (WCAG 1.4.4)
- ✅ مفتوح المصدر، قابل للاستضافة الذاتية
- ✅ يعمل على WiFi (LAN) والإنترنت
- ✅ إشعارات Push آمنة المحتوى (FCM بقوالب ثابتة — لا يرى الخادم نصوصاً)
- ✅ مكالمات صوت/مرئي 1:1 (WebRTC — الوسائط P2P مشفّرة DTLS-SRTP)
- ✅ **مكالمات جماعية** (WebRTC mesh حتى 8 مشاركين — للمجموعات والقنوات، وسائط P2P مشفّرة لا يراها الخادم)
- ✅ **وضع للّكة PTT** (نمط Zello/واتساب): استمرار الضغط للتحدث → إرسال مشفّر فوري، سحب خارج الزر = إلغاء
- ✅ **أدوات إشراف** (درس FireChat): حظر/رفع حظر، ترقية مشرفين (مالك)، تثبيت رسالة، حذف إشرافي، وقنوات للقراءة فقط
- ✅ إنذار طوارئ بث جماعي (نمط Zello) + مذكرات صوتية مشفّرة + طابور أوفلاين بمؤشرات تسليم
- ✅ **مسح ذعر + وضع إضطرار** (نمط Briar): قفل برمز، رمز إضطرار يمسح كل بيانات الجهاز فوراً ويعرض شاشة فارغة، مسح الحساب عن بُعد بكلمة المرور
- ✅ **لوحة مشتركة CRDT** في صلة (نمط Offline Protocol): عدّاد + قائمة تتقارب بين كل العقد عبر Mesh/P2P/الخادم
- ✅ **بوابة LoRa اختيارية** (نمط Meshtastic): جسر MQTT لعقد خارجية — معطلة بلا `LORA_MQTT_URL` وانقطاعها لا يمس صلة أبداً

## البنية

```
Rasan/
├── server/     Express + Socket.IO + better-sqlite3 + bcrypt + JWT
├── web/        Vanilla JS + Web Crypto + i18n + PWA (no build step)
├── mobile/     Flutter (placeholder)
└── data/       SQLite DB + uploads (gitignored)
```

## التشغيل

```bash
# 1) مفتاح JWT
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

# 2) الخادم
cd server
npm install
npm start
# → Rasan on http://localhost:3000

# 3) افتح http://localhost:3000
# على WiFi: http://IP-جهازك:3000
```

> ⚠️ **الإنتاج:** `JWT_SECRET` إلزامي (فارغ ⇒ إيقاف فوري fail-closed). اقرأ [SECURITY.md](SECURITY.md) قبل النشر.

## لقطات

| الواجهة | الميزة المعروضة |
|---|---|
| ![Rasan banner](.github/assets/banner.svg) | الواجهة الرئيسية — دردشة E2EE بلا رقم هاتف |

<!-- 💡 لقطات حقيقية: أضف PNG من التطبيق الحي في .github/assets/ وأدرجها هنا -->

## النشر — مسار واحد فقط

كل شيء يُنشر كـ **عملية Node واحدة** على Render: هي التي تخدم الواجهة (`web/`) وواجهة REST وSocket.IO
من **نفس الأصل (same origin)**، وقاعدة SQLite على قرص مُثبَّت. لهذا لا يوجد مسار نشر ثانٍ:

- **Vercel غير صالح لهذا التطبيق**: لا قرص دائم لـ SQLite، ولا خادم Socket.IO طويل العمر، والعميل
  مكتوب على `/api/...` و`io()` بنفس الأصل — نشر الواجهة وحدها يعطي دردشة بلا خادم.
- النشر لا يحدث بمجرد push: `autoDeploy: false` في `render.yaml`، والـCI هو من يقرر.

الإعداد لمرة واحدة:

```bash
# 1) Render → rasan-server → Settings → Deploy Hook → انسخ الرابط
gh secret set RENDER_DEPLOY_HOOK -R tibatechapp-ship-it/Rasan
# 2) عنوان الخدمة (يُستخدم لإثبات أن النسخة الجديدة هي الحيّة)
gh variable set RASAN_SITE_URL -R tibatechapp-ship-it/Rasan --body https://<service>.onrender.com
# 3) Render → Environment: أضف DATA_DIR=/opt/render/project/src/data (المُثبّت في blueprint)
```

بعد الدمج في `main`: إذا نجح `ci` يرسل `deploy-render.yml` طلب النشر، ثم ينتظر `/health` حتى يعلن
`commit` مطابقاً للـSHA المدفوع. **HTTP 200 لا يكفي** كدليل — النسخة القديمة تُرجع 200 أيضاً.

- مثيل واحد (`numInstances: 1`) بقصد: Socket.IO في الذاكرة + قرص SQLite = عملية واحدة.
  التوسّع الأفقي يحتاج مخزناً مشتركاً وقاعدة بيانات حقيقية أولاً.
- خطة `starter` ضرورية: الخطة المجانية على Render بلا قرص دائم → قاعدة البيانات تُمسح عند كل نشر.

فحص سريع للإنتاج:

```bash
curl -fsS https://<service>.onrender.com/health   # {"ok":true,"uptime":…,"version":"1.0.0","commit":"abc1234"}
```

## التوثيق

| الملف | المحتوى |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | كيف تساهم: بيئة التطوير، سير العمل، معايير القبول |
| [SECURITY.md](SECURITY.md) | سياسة الإبلاغ عن الثغرات ونموذج التهديد |
| [CHANGELOG.md](CHANGELOG.md) | سجل التغييرات الإصداري |

## الترخيص

MIT © TibaTech / Vixona Technologies
