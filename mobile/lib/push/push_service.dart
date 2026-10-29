import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'notification_templates.dart';
import 'push_api.dart';

/// معالج رسائل FCM في الخلفية — يجب أن يكون دالة على المستوى الأعلى.
///
/// في الخلفية يعرض النظام إشعار الـ notification payload القادم من الخادم
/// مباشرة — وخادم رسن يرسل نصوصاً من قوالب ثابتة فقط ("لديك رسالة جديدة")،
/// لذا لا مسار يمس محتوى الرسالة المشفرة إطلاقاً.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  // لا عرض محلي هنا — النظام يتكفل بالإشعار، والخادم يضمن نصاً آمناً.
}

/// خدمة الإشعارات (FCM) لتطبيق رسن — singleton.
///
/// المسؤوليات:
/// 1. تهيئة Firebase وطلب الصلاحيات (تفشل بهدوء إن لم تُضبط إعدادات
///    المنصة بعد — google-services.json / APNs — فيعمل التطبيق بلا إشعارات).
/// 2. تسجيل توكن FCM لدى الخادم (`POST /api/push/register`) بعد توفر
///    جلسة المستخدم، وإعادة التسجيل عند دوران التوكن.
/// 3. عرض الإشعارات في المقدمة عبر إشعارات محلية — بنصوص من
///    [NotificationTemplates] حصراً (لا نثق بأي نص قادم من FCM).
///
/// ضمانة E2EE: لا يظهر في أي إشعار محتوى الرسالة — نصوص القوالب فقط.
class PushService {
  PushService._();

  static final PushService instance = PushService._();

  final PushApi api = PushApi();
  final FlutterLocalNotificationsPlugin _local =
      FlutterLocalNotificationsPlugin();

  final StreamController<RemoteMessage> _foregroundMessages =
      StreamController<RemoteMessage>.broadcast();

  String? _fcmToken;
  bool _initialized = false;

  /// رسائل FCM أثناء عمل التطبيق في المقدمة (للربط مع الواجهة عند الحاجة).
  Stream<RemoteMessage> get onForegroundMessage => _foregroundMessages.stream;

  /// توكن FCM الحالي إن وُجد.
  String? get token => _fcmToken;

  /// هل اكتملت التهيئة بنجاح؟
  bool get isInitialized => _initialized;

  /// قناة الأندرويد — تطابق `channelId: "messages"` في server/push.js.
  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'messages',
    'الرسائل',
    description: 'إشعارات الرسائل الجديدة والدعوات إلى المجموعات',
    importance: Importance.high,
  );

  /// تهيئة الخدمة — آمنة للاستدعاء أكثر من مرة، ولا تُلقي استثناءات.
  Future<void> initialize() async {
    if (_initialized) return;
    try {
      await Firebase.initializeApp();
    } catch (e) {
      debugPrint('[push] Firebase غير مهيأ — تُتخطى الإشعارات: $e');
      return;
    }

    try {
      await _local.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
      );

      final androidPlugin = _local.resolvePlatformSpecificAndroidImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      await androidPlugin?.createNotificationChannel(_channel);

      await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      // المقدمة: النظام لا يعرض إشعار FCM تلقائياً — نعرضه محلياً بنص قالب آمن.
      FirebaseMessaging.onMessage.listen((message) {
        _foregroundMessages.add(message);
        _showLocalFrom(message);
      });

      // دوران التوكن: إعادة تسجيل فوري لدى الخادم إن وُجدت جلسة.
      FirebaseMessaging.onTokenRefresh.listen((t) {
        _fcmToken = t;
        api.registerToken(t, platformName);
      });

      _fcmToken = await FirebaseMessaging.instance.getToken();
      if (_fcmToken != null) {
        await api.registerToken(_fcmToken!, platformName);
      }
      _initialized = true;
      debugPrint('[push] ready');
    } catch (e) {
      debugPrint('[push] init failed: $e');
    }
  }

  /// ضبط جلسة المستخدم — يُستدعى من تدفق تسجيل الدخول.
  /// يسجل توكن FCM لدى الخادم فور توفر الجلسة.
  Future<void> setAuthToken(String? jwt) async {
    api.setAuthToken(jwt);
    if (jwt == null) return;
    // إن لم تكتمل تهيئة FCM بعد فسيكفل مسار initialize بالتسجيل لاحقاً.
    if (_fcmToken != null) {
      await api.registerToken(_fcmToken!, platformName);
    }
  }

  /// مزامنة تفضيلات الإشعارات مع الخادم (يستدعيها مزود التفضيلات).
  Future<bool> savePreferences({
    required bool messages,
    required bool invites,
  }) =>
      api.savePreferences(messages: messages, invites: invites);

  /// عرض إشعار محلي من رسالة FCM — النص من القوالب الثابتة فقط
  /// (نتجاهل أي notification.title/body قادم من FCM في المقدمة
  /// دفاعاً في العمق، وإن كان الخادم يرسل قوالب آمنة أصلاً).
  Future<void> _showLocalFrom(RemoteMessage message) async {
    try {
      final data = message.data;
      final body = NotificationTemplates.bodyForKind(data['kind'] as String?);
      await _local.show(
        DateTime.now().millisecondsSinceEpoch.remainder(100000),
        NotificationTemplates.appTitle,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            _channel.id,
            _channel.name,
            channelDescription: _channel.description,
            importance: Importance.high,
            priority: Priority.high,
            icon: '@mipmap/ic_launcher',
          ),
          iOS: const DarwinNotificationDetails(),
        ),
        payload: data['conversationId']?.toString(),
      );
    } catch (e) {
      debugPrint('[push] local display failed: $e');
    }
  }

  static String get platformName {
    if (Platform.isIOS) return 'ios';
    if (Platform.isAndroid) return 'android';
    return 'web';
  }
}
