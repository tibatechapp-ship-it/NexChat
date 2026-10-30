import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../../config.dart';
import '../../push/push_service.dart';

/// نتيجة محاولة تسجيل الدخول.
class AuthResult {
  const AuthResult.ok(this.username)
      : error = null,
        token = null;

  const AuthResult.failure(this.error)
      : username = null,
        token = null;

  final String? username;
  final String? token;
  final String? error;

  bool get ok => error == null;
}

/// خدمة الجلسة (تسجيل الدخول/الخروج/استعادة الجلسة).
///
/// التخزين: JWT في `flutter_secure_storage` (Keychain / EncryptedSharedPreferences).
///
/// **الربط مع الإشعارات** — جوهر تكامل الإشعارات مع الهوية:
/// - بعد نجاح `login` تُستدعى `PushService.setAuthToken(jwt)` فوراً،
///   فيُسجَّل توكن FCM لدى الخادم عبر `POST /api/push/register`.
/// - عند `logout` يُلغى تسجيل التوكن عبر `POST /api/push/unregister`
///   *قبل* مسح الجلسة (الإلغاء يتطلب Bearer JWT).
/// - عند إقلاع التطبيق تُستعاد الجلسة محلياً ويُعاد ربط توكن الإشعارات.
class AuthService {
  AuthService({http.Client? client, FlutterSecureStorage? storage})
      : _client = client ?? http.Client(),
        _storage = storage ?? const FlutterSecureStorage();

  static const _jwtKey = 'rasan_jwt';
  static const _usernameKey = 'rasan_username';

  final http.Client _client;
  final FlutterSecureStorage _storage;

  String? _jwt;
  String? _username;

  String? get jwt => _jwt;
  String? get username => _username;
  bool get hasSession => _jwt != null;

  /// استعادة الجلسة المحفوظة عند إقلاع التطبيق (قراءة محلية فقط، بلا شبكة).
  ///
  /// يُعاد ربط توكن الإشعارات بالجلسة — إن لم يكن توكن FCM جاهزاً بعد
  /// فسيكفل مسار `PushService.initialize` بالتسجيل عند اكتماله.
  Future<bool> restoreSession() async {
    try {
      _jwt = await _storage.read(key: _jwtKey);
      _username = await _storage.read(key: _usernameKey);
    } catch (e) {
      debugPrint('[auth] restore failed: $e');
      _jwt = null;
      _username = null;
    }
    if (_jwt != null) {
      PushService.instance.setAuthToken(_jwt);
    }
    return _jwt != null;
  }

  /// تسجيل الدخول عبر `POST /api/auth/login`.
  ///
  /// عند النجاح: يُحفظ JWT محلياً ويُربط بخدمة الإشعارات —
  /// الذي بدوره يسجّل توكن FCM لدى الخادم فوراً.
  Future<AuthResult> login(String username, String password) async {
    final u = username.trim();
    try {
      final res = await _client.post(
        Uri.parse('${Config.apiBase}/api/auth/login'),
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode({'username': u, 'password': password}),
      );
      if (res.statusCode != 200) {
        return AuthResult.failure(
          res.statusCode == 401
              ? 'بيانات الدخول غير صحيحة'
              : 'تعذر تسجيل الدخول (رمز ${res.statusCode})',
        );
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final token = body['token'] as String?;
      final user = body['user'] as Map<String, dynamic>?;
      if (token == null || token.isEmpty) {
        return const AuthResult.failure('استجابة غير صالحة من الخادم');
      }
      _jwt = token;
      _username = (user?['username'] as String?) ?? u;
      await _storage.write(key: _jwtKey, value: token);
      await _storage.write(key: _usernameKey, value: _username!);
      // ★ نقطة الربط: توفر الجلسة ⇒ تسجيل توكن FCM لدى الخادم.
      await PushService.instance.setAuthToken(token);
      return AuthResult.ok(_username!);
    } on TimeoutException {
      return const AuthResult.failure('انتهت مهلة الاتصال بالخادم');
    } catch (e) {
      debugPrint('[auth] login failed: $e');
      return const AuthResult.failure(
          'تعذر الوصول إلى الخادم — تحقق من الاتصال');
    }
  }

  /// تسجيل الخروج:
  /// 1. إلغاء تسجيل توكن FCM لدى الخادم (`POST /api/push/unregister`)
  ///    — يتطلب الجلسة، لذا يحدث قبل مسحها.
  /// 2. فصل ربط الإشعارات عن الجلسة.
  /// 3. مسح JWT محلياً.
  Future<void> logout() async {
    final fcm = PushService.instance.token;
    if (fcm != null) {
      try {
        await PushService.instance.api.unregisterToken(fcm);
      } catch (e) {
        debugPrint('[auth] push unregister failed (تجاهل): $e');
      }
    }
    PushService.instance.setAuthToken(null);
    _jwt = null;
    _username = null;
    await _storage.delete(key: _jwtKey);
    await _storage.delete(key: _usernameKey);
  }

  void dispose() => _client.close();
}

/// وحدة تحكم الجلسة للواجهة — ChangeNotifier يعرض حالة المصادقة.
class AuthController extends ChangeNotifier {
  AuthController({AuthService? service}) : _service = service ?? AuthService();

  final AuthService _service;

  bool _restoring = true;
  bool _busy = false;

  /// هل استعادة الجلسة عند الإقلاع جارية؟
  bool get restoring => _restoring;

  /// هل عملية دخول/خروج جارية الآن؟ (لإبطال زر الإرسال)
  bool get busy => _busy;

  bool get isAuthenticated => _service.hasSession;
  String? get username => _service.username;

  /// استعادة الجلسة المحفوظة — تُستدعى مرة عند الإقلاع قبل runApp.
  Future<void> restore() async {
    await _service.restoreSession();
    _restoring = false;
    notifyListeners();
  }

  /// تسجيل الدخول — يعيد النتيجة (لعرض الخطأ في الواجهة)،
  /// وعند النجاح يُعاد بناء [AuthGate] تلقائياً ويُعرض الرئيسية.
  Future<AuthResult> login(String username, String password) async {
    _busy = true;
    notifyListeners();
    final result = await _service.login(username, password);
    _busy = false;
    notifyListeners();
    return result;
  }

  /// تسجيل الخروج — يلغي تسجيل الإشعارات ثم يمسح الجلسة.
  Future<void> logout() async {
    _busy = true;
    notifyListeners();
    await _service.logout();
    _busy = false;
    notifyListeners();
  }
}
