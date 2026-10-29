import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/auth_controller.dart';
import '../../features/auth/login_screen.dart';
import '../../features/dashboard/dashboard_screen.dart';
import '../../features/expenses/expenses_screen.dart';
import '../../features/partners/profit_share_screen.dart';
import '../../features/projects/project_detail_screen.dart';
import '../../features/projects/projects_screen.dart';
import '../../features/reports/reports_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/transactions/transactions_screen.dart';
import '../../shared/widgets/app_scaffold.dart';

/// Routing.
///
/// A single redirect guards every authenticated route, so no screen has to
/// check the session itself. While the session is still being restored the
/// redirect holds the user on the splash route rather than flashing the login
/// screen at someone who is already signed in.
final routerProvider = Provider<GoRouter>((ref) {
  final notifier = ValueNotifier<AuthStatus>(AuthStatus.unknown);

  ref.listen<AuthState>(authControllerProvider, (previous, next) {
    notifier.value = next.status;
  });
  ref.onDispose(notifier.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: notifier,
    redirect: (context, state) {
      final status = ref.read(authControllerProvider).status;
      final path = state.matchedLocation;

      if (status == AuthStatus.unknown) return path == '/' ? null : '/';
      if (status == AuthStatus.unauthenticated) return path == '/login' ? null : '/login';

      // Authenticated: keep them out of the splash and login routes.
      if (path == '/' || path == '/login') return '/dashboard';
      return null;
    },
    routes: [
      GoRoute(path: '/', builder: (context, state) => const _SplashScreen()),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),

      // Tabbed shell: the four things a partner checks on a phone.
      ShellRoute(
        builder: (context, state, child) =>
            AppScaffold(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(path: '/dashboard', builder: (context, state) => const DashboardScreen()),
          GoRoute(path: '/transactions', builder: (context, state) => const TransactionsScreen()),
          GoRoute(path: '/expenses', builder: (context, state) => const ExpensesScreen()),
          GoRoute(path: '/profit-share', builder: (context, state) => const ProfitShareScreen()),
        ],
      ),

      GoRoute(path: '/projects', builder: (context, state) => const ProjectsScreen()),
      GoRoute(
        path: '/projects/:id',
        builder: (context, state) =>
            ProjectDetailScreen(projectId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/reports', builder: (context, state) => const ReportsScreen()),
      GoRoute(path: '/settings', builder: (context, state) => const SettingsScreen()),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('That screen does not exist.'),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () => context.go('/dashboard'),
                child: const Text('Go to overview'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
});

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator()),
    );
  }
}
