import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/env.dart';
import '../auth/auth_controller.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final theme = Theme.of(context);
    final user = auth.user;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          if (user != null)
            ListTile(
              leading: CircleAvatar(
                backgroundColor: theme.colorScheme.primaryContainer,
                child: Text(
                  _initials(user.fullName),
                  style: TextStyle(color: theme.colorScheme.onPrimaryContainer),
                ),
              ),
              title: Text(user.fullName),
              subtitle: Text(user.email),
            ),
          const Divider(),

          if (auth.memberships.length > 1) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text('Company', style: theme.textTheme.labelLarge),
            ),
            for (final membership in auth.memberships)
              RadioListTile<String>(
                value: membership.companyId,
                groupValue: auth.activeCompanyId,
                title: Text(membership.companyName),
                subtitle: Text('${membership.role.toLowerCase()} · ${membership.baseCurrency}'),
                onChanged: (value) {
                  if (value != null) {
                    ref.read(authControllerProvider.notifier).switchCompany(value);
                  }
                },
              ),
            const Divider(),
          ] else if (auth.activeCompany != null)
            ListTile(
              leading: const Icon(Icons.business_outlined),
              title: Text(auth.activeCompany!.companyName),
              subtitle: Text(
                '${auth.activeCompany!.role.toLowerCase()} · ${auth.activeCompany!.baseCurrency}',
              ),
            ),

          ListTile(
            leading: const Icon(Icons.language_outlined),
            title: const Text('API'),
            subtitle: Text(Env.apiBaseUrl),
          ),

          const Divider(),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Projects, income, expenses and the profit split are managed in the web app. '
              'This app is for checking the figures and recording refunds on the move.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),

          Padding(
            padding: const EdgeInsets.all(16),
            child: OutlinedButton.icon(
              onPressed: () => ref.read(authControllerProvider.notifier).logout(),
              icon: const Icon(Icons.logout),
              label: const Text('Sign out'),
              style: OutlinedButton.styleFrom(foregroundColor: theme.colorScheme.error),
            ),
          ),
        ],
      ),
    );
  }

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return parts.take(2).map((p) => p[0].toUpperCase()).join();
  }
}
