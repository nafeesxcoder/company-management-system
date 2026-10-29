import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/utils/money.dart';
import '../../shared/models.dart';
import '../../shared/widgets/figure.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';

final expensesProvider = FutureProvider.autoDispose<List<Expense>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final paged = await api.getPaged('/expenses', query: {'pageSize': 50});
  return paged.items.map((item) => Expense.fromJson(item as Map<String, dynamic>)).toList();
});

class ExpensesScreen extends ConsumerWidget {
  const ExpensesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final expenses = ref.watch(expensesProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Expenses')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(expensesProvider),
        child: expenses.when(
          loading: () => const LoadingState(label: 'Loading expenses'),
          error: (error, _) => ListView(children: [
            const SizedBox(height: 120),
            ErrorStateView(error: error, onRetry: () => ref.invalidate(expensesProvider)),
          ]),
          data: (items) {
            if (items.isEmpty) {
              return ListView(children: const [
                SizedBox(height: 100),
                EmptyState(
                  title: 'No expenses recorded',
                  description:
                      'Without costs the figures show revenue, not profit. Add expenses from the web app.',
                  icon: Icons.receipt_long_outlined,
                ),
              ]);
            }

            return ListView.separated(
              padding: const EdgeInsets.only(bottom: 24),
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1, indent: 16, endIndent: 16),
              itemBuilder: (context, index) {
                final expense = items[index];
                return ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  title: Text(expense.vendor, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 2),
                      Text(
                        '${expense.categoryName} · ${expense.projectName ?? 'Company-wide'}',
                        style: theme.textTheme.bodySmall,
                      ),
                      Text(Dates.short(expense.expenseDate), style: theme.textTheme.bodySmall),
                      if (expense.excludeFromProfit)
                        Text(
                          'Not counted toward profit',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                  trailing: Figure(
                    expense.totalAmount,
                    currency: expense.currency,
                    size: 15,
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
