# دليل إعداد الإشعارات (FCM) — تطبيق رسن

يشرح هذا الدليل الخطوات الكاملة لتشغيل الإشعارات الفورية (Push Notifications)
في تطبيق الجوال باستخدام Firebase Cloud Messaging (FCM)، مع توضيح السبب
الحاجة لكل خطوة، وما يعمل تلقائياً وما يتطلب تدخلك اليدوي.

## نظرة عامة على المعمارية

```
┌─────────────┐     POST /api/push/register      ┌──────────────┐
│ تطبيق الجوال │ ────── (توكن FCM + JWT) ───────▶ │ خادم رسن      │
│ (هذا المجلد) │ ◀──── FCM (نصوص قوالب آمنة) ──── │ firebase-admin│
└─────────────┘                                  └──────────────┘
```

1. الجوال يستلم **توكن FCM** من Firebase ويُسجّله لدى الخادم بعد تسجيل الدخول
   (`POST /api/push/register` — يتطلب Bearer JWT).
2. الخادم (server/) يرسل الإشعارات عبر `firebase-admin` إلى توكنات المستخدم.
3. **ضمانة E2EE محفوظة**: الخادم يرسل نصوصاً من قوالب ثابتة فقط
   («لديك رسالة جديدة») — الإشعار لا يحتوي أبداً على محتوى الرسالة المشفرة،
   والتطبيق يعرض في المقدمة نصوصاً من `NotificationTemplates` المحلية حصراً.

> **لماذا الملفات مفقودة؟** ملفات تهيئة Firebase (google-services.json /
> GoogleService-Info.plist) مرتبطة بمشروعك الخاص وحسابك — لا تُرفع أبداً إلى
> المستودع (راجع قسم الأمان أدناه). حتى تضيفها يعمل التطبيق طبيعياً بلا
> إشعارات: `PushService.initialize` يفشل بهدوء، وباقي الميزات سليمة.

## الخطوة 1 — إنشاء مشروع Firebase

