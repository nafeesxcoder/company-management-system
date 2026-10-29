import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/money.dart';
import '../../shared/models.dart';
import '../../shared/widgets/figure.dart';
import '../../shared/widgets/preset_chips.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';

final profitLossProvider =
    FutureProvider.autoDispose.family<ProfitLossReport, String>((ref, preset) async {
  final api = ref.watch(apiClientProvider);
  final json = await api.get('/reports/profit-loss', query: {'preset': preset});
  return ProfitLossReport.fromJson(json);
});

/// Profit and loss.
///
/// The statement the web app shows under Reports, laid out for a phone: the
/// same API response, the same figures, read top to bottom as an equation
/// rather than spread across a table. Nothing here is computed on the device —
/// every number, including the margin, is what `/reports/profit-loss` returned.
class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  String _preset = 'thisMonth';

  @override
  Widget build(BuildContext context) {
    final report = ref.watch(profitLossProvider(_preset));

    return Scaffold(
      appBar: AppBar(title: const Text('Profit & loss')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(profitLossProvider(_preset)),
        child: report.when(
          loading: () => const LoadingState(label: 'Preparing the statement'),
          error: (error, _) => ListView(children: [
            const SizedBox(height: 120),
            ErrorStateView(
              error: error,
              onRetry: () => ref.invalidate(profitLossProvider(_preset)),
            ),
          ]),
          data: (data) => ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              PresetChips(
                selected: _preset,
                onSelected: (value) => setState(() => _preset = value),
              ),
              const SizedBox(height: 16),

              if (data.unconvertedRecords > 0)
                _NoteBanner(
                  icon: Icons.currency_exchange,
                  text: data.dataQualityNote ??
                      '${data.unconvertedRecords} record(s) are in another currency and are '
                          'not included in these totals.',
                ),

              _ResultCard(report: data),
              const SizedBox(height: 16),

              _StatementCard(report: data),
              const SizedBox(height: 16),

              if (data.byCategory.isNotEmpty) ...[
                _CategoryCard(report: data),
                const SizedBox(height: 16),
              ],

              _OutstandingCard(report: data),
              const SizedBox(height: 16),

              _DefinitionsCard(definitions: data.definitions),
              const SizedBox(height: 12),

              Text(
                'CSV exports of transactions and expenses are available in the web app '
                'under Reports.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The headline: net profit for the range, with the margin beside it.
class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.report});

  final ProfitLossReport report;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isLoss = Money.isNegative(report.netProfit);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isLoss ? 'Net loss · ${report.rangeLabel}' : 'Net profit · ${report.rangeLabel}',
              style: theme.textTheme.labelMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 8),
            Figure(report.netProfit, currency: report.currency, size: 34, signed: true),
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(
                  isLoss ? Icons.trending_down : Icons.trending_up,
                  size: 16,
                  color: isLoss ? AppTheme.loss(context) : AppTheme.gain(context),
                ),
                const SizedBox(width: 6),
                Text(
                  '${report.profitMargin}% margin on net revenue',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// The working: revenue down to profit, in the order the backend computes it.
class _StatementCard extends StatelessWidget {
  const _StatementCard({required this.report});

  final ProfitLossReport report;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final currency = report.currency;

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('How it adds up', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),

            LedgerRow(
              label: 'Gross revenue',
              hint: 'Received payments only',
              amount: report.grossRevenue,
              currency: currency,
            ),
            LedgerRow(
              label: 'Less refunds',
              amount: report.refunds,
              currency: currency,
              muted: true,
            ),
            const Divider(height: 16),
            LedgerRow(
              label: 'Net revenue',
              amount: report.netRevenue,
              currency: currency,
              emphasis: true,
            ),
            const SizedBox(height: 4),

            LedgerRow(
              label: 'Less processing fees',
              hint: 'Provider fees, net of fees returned on refunds',
              amount: report.processingFees,
              currency: currency,
              muted: true,
            ),
            LedgerRow(
              label: 'Less expenses',
              hint: report.hasExcludedExpenses
                  ? '${Money.format(report.totalExpensesRecorded, currency: currency)} recorded; '
                      'the rest is excluded from profit'
                  : null,
              amount: report.eligibleExpenses,
              currency: currency,
              muted: true,
            ),
            const Divider(height: 16),
            LedgerRow(
              label: Money.isNegative(report.netProfit) ? 'Net loss' : 'Net profit',
              amount: report.netProfit,
              currency: currency,
              emphasis: true,
              signed: true,
            ),
            const SizedBox(height: 4),
          ],
        ),
      ),
    );
  }
}

class _CategoryCard extends StatelessWidget {
  const _CategoryCard({required this.report});

  final ProfitLossReport report;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Expenses by category', style: theme.textTheme.titleSmall),
            const SizedBox(height: 4),
            for (final category in report.byCategory)
              LedgerRow(
                label: category.name,
                amount: category.total,
                currency: report.currency,
              ),
            const SizedBox(height: 4),
          ],
        ),
      ),
    );
  }
}

/// Money owed in either direction. Kept clearly apart from the statement above,
/// because none of it has been received or paid yet.
class _OutstandingCard extends StatelessWidget {
  const _OutstandingCard({required this.report});

  final ProfitLossReport report;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Not in the figures above', style: theme.textTheme.titleSmall),
            const SizedBox(height: 2),
            Text(
              'Outstanding amounts are tracked separately until they settle.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 8),
            LedgerRow(
              label: 'Pending payments',
              hint: 'Owed to you, not yet received',
              amount: report.pendingPayments,
              currency: report.currency,
            ),
            LedgerRow(
              label: 'Unpaid expenses',
              hint: 'Recorded but not yet settled',
              amount: report.unpaidExpenses,
              currency: report.currency,
            ),
            LedgerRow(
              label: 'Disputed',
              amount: report.disputedAmount,
              currency: report.currency,
            ),
            const SizedBox(height: 4),
          ],
        ),
      ),
    );
  }
}

/// The server's own definitions, collapsed by default.
class _DefinitionsCard extends StatelessWidget {
  const _DefinitionsCard({required this.definitions});

  final Map<String, String> definitions;

  static const _labels = {
    'netRevenue': 'Net revenue',
    'processingFees': 'Processing fees',
    'eligibleExpenses': 'Eligible expenses',
    'netProfit': 'Net profit',
    'receivedStatuses': 'What counts as received',
  };

  @override
  Widget build(BuildContext context) {
    if (definitions.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);

    return Card(
      child: ExpansionTile(
        title: Text('How these figures are defined', style: theme.textTheme.titleSmall),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          for (final entry in definitions.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _labels[entry.key] ?? humanize(entry.key),
                    style: theme.textTheme.labelMedium,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    entry.value,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _NoteBanner extends StatelessWidget {
  const _NoteBanner({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.pending(context).withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.pending(context).withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AppTheme.pending(context)),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: theme.textTheme.bodySmall)),
        ],
      ),
    );
  }
}
