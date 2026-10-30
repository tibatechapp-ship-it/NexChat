import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/auth/auth_service.dart';
import 'push/notification_preferences.dart';
import 'push/push_service.dart';
import 'screens/auth_gate.dart';
import 'theme/app_theme.dart';
import 'theme/theme_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // قراءة وضع المظهر المحفوظ قبل الإقلاع حتى لا يومض التطبيق
  // بثيم خاطئ ثم يتبدل (theme flash).
  final themeController = ThemeController();
  await themeController.load();

  // تهيئة الإشعارات (FCM) — تفشل بهدوء إن لم تُضبط إعدادات المنصة بعد
  // (google-services.json / APNs)، فيعمل التطبيق طبيعياً بلا إشعارات.
  // التسجيل الفعلي للتوكن يحدث عند توفر جلسة مستخدم (setAuthToken).
  await PushService.instance.initialize();

  final notificationPreferences = NotificationPreferences();
  // تحميل غير معطِّل — الواجهة تعرض القيم المحلية فوراً وتُحدَّث عند المزامنة.
  unawaited(notificationPreferences.load());

  // الجلسة: استعادة محلية سريعة (JWT من التخزين الآمن) — وعند وجود
  // جلسة يُعاد ربط توكن FCM بها فوراً (AuthService.restoreSession).
  final authController = AuthController();
  await authController.restore();

  runApp(
    RasanApp(
      themeController: themeController,
      notificationPreferences: notificationPreferences,
      authController: authController,
    ),
  );
}

class RasanApp extends StatelessWidget {
  const RasanApp({
    super.key,
    required this.themeController,
    required this.notificationPreferences,
    required this.authController,
  });

  final ThemeController themeController;
  final NotificationPreferences notificationPreferences;
  final AuthController authController;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<ThemeController>.value(value: themeController),
        ChangeNotifierProvider<NotificationPreferences>.value(
          value: notificationPreferences,
        ),
        ChangeNotifierProvider<AuthController>.value(value: authController),
      ],
      child: Consumer<ThemeController>(
        builder: (context, theme, _) => MaterialApp(
          title: 'رسن',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light,
          darkTheme: AppTheme.dark,
          // الوضع الليلي: light/dark/system — محفوظ في SharedPreferences
          // (مفتاح rasan_theme_mode) عبر ThemeController.
          themeMode: theme.mode,
          // بوابة المصادقة: جلسة ⇒ الرئيسية، وإلا شاشة الدخول.
          home: const AuthGate(),
        ),
      ),
    );
  }
}
