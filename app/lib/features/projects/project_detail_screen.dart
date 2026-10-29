import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/utils/money.dart';
import '../../shared/models.dart';
import '../../shared/widgets/figure.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';

typedef ProjectDetail = ({Project project, ProjectFinancials financials});

final projectDetailProvider =
    FutureProvider.autoDispose.family<ProjectDetail, String>((ref, projectId) async {
  final api = ref.watch(apiClientProvider);
  final json = await api.get('/projects/$projectId', query: {'preset': 'thisYear'});
  return (
    project: Project.fromJson(json['project'] as Map<String, dynamic>),
    financials: ProjectFinancials.fromJson(json['financials'] as Map<String, dynamic>),
  );
});

class ProjectDetailScreen extends ConsumerWidget {
  const ProjectDetailScreen({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(projectDetailProvider(projectId));
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Project')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(projectDetailProvider(projectId)),
        child: detail.when(
          loading: () => const LoadingState(label: 'Loading project'),
          error: (error, _) => ListView(children: [
            const SizedBox(height: 120),
            ErrorStateView(
              error: error,
              onRetry: () => ref.invalidate(projectDetailProvider(projectId)),
            ),
          ]),
          data: (data) {
            final project = data.project;
            final financials = data.financials;

            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                Text(project.name, style: theme.textTheme.headlineSmall),
                const SizedBox(height: 4),
                Text(
                  '${project.code} · ${humanize(project.type)} · ${humanize(project.revenueModel)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                if (project.description != null) ...[
                  const SizedBox(height: 12),
                  Text(project.description!, style: theme.textTheme.bodyMedium),
                ],
                const SizedBox(height: 20),

                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Figure(
                          financials.netProfit,
                          currency: financials.currency,
                          size: 30,
                          signed: true,
                        ),
                        Text(
                          'net profit this year',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 12),
                        const Divider(),
                        LedgerRow(
                          label: 'Gross revenue',
                          amount: financials.grossRevenue,
                          currency: financials.currency,
                        ),
                        LedgerRow(
                          label: 'Refunds',
                          amount: financials.totalRefunds,
                          currency: financials.currency,
                          muted: true,
                        ),
                        LedgerRow(
                          label: 'Processing fees',
                          amount: financials.processingFees,
                          currency: financials.currency,
                          muted: true,
                        ),
                        LedgerRow(
                          label: 'Expenses',
                          amount: financials.eligibleExpenses,
                          currency: financials.currency,
                          muted: true,
                        ),
                        const Divider(),
                        LedgerRow(
                          label: 'Net profit',
                          amount: financials.netProfit,
                          currency: financials.currency,
                          signed: true,
                          emphasis: true,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Column(
                      children: [
                        LedgerRow(
                          label: 'Awaiting payment',
                          amount: financials.pendingPayments,
                          currency: financials.currency,
                          hint: 'not counted as revenue',
                          muted: true,
                        ),
                        const Divider(),
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('Records', style: theme.textTheme.bodyMedium),
                              Text(
                                '${financials.transactionCount} payments · ${financials.expenseCount} expenses',
                                style: theme.textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
