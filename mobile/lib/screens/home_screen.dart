import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/auth/auth_service.dart';
import '../theme/theme_controller.dart';
import 'settings_screen.dart';

/// الشاشة الرئيسية — هيكل أساسي مؤقت.
///
/// قائمة المحادثات وتدفّق الدردشة الكامل قادمان في إصدار لاحق
/// (راجع README: "Planned: chat list, conversation view"). هذه الشاشة
/// تتيح اليوم الوصول للإعدادات وتعرض حالة المظهر الحالية.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeController>();
    final auth = context.watch<AuthController>();
    final colors = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('رسن'),
        actions: [
          IconButton(
            tooltip: 'الإعدادات',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const SettingsScreen()),
            ),
          ),
          IconButton(
            tooltip: 'تسجيل الخروج',
            icon: const Icon(Icons.logout_outlined),
            onPressed: auth.busy ? null : () => _confirmLogout(context),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.lock_outline, size: 64, color: colors.primary),
              const SizedBox(height: 16),
              Text(
                'دردشة مشفّرة نهاية-ل-نهاية',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              if (auth.username != null) ...[
                Text(
                  'مرحباً ${auth.username}',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: colors.primary,
                        fontWeight: FontWeight.w600,
                      ),
                ),
                const SizedBox(height: 8),
              ],
              Text(
                'وضع المظهر الحالي: ${_modeLabel(theme.mode)}',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                icon: const Icon(Icons.settings_outlined),
                label: const Text('الإعدادات'),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const SettingsScreen()),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// تأكيد الخروج — يلغي تسجيل توكن الإشعارات لدى الخادم
  /// (POST /api/push/unregister) ثم يمسح الجلسة (AuthService.logout).
  Future<void> _confirmLogout(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('تسجيل الخروج'),
        content: const Text(
          'سيتم إيقاف إشعارات هذا الجهاز ومسح جلسة الدخول. متابعة؟',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('خروج'),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await context.read<AuthController>().logout();
    }
  }

  static String _modeLabel(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'فاتح';
      case ThemeMode.dark:
        return 'داكن';
      case ThemeMode.system:
        return 'حسب النظام';
    }
  }
}
