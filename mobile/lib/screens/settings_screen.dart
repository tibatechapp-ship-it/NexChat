import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme/theme_controller.dart';

/// شاشة الإعدادات.
///
/// قسم المظهر: اختيار فاتح/داكن/حسب النظام — التغيير يُطبَّق فوراً
/// ويُحفظ في SharedPreferences (rasan_theme_mode).
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeController>();

    return Scaffold(
      appBar: AppBar(title: const Text('الإعدادات')),
      body: ListView(
        children: [
          const _SectionHeader('المظهر'),
          RadioGroup<ThemeMode>(
            groupValue: theme.mode,
            onChanged: (mode) {
              if (mode != null) {
                context.read<ThemeController>().setMode(mode);
              }
            },
            child: const Column(
              children: [
                RadioListTile<ThemeMode>(
                  value: ThemeMode.light,
                  secondary: Icon(Icons.light_mode_outlined),
                  title: Text('فاتح'),
                ),
                RadioListTile<ThemeMode>(
                  value: ThemeMode.dark,
                  secondary: Icon(Icons.dark_mode_outlined),
                  title: Text('داكن (وضع ليلي)'),
                ),
                RadioListTile<ThemeMode>(
                  value: ThemeMode.system,
                  secondary: Icon(Icons.settings_brightness_outlined),
                  title: Text('حسب النظام'),
                ),
              ],
            ),
          ),
          const Divider(height: 32),
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text(
              'رسن — دردشة مشفّرة نهاية-ل-نهاية. الإشعارات لا تحتوي أبداً على '
              'محتوى الرسائل (E2EE) — تنبيهات فقط.',
              style: TextStyle(fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}
