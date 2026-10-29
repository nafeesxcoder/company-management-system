import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Bottom navigation shell.
///
/// Four destinations, matching what a partner actually opens a phone to check.
/// Everything else (projects, settings) is reachable from within a screen
/// rather than competing for a tab.
class AppScaffold extends StatelessWidget {
  const AppScaffold({super.key, required this.child, required this.location});

  final Widget child;
  final String location;

  static const _destinations = [
    (path: '/dashboard', icon: Icons.insights_outlined, selected: Icons.insights, label: 'Overview'),
    (path: '/transactions', icon: Icons.swap_horiz_outlined, selected: Icons.swap_horiz, label: 'Income'),
    (path: '/expenses', icon: Icons.receipt_long_outlined, selected: Icons.receipt_long, label: 'Expenses'),
    (path: '/profit-share', icon: Icons.balance_outlined, selected: Icons.balance, label: 'Split'),
  ];

  int get _currentIndex {
    final index = _destinations.indexWhere((d) => location.startsWith(d.path));
    return index < 0 ? 0 : index;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (index) => context.go(_destinations[index].path),
        destinations: [
          for (final destination in _destinations)
            NavigationDestination(
              icon: Icon(destination.icon),
              selectedIcon: Icon(destination.selected),
              label: destination.label,
            ),
        ],
      ),
    );
  }
}
