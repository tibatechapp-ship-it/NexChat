# رسن — Rasan

> **"خيطٌ يربط، لا يقطع"** — تطبيق دردشة حديث يجمع خير WhatsApp + Telegram + Signal، ويحل عيوبهم: الثقل، التبعية للرقم، وضعف E2EE.

## الميزات

- ✅ E2EE افتراضي (ECDH P-256 + AES-GCM عبر Web Crypto — 0KB مكتبات)
- ✅ تحقق من الهوية (TOFU + أرقام أمان + QR) — v1.1 (T1)
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

## الترخيص

MIT © TibaTech / Vixona Technologies
