import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:rasan_mobile/core/auth/auth_service.dart';
import 'package:rasan_mobile/screens/login_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

Widget _wrap(AuthController auth) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AuthController>.value(value: auth),
    ],
    child: const MaterialApp(home: LoginScreen()),
  );
}

Future<void> _fillAndSubmit(WidgetTester tester) async {
  await tester.enterText(
      find.widgetWithText(TextFormField, 'اسم المستخدم'), 'ahmad');
  await tester.enterText(
      find.widgetWithText(TextFormField, 'كلمة المرور'), 'secret123');
  await tester.tap(find.text('تسجيل الدخول'));
  await tester.pump(); // التحقق من النموذج
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  group('LoginScreen — دورة الدخول الكاملة', () {
    testWidgets('نجاح الدخول: الجلسة تُنشأ ويختفي مؤشر التحميل', (tester) async {
      final auth = AuthController(
        service: AuthService(
          client: MockClient((req) async => http.Response(
                '{"token":"jwt-1","user":{"id":1,"username":"ahmad"}}',
                200,
              )),
        ),
      );

      await tester.pumpWidget(_wrap(auth));
      await _fillAndSubmit(tester);
      await tester.pumpAndSettle();

      expect(auth.isAuthenticated, isTrue);
      expect(auth.username, 'ahmad');
      // عاد الزر لوضعه الطبيعي (لا مؤشر تحميل بعد اكتمال الطلب)
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('أثناء التحميل: الزر معطّل ومؤشر تحميل يمنع الإرسال المزدوج',
        (tester) async {
      // طلب لا يكتمل إلا عندما نسمح — لمحاكاة بطء الشبكة
      final gate = Completer<http.Response>();
      final auth = AuthController(
        service: AuthService(
          client: MockClient((req) async {
            await drainEventQueue();
            return gate.future;
          }),
        ),
      );

      await tester.pumpWidget(_wrap(auth));
      await _fillAndSubmit(tester);
      await tester.pump(); // بدء الطلب

      final button =
          tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNull, reason: 'الزر معطّل أثناء التحميل');
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // ضغط إضافي أثناء التحميل لا يرسل طلباً ثانياً (الزر معطّل)
      await tester.tap(find.byType(FilledButton), warnIfMissed: false);
      await tester.pump();

      gate.complete(http.Response(
        '{"token":"jwt-2","user":{"id":1,"username":"ahmad"}}',
        200,
      ));
      await tester.pumpAndSettle();
      expect(auth.isAuthenticated, isTrue);
    });

    testWidgets('فشل الدخول: رسالة خطأ والزر يعود للعمل للإعادة',
        (tester) async {
      var attempts = 0;
      final auth = AuthController(
        service: AuthService(
          client: MockClient((req) async {
            attempts++;
            return http.Response('{"error":"wrong credentials"}', 401);
          }),
        ),
      );

      await tester.pumpWidget(_wrap(auth));
      await _fillAndSubmit(tester);
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('بيانات الدخول غير صحيحة'), findsOneWidget);
      expect(auth.isAuthenticated, isFalse);

      // الزر عاد للعمل — يمكن إعادة المحاولة فوراً
      final button =
          tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNotNull);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(attempts, 1);
    });
  });
}

/// تصريف أحداث microtask المعلقة قبل متابعة الاختبار — يضمن أن
/// نداء _submit بدأ فعلاً (وصل إلى MockClient) قبل فحص حالة الزر.
Future<void> drainEventQueue() async {
  await Future<void>.delayed(Duration.zero);
}
