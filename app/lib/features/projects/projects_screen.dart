import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/utils/money.dart';
import '../../shared/models.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';

final projectsProvider = FutureProvider.autoDispose<List<Project>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final paged = await api.getPaged('/projects', query: {'pageSize': 100});
  return paged.items.map((item) => Project.fromJson(item as Map<String, dynamic>)).toList();
});

class ProjectsScreen extends ConsumerWidget {
  const ProjectsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projects = ref.watch(projectsProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Projects')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(projectsProvider),
        child: projects.when(
          loading: () => const LoadingState(label: 'Loading projects'),
          error: (error, _) => ListView(children: [
            const SizedBox(height: 120),
            ErrorStateView(error: error, onRetry: () => ref.invalidate(projectsProvider)),
          ]),
          data: (items) {
            if (items.isEmpty) {
              return ListView(children: const [
                SizedBox(height: 100),
                EmptyState(
                  title: 'No projects registered',
                  description: 'Register your apps and client sites in the web app first.',
                  icon: Icons.folder_outlined,
                ),
              ]);
            }

            return ListView.separated(
              padding: const EdgeInsets.only(bottom: 24),
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1, indent: 16, endIndent: 16),
              itemBuilder: (context, index) {
                final project = items[index];
                return ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  title: Text(project.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text(
                    '${project.code} · ${humanize(project.type)}',
                    style: theme.textTheme.bodySmall,
                  ),
                  trailing: Chip(
                    label: Text(humanize(project.status)),
                    visualDensity: VisualDensity.compact,
                    labelStyle: theme.textTheme.labelSmall,
                  ),
                  onTap: () => context.push('/projects/${project.id}'),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
