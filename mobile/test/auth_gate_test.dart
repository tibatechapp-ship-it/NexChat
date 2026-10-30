import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:rasan_mobile/core/auth/auth_service.dart';
import 'package:rasan_mobile/core/auth/session_guard.dart';
import 'package:rasan_mobile/push/push_api.dart';
import 'package:rasan_mobile/push/push_service.dart';
import 'package:rasan_mobile/screens/auth_gate.dart';
import 'package:rasan_mobile/screens/home_screen.dart';
import 'package:rasan_mobile/screens/login_screen.dart';
import 'package:rasan_mobile/theme/theme_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

Widget _wrap(AuthController auth) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<ThemeController>.value(value: ThemeController()),
      ChangeNotifierProvider<AuthController>.value(value: auth),
    ],
    child: const MaterialApp(home: AuthGate()),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  tearDown(() {
    // نظافة بين الاختبارات — المعالج مرفق لكل اختبار على حدة
    SessionGuard.instance.detach();
  });

  group('AuthGate — توجيه الشاشة حسب الجلسة', () {
    testWidgets('لا توكن ⇒ LoginScreen', (tester) async {
      final auth = AuthController(service: AuthService());

      await tester.pumpWidget(_wrap(auth));
      // مؤشر الاستعادة ثم شاشة الدخول (تخزين فارغ)
      unawaited(auth.restore());
      await tester.pumpAndSettle();

      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byType(HomeScreen), findsNothing);
      expect(auth.isAuthenticated, isFalse);
    });

    testWidgets('توكن صالح ⇒ HomeScreen مع اسم المستخدم', (tester) async {
      FlutterSecureStorage.setMockInitialValues({
        'rasan_jwt': 'jwt-valid',
        'rasan_username': 'sara',
      });

      final auth = AuthController(service: AuthService());
      await tester.pumpWidget(_wrap(auth));
      unawaited(auth.restore());
      await tester.pumpAndSettle();

      expect(find.byType(HomeScreen), findsOneWidget);
      expect(find.byType(LoginScreen), findsNothing);
      expect(find.text('مرحباً sara'), findsOneWidget);
      expect(auth.isAuthenticated, isTrue);
    });

    testWidgets('توكن تالف: تُعرض الرئيسية أولاً ثم أي 401 ⇒ LoginScreen '
        '(المعالج المركزي)', (tester) async {
      // توكن "تالف" محفوظ محلياً — البوابة لا تتحقق من صلاحيته
      // (قراءة محلية فقط) فتعرض الرئيسية...
      FlutterSecureStorage.setMockInitialValues({
        'rasan_jwt': 'broken.token.sig',
        'rasan_username': 'sara',
      });

      final auth = AuthController(service: AuthService());
      SessionGuard.instance.attach(auth.logout);

      await tester.pumpWidget(_wrap(auth));
      unawaited(auth.restore());
      await tester.pumpAndSettle();
      expect(find.byType(HomeScreen), findsOneWidget);

      // ...حتى يرد الخادم 401 على أي نداء (هنا: تسجيل توكن الإشعارات)
      // ⇒ المعالج المركزي: خروج قسري ثم توجيه إلى شاشة الدخول.
      final api = PushApi(
        client: MockClient(
          (req) async => http.Response('{"error":"jwt malformed"}', 401),
        ),
      )..setAuthToken('broken.token.sig');

      expect(await api.registerToken('fcm-token', 'android'), isFalse);
      await tester.pumpAndSettle();

      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byType(HomeScreen), findsNothing);
      expect(auth.isAuthenticated, isFalse);

      // الجلسة مُسحت فعلاً من التخزين الآمن
      expect(
        await const FlutterSecureStorage().read(key: 'rasan_jwt'),
        isNull,
      );
      // وفك ربط الإشعارات بالجلسة (لا Bearer JWT بعد الآن)
      expect(PushService.instance.api.hasAuth, isFalse);
    });
  });
}