1. افتح [Firebase Console](https://console.firebase.google.com/) وسجّل الدخول
   بحساب Google.
2. اضغط **Add project** وسمِّه (مثلاً `rasan-prod`).
3. Google Analytics اختياري — يمكنك تعطيله (غير مطلوب للإشعارات).
4. بعد الإنشاء افتح **Project settings** واحتفظ بـ **Project ID**.

## الخطوة 2 — تطبيق Android

1. في Firebase Console: **Project settings → Your apps → Add app → Android**.
2. أدخل اسم الحزمة **بدون أي خطأ**:
   ```
   com.rasan.rasan_mobile
   ```
   (هذه القيمة من `--org com.rasan` في `flutter create` — تطابق
   `applicationId` في `mobile/android/app/build.gradle.kts`).
3. SHA-1 **غير مطلوب** (لا نستخدم Google Sign-In ولا Dynamic Links).
4. نزّل **`google-services.json`** وضعه في:
   ```
   mobile/android/app/google-services.json
   ```
5. **انتهى** — إضافة Google Services مضبوطة شرطياً في
   `android/app/build.gradle.kts`: تُطبَّق تلقائياً فقط عند وجود الملف،
   لذا البناء ينجح قبله وبعده دون أي تعديل إضافي.

## الخطوة 3 — تطبيق iOS

1. Firebase Console: **Add app → iOS**.
2. أدخل معرّف الحزمة:
   ```
   com.rasan.rasanMobile
   ```
   (من `PRODUCT_BUNDLE_IDENTIFIER` في `ios/Runner.xcodeproj`).
3. نزّل **`GoogleService-Info.plist`** وضعه في:
   ```
   mobile/ios/Runner/GoogleService-Info.plist
   ```
4. من Xcode: أضف الملف إلى مشروع Runner (تأكد من تحديده لهدف Runner).
5. **مفتاح APNs مطلوب للإشعارات على الأجهزة الحقيقية**:
   - Apple Developer → Certificates, Identifiers & Profiles → Keys →
     أنشئ مفتاحاً بصلاحية **Apple Push Notifications service (APNs)**.
   - نزّل ملف `.p8` ثم في Firebase Console: **Project settings →
     Cloud Messaging → Apple app configuration → APNs Authentication Key**
     وارفع الملف مع إدخال **Key ID** و**Team ID**.
6. المحاكي يعمل بلا APNs؛ الأجهزة الحقيقية تتطلب الخطوة 5.

## الخطوة 4 — اعتماديات Firebase على الخادم

الخادم يرسل الإشعارات عبر `firebase-admin` (مُعلَنة في `server/package.json`):

1. Firebase Console: **Project settings → Service accounts →
   Generate new private key** — نزّل ملف JSON.
2. اجعله متاحاً للخادم بإحدى الطرق الثلاث (بالترتيب المفضّل):
   - **على Render (الموصى بها)**: اضبط متغير البيئة
     `FCM_SERVICE_ACCOUNT_JSON` بقيمة **محتوى ملف JSON كاملًا** (انسخ
     الملف كما هو والصقه في Environment على لوحة Render — أو عند أول
     Blueprint apply سيطالبك به لأنه معرّف `sync: false` في
     `render.yaml`). الخادم يقرأه مباشرة — لا ملف على القرص إطلاقًا.
   - اضبط مسار ملف عبر متغير البيئة:
     ```
     FCM_CREDENTIALS=/path/to/service-account.json
     ```
   - أو ضع الملف بجوار `server/push.js` باسم
     `firebase-service-account.json`.
3. أعد تشغيل الخادم — إن لم تتوفر أي طريقة فإن الخادم يعمل عاديّاً
   ويطبع `[push] disabled` كتحذير (الإشعارات معطلة فقط، والباقي سليم).

> **أمان الخادم**: ملف حساب الخدمة يمنح صلاحية إرسال إشعارات لكل مستخدمي
> مشروعك — لا ترفعه أبداً إلى Git ولا تضعه في مجلدات عامة.

## الخطوة 5 — التشغيل والاختبار

```bash
# 1) خادم محلي (بمجلد Rasan الجذري)
npm install && npm start          # المنفذ 3000

# 2) الجوال — محاكي أندرويد يصل إلى مضيفك عبر 10.0.2.2 تلقائياً
cd mobile
flutter pub get
flutter run

# لجهاز حقيقي على الشبكة نفسها:
flutter run --dart-define=API_BASE=http://<IP-جهازك>:3000
```

تسلسل الاختبار المتوقع:

1. شغّل التطبيق → وافق على إذن الإشعارات (Android 13+ يطلب وقت التشغيل).
2. سجّل الدخول بحساب موجود (التسجيل الجديد حالياً من عميل الويب —
   يتطلب توليد مفاتيح E2EE). عند النجاح يُرسل الجوال توكن FCM فوراً إلى
   `/api/push/register` — تحقّق من جدول `device_tokens` في قاعدة الخادم.
3. أرسل رسالة من حساب آخر عبر الويب → يصل إشعار بنص «لديك رسالة جديدة».
4. أطفئ «إشعارات الرسائل الجديدة» من الإعدادات → أرسل رسالة → لا إشعار
   (الخادم يفحص التفضيلات قبل الإرسال — `notifications.canPush`).
5. سجّل الخروج → يُلغى تسجيل التوكن (`/api/push/unregister`) ويختفي من
   `device_tokens`.

## دورة حياة توكن FCM في التطبيق

| الحدث | السلوك |
|---|---|
| إقلاع التطبيق | `Firebase.initializeApp()` + طلب الصلاحية + جلب التوكن |
| توفر جلسة (دخول/استعادة) | `setAuthToken(jwt)` ⇒ تسجيل التوكن لدى الخادم |
| دوران التوكن | مستمع `onTokenRefresh` ⇒ إعادة تسجيل فورية |
| تسجيل الخروج | إلغاء التسجيل لدى الخادم ثم مسح الجلسة |
| غياب إعدادات Firebase | تجاهل هادئ — التطبيق يعمل بلا إشعارات |

## استكشاف الأخطاء

| المشكلة | السبب المحتمل والحل |
|---|---|
| `[push] Firebase غير مهيأ` في اللوج | `google-services.json` غير موجود في `android/app/` أو أُعيد بناء المشروع قبله — ضع الملف ثم `flutter clean && flutter run` |
| البناء يفشل عند `google-services` | تحقق من تطابق اسم الحزمة في Firebase مع `com.rasan.rasan_mobile` حرفياً |
| لا إشعارات على iOS جهاز حقيقي | مفتاح APNs غير مرفوع أو غير صحيح (الخطوة 3-5) |
| التوكن لا يُسجَّل لدى الخادم | تسجّل الدخول أولاً — التسجيل يتطلب JWT؛ راجع لوج الخادم لطلب `POST /api/push/register` |
| إشعار يصل بلا صوت/عرض في المقدمة | طبيعي في المقدمة — التطبيق يعرضه محلياً عبر القناة «messages»؛ تحقق من إعدادات قناة النظام |
| `minSdk` أقل من 23 | المشروع مضبوط على `maxOf(23, flutter.minSdkVersion)` — لا تخفضه |

## ملاحظات أمان

- **لا ترفع أبداً** إلى المستودع: `google-services.json` —
  `GoogleService-Info.plist` — ملف حساب خدمة Firebase — مفاتيح APNs.
  (الملفان الأولان يُعدَّان بأمانة أقل حساسية من ملف حساب الخدمة، لكن
  القاعدة الواحدة أسهل: كل ما يأتي من Firebase Console يبقى خارج Git —
  أضف المسارات إلى `.gitignore` إن لم تكن).
- نصوص الإشعارات قوالب ثابتة على طرفي الإرسال والعرض — لا مسار يعكس
  محتوى رسالة مشفرة في أي إشعار.
- صلاحية `POST_NOTIFICATIONS` تُطلب وقت التشغيل عند أول تهيئة (Android 13+).
