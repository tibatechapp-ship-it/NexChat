# Rasan Mobile (Flutter)

Native Android/iOS client. Planned: chat list, conversation view, WiFi discovery (mDNS), push notifications.

Setup: `flutter pub get && flutter run`

## Dark Mode (الوضع الليلي)

- ثلاثة أوضاع قابلة للتبديل: **فاتح / داكن / حسب النظام** (`ThemeMode`).
- الاختيار محفوظ محلياً في **SharedPreferences** (المفتاح: `rasan_theme_mode`) ويُقرأ عند الإقلاع قبل `runApp` لتجنّب وميض الثيم.
- زر التبديل: **الإعدادات ← المظهر**.
- الملفات المعنية:
  - `lib/theme/theme_controller.dart` — `ThemeController` (ChangeNotifier) للحفظ والاسترجاع.
  - `lib/theme/app_theme.dart` — تعريف الثيمين الفاتح والداكن (Material 3 من بذرة واحدة).
  - `lib/main.dart` — ربط `themeMode` بالـ controller.
  - `lib/screens/settings_screen.dart` — واجهة التبديل.

## Push Notifications (الإشعارات — FCM)

إشعارات آمنة تحترم E2EE: **لا تحتوي أبداً على محتوى الرسالة** — نصوص ثابتة فقط
("لديك رسالة جديدة" / "لديك دعوة إلى مجموعة") تُبنى في الخادم من
`server/notifications.js` وفي الجوال من `lib/push/notification_templates.dart`.

### الأنواع المدعومة
| النوع | النص | data.kind |
|---|---|---|
| رسالة جديدة | لديك رسالة جديدة | `new_message` |
| دعوة إلى مجموعة | لديك دعوة إلى مجموعة | `group_invite` |

### التحكم في الإشعارات
- **الإعدادات ← الإشعارات**: مفتاح تشغيل/إيقاف لكل نوع.
- الحفظ محلياً فوراً (SharedPreferences: `rasan_notif_messages`, `rasan_notif_invites`)
  **ومزامنة مع الخادم** (`GET/PUT /api/push/preferences`) — الخادم يمنع الإرسال
  أصلاً للأجهزة المطفأة (توفير بطارية وبيانات).

### الملفات المعنية
- `lib/push/push_service.dart` — `PushService` singleton: تهيئة Firebase، طلب الصلاحيات،
  تسجيل التوكن وإعادة التسجيل عند الدوران، عرض محلي آمن في المقدمة.
- `lib/push/push_api.dart` — عميل REST لنقاط `/api/push/*` (تسجيل، إلغاء، تفضيلات).
- `lib/push/notification_preferences.dart` — `NotificationPreferences` (ChangeNotifier).
- `lib/push/notification_templates.dart` — مرآة قوالب الخادم الثابتة.
- `lib/main.dart` — تهيئة الخدمة عند الإقلاع (تفشل بهدوء بلا إعدادات منصة).

### خطوات إعداد المنصة (مرة واحدة)
مكتبات FCM مضافة إلى pubspec، وتطبيق الجوال يعمل **بدون** الإشعارات حتى تُستكمل
هذه الخطوات (التهيئة تفشل بهدوء):

1. أنشئ مشروع Firebase وأضف تطبيقي Android/iOS فيه (حزمة `rasan_mobile`).
2. **Android**: ضع `android/app/google-services.json` وأضف إضافتي
   `com.google.gms.google-services` و`com.google.firebase.crashlytics` (اختياري) إلى Gradle.
3. **iOS**: ضع `ios/Runner/GoogleService-Info.plist` وارفع مفتاح APNs (.p8) إلى
   Firebase Console ← Project Settings ← Cloud Messaging.
4. **الخادم**: ضع ملف حساب الخدمة في `server/firebase-service-account.json`
   (أو اضبط `FCM_CREDENTIALS`) — راجع `server/push.js`.
5. شغّل `flutterfire configure` كبديل أوتوماتيكي للخطوتين 2-3 إن رغبت.

### تدفق التسجيل
1. المستخدم يسجل الدخول ⇒ استدعِ `PushService.instance.setAuthToken(jwt)`.
2. الخدمة تسجل توكن FCM لدى الخادم (`POST /api/push/register`, platform: android/ios).
3. عند دوران التوكن تتم إعادة التسجيل تلقائياً (`onTokenRefresh`).
4. عند الخروج: `POST /api/push/unregister` مع التوكن.
