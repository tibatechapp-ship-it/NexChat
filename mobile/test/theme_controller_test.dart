import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rasan_mobile/theme/theme_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ThemeController — الوضع الليلي (light/dark/system)', () {
    test('parseMode: القيم المعروفة وغير المعروفة', () {
      expect(ThemeController.parseMode('light'), ThemeMode.light);
      expect(ThemeController.parseMode('dark'), ThemeMode.dark);
      expect(ThemeController.parseMode('system'), ThemeMode.system);
      // أي قيمة غير معروفة أو مفقودة ⇒ system (الافتراضي الآمن)
      expect(ThemeController.parseMode(null), ThemeMode.system);
      expect(ThemeController.parseMode('nonsense'), ThemeMode.system);
      expect(ThemeController.parseMode(''), ThemeMode.system);
    });

    test('codeOf: عكس parseMode تماماً', () {
      for (final mode in ThemeMode.values) {
        expect(ThemeController.parseMode(ThemeController.codeOf(mode)), mode);
      }
      expect(ThemeController.codeOf(ThemeMode.system), 'system');
    });

    test('load: يقرأ الوضع المحفوظ من SharedPreferences', () async {
      SharedPreferences.setMockInitialValues({'rasan_theme_mode': 'dark'});
      final controller = ThemeController();
      await controller.load();
      expect(controller.mode, ThemeMode.dark);
      expect(controller.code, 'dark');
    });

    test('load: بلا قيمة محفوظة ⇒ system', () async {
      SharedPreferences.setMockInitialValues({});
      final controller = ThemeController();
      await controller.load();
      expect(controller.mode, ThemeMode.system);
    });

    test('setMode: يغيّر الوضع ويحفظه فوراً ويُبلّغ المستمعين', () async {
      SharedPreferences.setMockInitialValues({});
      final controller = ThemeController();
      await controller.load();

      var notified = 0;
      controller.addListener(() => notified++);

      await controller.setMode(ThemeMode.dark);
      expect(controller.mode, ThemeMode.dark);
      expect(notified, 1);

      // الحفظ الفوري — يُقرأ من نسخة جديدة
      final sp = await SharedPreferences.getInstance();
      expect(sp.getString('rasan_theme_mode'), 'dark');

      // لا إشعار إضافي عند تعيين نفس القيمة
      await controller.setMode(ThemeMode.dark);
      expect(notified, 1);

      // العودة إلى system
      await controller.setMode(ThemeMode.system);
      expect(controller.mode, ThemeMode.system);
      expect((await SharedPreferences.getInstance())
              .getString('rasan_theme_mode') ??
          'system',
          'system');
    });
  });
}
