# رسن — Rasan

> **"خيطٌ يربط، لا يقطع"** — تطبيق دردشة حديث يجمع خير WhatsApp + Telegram + Signal، ويحل عيوبهم: الثقل، التبعية للرقم، وضعف E2EE.

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
- ✅ مفتوح المصدر، قابل للاستضافة الذاتية
- ✅ يعمل على WiFi (LAN) والإنترنت

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

## الترخيص

MIT © TibaTech / Vixona Technologies
