import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rasan_mobile/push/push_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('PushApi — عميل نقاط الإشعارات', () {
    test('registerToken: بلا جلسة ⇒ false دون أي طلب شبكي', () async {
      var called = 0;
      final api = PushApi(
        client: MockClient((req) async {
          called++;
          return http.Response('{}', 200);
        }),
      );
      expect(await api.registerToken('fcm-token', 'android'), isFalse);
      expect(called, 0);
    });

    test('registerToken: POST /api/push/register مع Bearer و JSON صحيح',
        () async {
      Uri? uri;
      Map<String, String>? headers;
      String? body;
      final api = PushApi(
        client: MockClient((req) async {
          uri = req.url;
          headers = req.headers;
          body = req.body;
          return http.Response('{}', 200);
        }),
      )..setAuthToken('jwt-123');

      expect(await api.registerToken('fcm-token', 'android'), isTrue);
      expect(uri.toString(), endsWith('/api/push/register'));
      expect(headers!['Authorization'], 'Bearer jwt-123');
      expect(jsonDecode(body!), {'token': 'fcm-token', 'platform': 'android'});
    });

    test('unregisterToken: POST /api/push/unregister ويفشل بهدوء عند الخطأ',
        () async {
      Uri? uri;
      final api = PushApi(
        client: MockClient((req) async {
          uri = req.url;
          return http.Response('{"error":"x"}', 500);
        }),
      )..setAuthToken('jwt-123');

      expect(await api.unregisterToken('fcm-token'), isFalse);
      expect(uri.toString(), endsWith('/api/push/unregister'));

      expect(
        await api.unregisterToken('other'),
        isFalse,
      ); // لا جلسة بعد setAuthToken(null)
    });

    test('fetchPreferences: يقرأ preferences من الخادم (مصدر الحقيقة)',
        () async {
      final api = PushApi(
        client: MockClient((req) async {
          expect(req.method, 'GET');
          expect(req.url.toString(), endsWith('/api/push/preferences'));
          return http.Response(
            jsonEncode({
              'preferences': {
                'messages': false,
                'invites': true,
                'emergencies': true,
              },
            }),
            200,
          );
        }),
      )..setAuthToken('jwt-123');

      final prefs = await api.fetchPreferences();
      expect(prefs, {'messages': false, 'invites': true, 'emergencies': true});
    });

    test('savePreferences: PUT بمحتوى التفضيلات', () async {
      String? body;
      final api = PushApi(
        client: MockClient((req) async {
          body = req.body;
          return http.Response('{}', 200);
        }),
      )..setAuthToken('jwt-123');

      expect(
        await api.savePreferences(messages: false, invites: true),
        isTrue,
      );
      expect(
        jsonDecode(body!),
        {'messages': false, 'invites': true, 'emergencies': true},
      );
    });

    test('savePreferences: emergencies مفعّل صراحةً في الجسم', () async {
      String? body;
      final api = PushApi(
        client: MockClient((req) async {
          body = req.body;
          return http.Response('{}', 200);
        }),
      )..setAuthToken('jwt-123');

      expect(
        await api.savePreferences(
          messages: true,
          invites: true,
          emergencies: false,
        ),
        isTrue,
      );
      expect(jsonDecode(body!)['emergencies'], isFalse);
    });

    test('fetchPreferences: emergencies غائبة ⇒ false (لا تفعيل صامت)', () async {
      final api = PushApi(
        client: MockClient((req) async => http.Response(
              jsonEncode({
                'preferences': {'messages': true, 'invites': true},
              }),
              200,
            )),
      )..setAuthToken('jwt-123');

      final prefs = await api.fetchPreferences();
      expect(prefs!['emergencies'], isFalse);
    });

    test('فشل الشبكة ⇒ false/null بهدوء (لا استثناءات)', () async {
      final api = PushApi(
        client: MockClient((req) async => throw Exception('network down')),
      )..setAuthToken('jwt-123');

      expect(await api.registerToken('t', 'android'), isFalse);
      expect(await api.unregisterToken('t'), isFalse);
      expect(await api.fetchPreferences(), isNull);
      expect(await api.savePreferences(messages: true, invites: true),
          isFalse);
    });
  });
}
