import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import '../core/auth/session_guard.dart';

/// عميل REST لنقاط الإشعارات في الخادم (`Config.apiBase`):
///
/// - `POST /api/push/register`     تسجيل توكن FCM بعد تسجيل الدخول
/// - `POST /api/push/unregister`   إلغاء تسجيل التوكن عند الخروج
/// - `GET  /api/push/preferences`  قراءة التفضيلات (الخادم مصدر الحقيقة)
/// - `PUT  /api/push/preferences`  حفظ تفضيلات الإشعارات (تشغيل/إيقاف)
///
/// كل النقاط تتطلب Bearer JWT — الطرق ترجع null/false بهدوء عند غياب
/// الجلسة أو فشل الشبكة، والمكوّنات الأعلى تقرر ماذا تفعل.
class PushApi {
  PushApi({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;
  String? _jwt;

  /// هل توجد جلسة مسجلة حالياً؟
  bool get hasAuth => _jwt != null;

  /// ضبط توكن الجلسة — يُمرَّر من تدفق تسجيل الدخول عند توفره.
  void setAuthToken(String? jwt) => _jwt = jwt;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_jwt != null) 'Authorization': 'Bearer $_jwt',
      };

  Uri _u(String path) => Uri.parse('${Config.apiBase}$path');

  /// معالج 401 المركزي: أي استجابة 401 هنا تعني أن الجلسة لم تعد
  /// صالحة — خروج قسري بالترتيب الإلزامي (إلغاء تسجيل الإشعارات
  /// ثم مسح JWT) وتوجيه إلى شاشة الدخول عبر AuthGate.
  ///
  /// ملاحظة: إلغاء التسجيل نفسه (`unregisterToken`) قد يرجع 401
  /// بجلسة منتهية — SessionGuard يمنع إعادة الدخول فلا حلقة.
  Future<void> _on401(http.Response res) async {
    if (res.statusCode == 401) {
      await SessionGuard.instance.onUnauthorized();
    }
  }

  /// تسجيل توكن FCM للمستخدم الحالي. false عند غياب الجلسة أو الفشل.
  Future<bool> registerToken(String fcmToken, String platform) async {
    if (_jwt == null) return false;
    try {
      final res = await _client.post(
        _u('/api/push/register'),
        headers: _headers,
        body: jsonEncode({'token': fcmToken, 'platform': platform}),
      );
      await _on401(res);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// إلغاء تسجيل توكن (عند الخروج أو كتم الجهاز).
  Future<bool> unregisterToken(String fcmToken) async {
    if (_jwt == null) return false;
    try {
      final res = await _client.post(
        _u('/api/push/unregister'),
        headers: _headers,
        body: jsonEncode({'token': fcmToken}),
      );
      await _on401(res);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// تفضيلات المستخدم من الخادم — null عند غياب الجلسة/الفشل.
  Future<Map<String, bool>?> fetchPreferences() async {
    if (_jwt == null) return null;
    try {
      final res =
          await _client.get(_u('/api/push/preferences'), headers: _headers);
      await _on401(res);
      if (res.statusCode != 200) return null;
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final prefs = body['preferences'] as Map<String, dynamic>?;
      if (prefs == null) return null;
      return {
        'messages': prefs['messages'] == true,
        'invites': prefs['invites'] == true,
        'emergencies': prefs['emergencies'] == true,
      };
    } catch (_) {
      return null;
    }
  }

  /// حفظ التفضيلات في الخادم. false عند غياب الجلسة/الفشل.
  Future<bool> savePreferences({
    required bool messages,
    required bool invites,
    bool emergencies = true,
  }) async {
    if (_jwt == null) return false;
    try {
      final res = await _client.put(
        _u('/api/push/preferences'),
        headers: _headers,
        body: jsonEncode({
          'messages': messages,
          'invites': invites,
          'emergencies': emergencies,
        }),
      );
      await _on401(res);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  void dispose() => _client.close();
}
