import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/auth/auth_service.dart';
import 'home_screen.dart';
import 'login_screen.dart';

/// بوابة المصادقة — تقرر الشاشة الأولى حسب حالة الجلسة:
///
/// - أثناء استعادة الجلسة: مؤشر تحميل (يمنع وميض شاشة الدخول).
/// - جلسة قائمة: [HomeScreen] — وربط توكن الإشعارات تم بالفعل
///   في `AuthService.restoreSession`.
/// - لا جلسة: [LoginScreen].
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();

    if (auth.restoring) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    return auth.isAuthenticated ? const HomeScreen() : const LoginScreen();
  }
}
