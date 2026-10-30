import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'push_api.dart';
import 'push_service.dart';

/// تفضيلات الإشعارات لكل نوع — تشغيل/إيقاف (الرسائل الجديدة، دعوات المجموعات).
///
/// التخزين:
/// 1. **محلياً** في SharedPreferences (مفاتيح `rasan_notif_messages` /
///    `rasan_notif_invites`) — يُطبَّق فوراً حتى دون جلسة/شبكة.
/// 2. **مزامنة مع الخادم** عبر `PUT /api/push/preferences` عند توفر جلسة
///    (الخادم هو مصدر الحقيقة — يمنع إرسال FCM أصلاً للأجهزة المطفأة).
/// عند توفر جلسة يُسحب وضع الخادم بعد الإقلاع ويُطبَّق إن اختلف.
class NotificationPreferences extends ChangeNotifier {
  NotificationPreferences({PushApi? api})
      : _api = api ?? PushService.instance.api;

  final PushApi _api;

  static const _keyMessages = 'rasan_notif_messages';
  static const _keyInvites = 'rasan_notif_invites';
  static const _keyEmergencies = 'rasan_notif_emergencies';

  bool _messagesEnabled = true;
  bool _invitesEnabled = true;
  bool _emergenciesEnabled = true;
  bool _loaded = false;

  bool get messagesEnabled => _messagesEnabled;
  bool get invitesEnabled => _invitesEnabled;
  bool get emergenciesEnabled => _emergenciesEnabled;
  bool get loaded => _loaded;

  /// قراءة التفضيلات المحلية ثم مزامنتها مع الخادم إن وُجدت جلسة.
  Future<void> load() async {
    final sp = await SharedPreferences.getInstance();
    _messagesEnabled = sp.getBool(_keyMessages) ?? true;
    _invitesEnabled = sp.getBool(_keyInvites) ?? true;
    _emergenciesEnabled = sp.getBool(_keyEmergencies) ?? true;
    _loaded = true;
    notifyListeners();

    // الخادم مصدر الحقيقة عند توفر جلسة — يُطبَّق إن اختلف المحلي.
    final remote = await _api.fetchPreferences();
    if (remote != null) {
      final m = remote['messages'] ?? _messagesEnabled;
      final i = remote['invites'] ?? _invitesEnabled;
      final e = remote['emergencies'] ?? _emergenciesEnabled;
      if (m != _messagesEnabled || i != _invitesEnabled || e != _emergenciesEnabled) {
        _messagesEnabled = m;
        _invitesEnabled = i;
        _emergenciesEnabled = e;
        notifyListeners();
        await _cacheLocal();
      }
    }
  }

  /// تشغيل/إيقاف إشعارات الرسائل الجديدة.
  Future<void> setMessages(bool enabled) async {
    if (enabled == _messagesEnabled) return;
    _messagesEnabled = enabled;
    notifyListeners();
    await _persist();
  }

  /// تشغيل/إيقاف إشعارات الدعوات إلى المجموعات.
  Future<void> setInvites(bool enabled) async {
    if (enabled == _invitesEnabled) return;
    _invitesEnabled = enabled;
    notifyListeners();
    await _persist();
  }

  /// تشغيل/إيقاف إشعارات إنذارات الطوارئ.
  Future<void> setEmergencies(bool enabled) async {
    if (enabled == _emergenciesEnabled) return;
    _emergenciesEnabled = enabled;
    notifyListeners();
    await _persist();
  }

  /// حفظ محلي + مزامنة مع الخادم (فشل الشبكة لا يمنع الحفظ المحلي).
  Future<void> _persist() async {
    await _cacheLocal();
    await _api.savePreferences(
      messages: _messagesEnabled,
      invites: _invitesEnabled,
      emergencies: _emergenciesEnabled,
    );
  }

  Future<void> _cacheLocal() async {
    final sp = await SharedPreferences.getInstance();
    await sp.setBool(_keyMessages, _messagesEnabled);
    await sp.setBool(_keyInvites, _invitesEnabled);
    await sp.setBool(_keyEmergencies, _emergenciesEnabled);
  }
}
