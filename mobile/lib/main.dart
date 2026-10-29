import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/home_screen.dart';
import 'theme/app_theme.dart';
import 'theme/theme_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // قراءة وضع المظهر المحفوظ قبل الإقلاع حتى لا يومض التطبيق
  // بثيم خاطئ ثم يتبدل (theme flash).
  final themeController = ThemeController();
  await themeController.load();

  runApp(RasanApp(themeController: themeController));
}

class RasanApp extends StatelessWidget {
  const RasanApp({super.key, required this.themeController});

  final ThemeController themeController;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<ThemeController>.value(value: themeController),
      ],
      child: Consumer<ThemeController>(
        builder: (context, theme, _) => MaterialApp(
          title: 'رسن',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light,
          darkTheme: AppTheme.dark,
          // الوضع الليلي: light/dark/system — محفوظ في SharedPreferences
          // (مفتاح rasan_theme_mode) عبر ThemeController.
          themeMode: theme.mode,
          home: const HomeScreen(),
        ),
      ),
    );
  }
}
