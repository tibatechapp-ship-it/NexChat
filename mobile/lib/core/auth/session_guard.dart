import 'dart:async';

import 'package:flutter/foundation.dart';

/// حارس الجلسة المركزي — المعالج الوحيد لاستجابات 401 في التطبيق.
///
/// السياسة الأمنية: أي استجابة 401 من أي عميل REST تعني أن الجلسة
/// لم تعد صالحة (انتهت أو أُبطلت) — فيجب التنفيذ **بهذا الترتيب
/// الإلزامي**:
///
/// 1. إلغاء تسجيل توكن الإشعارات لدى الخادم (`POST /api/push/unregister`)
///    — يتطلب Bearer JWT لذا يحدث *قبل* مسحه.
/// 2. حذف JWT من التخزين الآمن.
/// 3. توجيه المستخدم إلى شاشة الدخول — يحدث تلقائياً لأن [AuthGate]
///    يراقب `AuthController` ويُعيد البناء إلى `LoginScreen` بمجرد
///    أن تصبح `isAuthenticated = false`.
///
/// الاستدعاءات المتزامنة (مثلاً 401 من طلبين متوازيين) تُدمج في
/// تنفيذ واحد — والمعالج نفسه قد يولّد 401 (إلغاء التسجيل بجلسة
/// منتهية) فمنع إعادة الدخول يمنع الحلقات اللانهائية.
///
/// الاستخدام: يُربط المعالج مرة واحدة عند الإقلاع (`main.dart`)،
/// ويستدعي عملاء REST (PushApi) [onUnauthorized] عند 401.
class SessionGuard {
  SessionGuard._();

  static final SessionGuard instance = SessionGuard._();

  Future<void> Function()? _action;
  bool _inFlight = false;

  /// ربط معالج الخروج القسري — يُستدعى مرة عند الإقلاع.
  /// المتوقع: `AuthController.logout` (إلغاء الإشعارات ثم مسح الجلسة
  /// ثم إعلام المستمعين فيوجّهم AuthGate إلى شاشة الدخول).
  void attach(Future<void> Function() action) => _action = action;

  /// فصل المعالج — للاختبارات فقط.
  void detach() => _action = null;

  /// معالجة استجابة 401: خروج قسري بالترتيب الإلزامي.
  ///
  /// - بلا معالج مرفق (اختبارات/قبل الإقلاع): لا شيء.
  /// - أثناء تنفيذ جارٍ: يعود فوراً (التنفيذ الجارٍ يكفي) — هذا
  ///   يمنع حالة توقف تام: لو انتظرت الاستدعاءات الداخلية اكتمال
  ///   التنفيذ الأصلي الذي بدوره ينتظرها، لما اكتمل أيٌّ منهما.
  /// - فشل المعالج لا يُرمى للمستدعي — مسح الجلسة المحلي يجري
  ///   داخل المعالج في كل الأحوال، والمستدعي (عميل REST) يكمل
  ///   بمعالجة فشل الطلب الأصلي أصلاً.
  Future<void> onUnauthorized() async {
    if (_inFlight || _action == null) return;
    _inFlight = true;
    try {
      await _action!();
    } catch (e) {
      debugPrint('[session-guard] forced logout failed: $e');
    } finally {
      _inFlight = false;
    }
  }
}
