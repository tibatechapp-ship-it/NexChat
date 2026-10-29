# Rasan Mobile (Flutter)

Native Android/iOS client. Planned: chat list, conversation view, WiFi discovery (mDNS), push notifications.

Setup: `flutter pub get && flutter run`

## Dark Mode (الوضع الليلي)

- ثلاثة أوضاع قابلة للتبديل: **فاتح / داكن / حسب النظام** (`ThemeMode`).
- الاختيار محفوظ محلياً في **SharedPreferences** (المفتاح: `rasan_theme_mode`) ويُقرأ عند الإقلاع قبل `runApp` لتجنّب وميض الثيم.
- زر التبديل: **الإعدادات ← المظهر** (شاشة الإعدادات الجديدة).
- الملفات المعنية:
  - `lib/theme/theme_controller.dart` — `ThemeController` (ChangeNotifier) للحفظ والاسترجاع.
  - `lib/theme/app_theme.dart` — تعريف الثيمين الفاتح والداكن (Material 3 من بذرة واحدة).
  - `lib/main.dart` — ربط `themeMode` بالـ controller.
  - `lib/screens/settings_screen.dart` — واجهة التبديل.
