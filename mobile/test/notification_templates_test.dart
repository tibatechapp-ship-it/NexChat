import 'package:flutter_test/flutter_test.dart';
import 'package:rasan_mobile/push/notification_templates.dart';

/// ضمانة E2EE على مستوى العميل: النصوص المعروضة في الإشعارات
/// قادمة من قوالب ثابتة حصراً — لا يعكس الإشعار أي محتوى رسالة.
void main() {
  group('NotificationTemplates — قوالب نصوص آمنة (E2EE)', () {
    test('عنوان موحد لكل الإشعارات', () {
      expect(NotificationTemplates.appTitle, 'رسن');
    });

    test('نص الرسالة الجديدة لا يحتوي أي محتوى ديناميكي', () {
      expect(NotificationTemplates.newMessage, 'لديك رسالة جديدة');
      expect(NotificationTemplates.newMessage.contains('\$'), isFalse);
    });

    test('نص الدعوة إلى مجموعة قالب ثابت', () {
      expect(NotificationTemplates.groupInvite, 'لديك دعوة إلى مجموعة');
    });

    test('bodyForKind: kind معروف ⇒ القالب المطابق', () {
      expect(
        NotificationTemplates.bodyForKind('group_invite'),
        NotificationTemplates.groupInvite,
      );
      expect(
        NotificationTemplates.bodyForKind('new_message'),
        NotificationTemplates.newMessage,
      );
    });

    test('bodyForKind: kind غير معروف/مفقود ⇒ النص الأكثر حيادية', () {
      // أي نوع غير معروف يعامل كرسالة جديدة — لا استثناءات ولا تسريب
      expect(
        NotificationTemplates.bodyForKind('unknown_kind'),
        NotificationTemplates.newMessage,
      );
      expect(
        NotificationTemplates.bodyForKind(null),
        NotificationTemplates.newMessage,
      );
      expect(
        NotificationTemplates.bodyForKind(''),
        NotificationTemplates.newMessage,
      );
      // محاولة حقول تشبه HTML/نصاً من الخادم لا تظهر أبداً في النص
      final body = NotificationTemplates.bodyForKind('<script>alert(1)</script>');
      expect(body, isNot(contains('<script>')));
    });
  });
}
