import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:rasan_mobile/core/auth/auth_service.dart';
import 'package:rasan_mobile/push/notification_preferences.dart';
import 'package:rasan_mobile/push/push_api.dart';
import 'package:rasan_mobile/screens/auth_gate.dart';
import 'package:rasan_mobile/screens/login_screen.dart';
import 'package:rasan_mobile/screens/settings_screen.dart';
import 'package:rasan_mobile/theme/theme_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

Widget _wrap({
  required Widget child,
  required ThemeController theme,
  AuthController? auth,
  NotificationPreferences? notif,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<ThemeController>.value(value: theme),
      if (auth != null) ChangeNotifierProvider<AuthController>.value(value: auth),
      if (notif != null)
        ChangeNotifierProvider<NotificationPreferences>.value(value: notif),
    ],
    child: MaterialApp(home: child),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  group('LoginScreen — شاشة تسجيل الدخول', () {
    testWidgets('التحقق: اسم مستخدم غير صالح يظهر رسالة ولا يلمس الشبكة',
        (tester) async {
      var networkCalls = 0;
      final auth = AuthController(
        service: AuthService(
          client: MockClient((req) async {
            networkCalls++;
            return http.Response('{}', 200);
          }),
        ),
      );

      await tester.pumpWidget(_wrap(
        theme: ThemeController(),
        auth: auth,
        child: const LoginScreen(),
      ));

      await tester.enterText(
        find.widgetWithText(TextFormField, 'اسم المستخدم'),
        'أحمد!', // غير مطابق للنمط
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'كلمة المرور'),
        'secret123',
      );
      await tester.tap(find.text('تسجيل الدخول'));
      await tester.pump();

      expect(find.text('أحرف إنجليزية وأرقام وشرطة سفلية (3-24)'),
          findsOneWidget);
      expect(networkCalls, 0);
    });

    testWidgets('فشل الدخول (401) يعرض رسالة الخطأ من الخدمة', (tester) async {
      final auth = AuthController(
        service: AuthService(
          client: MockClient((req) async =>
              http.Response('{"error":"wrong credentials"}', 401)),
        ),
      );

      await tester.pumpWidget(_wrap(
        theme: ThemeController(),
        auth: auth,
        child: const LoginScreen(),
      ));

      await tester.enterText(
          find.widgetWithText(TextFormField, 'اسم المستخدم'), 'ahmad');
      await tester.enterText(
          find.widgetWithText(TextFormField, 'كلمة المرور'), 'wrong-pass');
      await tester.tap(find.text('تسجيل الدخول'));
      await tester.pump(); // التحقق
      await tester.pump(const Duration(milliseconds: 300)); // الشبكة + SnackBar

      expect(find.text('بيانات الدخول غير صحيحة'), findsOneWidget);
      expect(auth.isAuthenticated, isFalse);
    });

    testWidgets('نجاح الدخول يُبلغ AuthController (تتحول البوابة للرئيسية)',
        (tester) async {
      final auth = AuthController(
        service: AuthService(
          client: MockClient((req) async => http.Response(
                '{"token":"jwt-1","user":{"id":1,"username":"ahmad"}}',
                200,
              )),
        ),
      );

      await tester.pumpWidget(_wrap(
        theme: ThemeController(),
        auth: auth,
        child: const AuthGate(), // لا جلسة محفوظة ⇒ دخول
      ));
      await tester.pump(); // بدء البناء
      unawaited(auth.restore()); // استعادة محلية (تخزين فارغ)
      await tester.pumpAndSettle();

      expect(find.byType(LoginScreen), findsOneWidget);

      await tester.enterText(
          find.widgetWithText(TextFormField, 'اسم المستخدم'), 'ahmad');
      await tester.enterText(
          find.widgetWithText(TextFormField, 'كلمة المرور'), 'secret123');
      await tester.tap(find.text('تسجيل الدخول'));
      await tester.pumpAndSettle();

      expect(auth.isAuthenticated, isTrue);
      expect(auth.username, 'ahmad');
    });
  });

  group('SettingsScreen — الإعدادات (المظهر والإشعارات)', () {
    testWidgets('اختيار الوضع الداكن يطبّق فوراً ويحفظ', (tester) async {
      final theme = ThemeController();
      await theme.load();

      await tester.pumpWidget(_wrap(
        theme: theme,
        notif: NotificationPreferences(api: PushApi(client: MockClient(
          (req) async => http.Response('{}', 200),
        ))),
        child: const SettingsScreen(),
      ));

      expect(theme.mode, ThemeMode.system);

      await tester.tap(find.text('داكن (وضع ليلي)'));
      await tester.pump();
      expect(theme.mode, ThemeMode.dark);

      final sp = await SharedPreferences.getInstance();
      expect(sp.getString('rasan_theme_mode'), 'dark');
    });

    testWidgets('إيقاف إشعارات الرسائل من المفتاح يُحفظ محلياً',
        (tester) async {
      final theme = ThemeController();
      await theme.load();

      final notif = NotificationPreferences(
        api: PushApi(
          client: MockClient((req) async => http.Response('{}', 200)),
        )..setAuthToken('jwt-test'),
      );
      await notif.load();

      await tester.pumpWidget(_wrap(
        theme: theme,
        notif: notif,
        child: const SettingsScreen(),
      ));

      expect(notif.messagesEnabled, isTrue);
      await tester.tap(
          find.text('إشعارات الرسائل الجديدة'));
      await tester.pump();
      expect(notif.messagesEnabled, isFalse);

      final sp = await SharedPreferences.getInstance();
      expect(sp.getBool('rasan_notif_messages'), isFalse);
    });
  });

  group('AuthGate — بوابة المصادقة', () {
    testWidgets('أثناء الاستعادة: مؤشر تحميل ثم شاشة الدخول', (tester) async {
      final auth = AuthController(service: AuthService());

      await tester.pumpWidget(_wrap(
        theme: ThemeController(),
        auth: auth,
        child: const AuthGate(),
      ));
      // restore لم يكتمل بعد ⇒ spinner
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      unawaited(auth.restore()); // تخزين فارغ ⇒ لا جلسة
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
    });
  });
}
