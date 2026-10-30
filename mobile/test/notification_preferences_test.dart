import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rasan_mobile/push/notification_preferences.dart';
import 'package:rasan_mobile/push/push_api.dart';
import 'package:shared_preferences/shared_preferences.dart';

NotificationPreferences _prefsWith(void Function(http.Request) onRequest,
    {String? jwt}) {
  final api = PushApi(
    client: MockClient((req) async {
      onRequest(req);
      return http.Response('{}', 200);
    }),
  )..setAuthToken(jwt);
  return NotificationPreferences(api: api);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  group('NotificationPreferences — تشغيل/إيقاف الإشعارات', () {
    test('load: الافتراضي كله مفعّل، ثم يطبّق الخادم عند الاختلاف', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final prefs = _prefsWith(
        (req) {}, // fetchPreferences بلا جلسة ⇒ لن يُستدعى
      );

      await prefs.load();
      expect(prefs.loaded, isTrue);
      expect(prefs.messagesEnabled, isTrue);
      expect(prefs.invitesEnabled, isTrue);
    });

    test('load: الخادم مصدر الحقيقة — يطبّق الإيقاف البعيد', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final api = PushApi(
        client: MockClient((req) async {
          expect(req.method, 'GET');
          return http.Response(
            jsonEncode({
              'preferences': {'messages': false, 'invites': false},
            }),
            200,
          );
        }),
      )..setAuthToken('jwt-x');

      final remotePrefs = NotificationPreferences(api: api);
      await remotePrefs.load();
      expect(remotePrefs.messagesEnabled, isFalse);
      expect(remotePrefs.invitesEnabled, isFalse);

      // وحُفظت محلياً للمزامنة القادمة
      final sp = await SharedPreferences.getInstance();
      expect(sp.getBool('rasan_notif_messages'), isFalse);
      expect(sp.getBool('rasan_notif_invites'), isFalse);
    });

    test('setMessages: يغيّر ويحفظ محلياً حتى بلا جلسة (تعمل بلا شبكة)',
        () async {
      var networkCalls = 0;
      final prefs = _prefsWith((req) => networkCalls++); // بلا jwt ⇒ لا طلب

      await prefs.load();
      await prefs.setMessages(false);
      expect(prefs.messagesEnabled, isFalse);
      expect(networkCalls, 0); // بلا جلسة: محلي فقط

      final sp = await SharedPreferences.getInstance();
      expect(sp.getBool('rasan_notif_messages'), isFalse);
    });

    test('setMessages مع جلسة: مزامنة PUT مع الخادم', () async {
      final bodies = <String>[];
      final api = PushApi(
        client: MockClient((req) async {
          bodies.add(req.body);
          return http.Response('{}', 200);
        }),
      )..setAuthToken('jwt-x');
      final prefs = NotificationPreferences(api: api);

      await prefs.load();
      await prefs.setInvites(false);
      expect(prefs.invitesEnabled, isFalse);
      // الجسم الوحيد غير الفارغ هو PUT التفضيلات (GET لا جسم له)
      expect(
        bodies.where((b) => b.isNotEmpty).single,
        jsonEncode({'messages': true, 'invites': false, 'emergencies': true}),
      );
    });

    test('تعيين نفس القيمة لا ينتج إشعاراً إضافياً', () async {
      final prefs = _prefsWith((req) {});
      await prefs.load();

      var notified = 0;
      prefs.addListener(() => notified++);
      await prefs.setMessages(true); // نفس القيمة الافتراضية
      expect(notified, 0);
      await prefs.setMessages(false);
      expect(notified, 1);
    });
  });
}
