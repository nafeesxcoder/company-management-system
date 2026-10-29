import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config/env.dart';
import 'core/routing/app_router.dart';
import 'core/theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: CompanyManagementApp()));
}

class CompanyManagementApp extends ConsumerWidget {
  const CompanyManagementApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: Env.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      // Follows the device setting rather than forcing a theme.
      themeMode: ThemeMode.system,
      routerConfig: router,
      builder: (context, child) {
        // A release build pointing at plain HTTP would send bearer tokens in
        // the clear. Say so loudly rather than letting it ship quietly.
        if (Env.isInsecureProductionConfig) {
          return _ConfigurationError(
            message:
                'This release build is configured to use ${Env.apiBaseUrl}, which is not HTTPS. '
                'Rebuild with --dart-define=API_BASE_URL=https://…',
          );
        }
        return child ?? const SizedBox.shrink();
      },
    );
  }
}

class _ConfigurationError extends StatelessWidget {
  const _ConfigurationError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Container(
        color: const Color(0xFF7F1D1D),
        alignment: Alignment.center,
        padding: const EdgeInsets.all(32),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: Colors.white, fontSize: 16),
        ),
      ),
    );
  }
}
