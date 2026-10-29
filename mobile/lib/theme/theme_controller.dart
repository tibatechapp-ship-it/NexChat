import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// وضع مظهر تطبيق رسن — light/dark/system، محفوظ في SharedPreferences.
///
/// - المفتاح: `rasan_theme_mode`
/// - القيم: 'light' | 'dark' | 'system' (الافتراضي: system — يتبع النظام)
/// - الاستماع للتغييرات عبر provider (ChangeNotifier).
class ThemeController extends ChangeNotifier {
  static const _prefKey = 'rasan_theme_mode';

  ThemeMode _mode = ThemeMode.system;
  ThemeMode get mode => _mode;

  String get code => codeOf(_mode);

  /// قراءة الاختيار المحفوظ — تُستدعى مرة عند الإقلاع قبل runApp.
  Future<void> load() async {
    final sp = await SharedPreferences.getInstance();
    _mode = parseMode(sp.getString(_prefKey));
    notifyListeners();
  }

  /// تغيير الوضع وحفظه فوراً في SharedPreferences.
  Future<void> setMode(ThemeMode mode) async {
    if (mode == _mode) return;
    _mode = mode;
    notifyListeners();
    final sp = await SharedPreferences.getInstance();
    await sp.setString(_prefKey, codeOf(mode));
  }

  /// تحويل نص محفوظ إلى ThemeMode — أي قيمة غير معروفة ⇒ system.
  static ThemeMode parseMode(String? code) {
    switch (code) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }

  /// تحويل ThemeMode إلى النص المحفوظ في SharedPreferences.
  static String codeOf(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'light';
      case ThemeMode.dark:
        return 'dark';
      case ThemeMode.system:
        return 'system';
    }
  }
}
