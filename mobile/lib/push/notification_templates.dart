/// قوالب نصوص الإشعارات — المرآة المحلية لقوالب الخادم
/// (Rasan/server/notifications.js → TEMPLATES).
///
/// ضمانة E2EE: نصوص ثابتة فقط. لا يعرض تطبيق الجوال أي محتوى من داخل
/// الرسالة المشفرة — لا في الإشعار المعروض يدوياً (foreground) ولا في
/// payload المحلي.
class NotificationTemplates {
  NotificationTemplates._();

  /// عنوان الإشعار الموحد (يطابق قالب الخادم).
  static const String appTitle = 'رسن';

  /// إشعار رسالة جديدة — بدون محتوى الرسالة.
  static const String newMessage = 'لديك رسالة جديدة';

  /// إشعار دعوة إلى مجموعة.
  static const String groupInvite = 'لديك دعوة إلى مجموعة';

  /// اختيار النص حسب نوع الإشعار القادم في data.kind —
  /// أي نوع غير معروف يعامل كرسالة جديدة (النص الأكثر حيادية).
  static String bodyForKind(String? kind) =>
      kind == 'group_invite' ? groupInvite : newMessage;
}
