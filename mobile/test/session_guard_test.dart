import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rasan_mobile/core/auth/session_guard.dart';
import 'package:rasan_mobile/push/push_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    SessionGuard.instance.detach();
  });

  group('SessionGuard — معالج 401 المركزي', () {
    test('بلا معالج مرفق: onUnauthorized لا يفعل شيئاً ولا يرمي', () async {
      // قبل attach — يجب أن تعود بهدوء (سلوك الاختبارات/قبل الإقلاع)
      await SessionGuard.instance.onUnauthorized();
    });

    test('معالج مرفق: أي 401 من PushApi يُنفّذ الخروج القسري', () async {
      var forcedLogouts = 0;
      SessionGuard.instance.attach(() async => forcedLogouts++);

      final api = PushApi(
        client: MockClient(
          (req) async => http.Response('{"error":"token expired"}', 401),
        ),
      )..setAuthToken('jwt-expired');

      final registered = await api.registerToken('fcm-token', 'android');
      expect(registered, isFalse); // 401 وليست 200
      expect(forcedLogouts, 1); // المعالج نُفّذ مرة بالضبط
    });

    test('200 لا يُفعّل المعالج — فقط 401', () async {
      var forcedLogouts = 0;
      SessionGuard.instance.attach(() async => forcedLogouts++);

      final api = PushApi(
        client: MockClient((req) async => http.Response('{}', 200)),
      )..setAuthToken('jwt-ok');

      expect(await api.registerToken('fcm-token', 'android'), isTrue);
      expect(await api.unregisterToken('fcm-token'), isTrue);
      expect(forcedLogouts, 0);
    });

    test('استدعاءات متزامنة (401 من طلبين متوازيين): تنفيذ واحد فقط',
        () async {
      var forcedLogouts = 0;
      SessionGuard.instance.attach(() async {
        forcedLogouts++;
        // محاكاة زمن شبكة حتى تتقاطع الاستدعاءات فعلاً
        await Future<void>.delayed(const Duration(milliseconds: 20));
      });

      final api = PushApi(
        client: MockClient(
          (req) async => http.Response('{"error":"expired"}', 401),
        ),
      )..setAuthToken('jwt-expired');

      // نداءان متوازيان يرجعان 401 معاً
      await Future.wait([
        api.registerToken('fcm-1', 'android'),
        api.registerToken('fcm-2', 'android'),
      ]);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(forcedLogouts, 1);
    });

    test('لا حلقة لانهائية: الخروج القسري نفسه يرجع 401 (جلسة منتهية)',
        () async {
      var forcedLogouts = 0;
      // المعالج (AuthController.logout فعلياً) يستدعي unregisterToken —
      // وإن رجع 401 فسيتولد onUnauthorized داخل التنفيذ الجاري.
      SessionGuard.instance.attach(() async {
        forcedLogouts++;
        final api = PushApi(
          client: MockClient(
            (req) async => http.Response('{"error":"expired"}', 401),
          ),
        )..setAuthToken('jwt-expired');
        // لا ننتظرها إن دمجت — لكن انتظارها هنا يختبر منع إعادة الدخول
        await api.unregisterToken('fcm-token');
      });

      final api = PushApi(
        client: MockClient(
          (req) async => http.Response('{"error":"expired"}', 401),
        ),
      )..setAuthToken('jwt-expired');

      await api.registerToken('fcm-token', 'android');
      // إن كانت هناك حلقة لانهائية لَلن نصل إلى هذا السطر أصلاً
      // (الاختبار يفشل بمهلة اختبار flutter_test).
      expect(forcedLogouts, 1);
    });
  });
}
