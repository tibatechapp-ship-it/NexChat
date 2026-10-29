import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../push/notification_preferences.dart';
import '../theme/theme_controller.dart';

/// شاشة الإعدادات.
///
/// - المظهر: اختيار فاتح/داكن/حسب النظام — يُطبَّق فوراً ويُحفظ في
///   SharedPreferences (rasan_theme_mode).
/// - الإشعارات: تشغيل/إيقاف لكل نوع (رسائل جديدة / دعوات مجموعات) —
///   حفظ محلي فوري + مزامنة مع الخادم (PUT /api/push/preferences).
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeController>();
    final notifPrefs = context.watch<NotificationPreferences>();

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
          const _SectionHeader('الإشعارات'),
          SwitchListTile(
            secondary: const Icon(Icons.chat_bubble_outline),
            title: const Text('إشعارات الرسائل الجديدة'),
            subtitle: const Text(
              'تنبيه فقط — بدون محتوى الرسالة (ضمانة E2EE)',
            ),
            value: notifPrefs.messagesEnabled,
            onChanged: notifPrefs.loaded
                ? (v) => context.read<NotificationPreferences>().setMessages(v)
                : null,
          ),
          SwitchListTile(
            secondary: const Icon(Icons.group_add_outlined),
            title: const Text('إشعارات الدعوات إلى المجموعات'),
            subtitle: const Text('عند إضافتك إلى مجموعة جديدة'),
            value: notifPrefs.invitesEnabled,
            onChanged: notifPrefs.loaded
                ? (v) => context.read<NotificationPreferences>().setInvites(v)
                : null,
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
