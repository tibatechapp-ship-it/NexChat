import 'dart:convert';
import 'dart:io' show SocketException;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rasan_mobile/core/auth/auth_service.dart';
import 'package:rasan_mobile/push/push_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  group('AuthService — الجلسة والربط مع الإشعارات', () {
    test('login ناجح: يحفظ JWT ويُعيد اسم المستخدم', () async {
      final service = AuthService(
        client: MockClient((req) async {
          expect(req.method, 'POST');
          expect(req.url.toString(), endsWith('/api/auth/login'));
          final payload = jsonDecode(req.body) as Map<String, dynamic>;
          expect(payload, {
            'username': 'ahmad',
            'password': 'secret123',
          });
          return http.Response(
            jsonEncode({
              'token': 'jwt-abc',
              'user': {'id': 1, 'username': 'ahmad'},
            }),
            200,
          );
        }),
      );

      final result = await service.login('ahmad', 'secret123');
      expect(result.ok, isTrue);
      expect(result.username, 'ahmad');
      expect(service.hasSession, isTrue);
      expect(service.jwt, 'jwt-abc');

      // الجلسة محفوظة في التخزين الآمن
      final stored = await const FlutterSecureStorage().read(key: 'rasan_jwt');
      expect(stored, 'jwt-abc');
    });

    test('login فاشل (401): رسالة عربية واضحة بلا جلسة', () async {
      final service = AuthService(
        client: MockClient((req) async => http.Response(
            jsonEncode({'error': 'wrong credentials'}), 401)),
      );

      final result = await service.login('ahmad', 'wrong-pass');
      expect(result.ok, isFalse);
      expect(result.error, 'بيانات الدخول غير صحيحة');
      expect(service.hasSession, isFalse);
    });

    test('login فاشل (شبكة): يفشل بهدوء برسالة ودّية', () async {
      final service = AuthService(
        client: MockClient((req) async => throw const SocketException('no net')),
      );

      final result = await service.login('ahmad', 'secret123');
      expect(result.ok, isFalse);
      expect(result.error, contains('تعذر الوصول إلى الخادم'));
    });

    test('restoreSession: يقرأ الجلسة المحفوظة ويربط توكن الإشعارات',
        () async {
      FlutterSecureStorage.setMockInitialValues({
        'rasan_jwt': 'jwt-saved',
        'rasan_username': 'sara',
      });

      final service = AuthService();
      expect(await service.restoreSession(), isTrue);
      expect(service.username, 'sara');
      // ★ الربط: توفر الجلسة ⇒ PushService يستلم التوكن
      // (جاهزية تسجيل FCM — الطلب الفعلي يتطلب توكن FCM حقيقياً)
      expect(PushService.instance.api.hasAuth, isTrue);
    });

    test('restoreSession: بلا جلسة محفوظة ⇒ false', () async {
      final service = AuthService();
      expect(await service.restoreSession(), isFalse);
      expect(service.hasSession, isFalse);
    });

    test('logout: يمسح الجلسة ويحذف المخزن (بلا توكن FCM لا يوجد طلب إلغاء)',
        () async {
      FlutterSecureStorage.setMockInitialValues({
        'rasan_jwt': 'jwt-old',
        'rasan_username': 'sara',
      });

      final service = AuthService();
      await service.restoreSession();
      expect(PushService.instance.api.hasAuth, isTrue);

      await service.logout();
      expect(service.hasSession, isFalse);
      expect(service.jwt, isNull);

      final stored = await const FlutterSecureStorage().read(key: 'rasan_jwt');
      expect(stored, isNull);
      expect(
        await const FlutterSecureStorage().read(key: 'rasan_username'),
        isNull,
      );
      // ★ فك الربط: بعد الخروج لا جلسة للإشعارات
      expect(PushService.instance.api.hasAuth, isFalse);
    });
  });
}
