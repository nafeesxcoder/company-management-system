import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/money.dart';
import '../../shared/models.dart';
import '../../shared/widgets/figure.dart';
import '../../shared/widgets/preset_chips.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';

/// Overview.
///
/// Mirrors the web dashboard: net profit as the result of an equation, with
/// the working shown. Every figure comes from the API — the app does no money
/// arithmetic, so the phone and the dashboard cannot disagree.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  String _preset = 'thisMonth';

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final dashboard = ref.watch(dashboardProvider(_preset));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Overview'),
        actions: [
          IconButton(
            icon: const Icon(Icons.folder_outlined),
            tooltip: 'Projects',
            onPressed: () => context.push('/projects'),
          ),
          IconButton(
            icon: const Icon(Icons.summarize_outlined),
            tooltip: 'Profit & loss',
            onPressed: () => context.push('/reports'),
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Settings',
            onPressed: () => context.push('/settings'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(dashboardProvider(_preset)),
        child: dashboard.when(
          loading: () => const LoadingState(label: 'Loading figures'),
          error: (error, _) => ListView(
            children: [
              SizedBox(height: MediaQuery.sizeOf(context).height * 0.2),
              ErrorStateView(
                error: error,
                onRetry: () => ref.invalidate(dashboardProvider(_preset)),
              ),
            ],
          ),
          data: (data) => ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              PresetChips(
                selected: _preset,
                onSelected: (value) => setState(() => _preset = value),
              ),
              const SizedBox(height: 16),

              DataQualityBanner(
                unconvertedRecords: data.unconvertedRecords,
                needingReview: data.needingReview,
              ),

              _EquationCard(summary: data.summary, rangeLabel: data.rangeLabel),
              const SizedBox(height: 16),

              _CountsRow(data: data),
              const SizedBox(height: 16),

              if (data.monthlyTrend.isNotEmpty) ...[
                _TrendCard(points: data.monthlyTrend, currency: auth.currency),
                const SizedBox(height: 16),
              ],

              if (data.revenueByProject.isNotEmpty)
                _ProjectsCard(rows: data.revenueByProject, currency: auth.currency),

              if (data.revenueByProject.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 24),
                  child: EmptyState(
                    title: 'No revenue in this period',
                    description:
                        'Record income from the web app, or connect a payment provider so payments arrive automatically.',
                    icon: Icons.trending_up,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EquationCard extends StatelessWidget {
  const _EquationCard({required this.summary, required this.rangeLabel});

  final FinancialSummary summary;
  final String rangeLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isLoss = Money.isNegative(summary.netProfit);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Figure(
              summary.netProfit,
              currency: summary.currency,
              size: 38,
              signed: true,
            ),
            const SizedBox(height: 4),
            Text(
              '${isLoss ? 'net loss' : 'net profit'} · $rangeLabel',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            const Divider(),
            const SizedBox(height: 8),

            // The working, so the headline figure can be checked.
            LedgerRow(
              label: 'Gross revenue',
              amount: summary.grossRevenue,
              currency: summary.currency,
            ),
            LedgerRow(
              label: 'Less refunds',
              amount: summary.totalRefunds,
              currency: summary.currency,
              muted: true,
            ),
            LedgerRow(
              label: 'Less processing fees',
              amount: summary.processingFees,
              currency: summary.currency,
              muted: true,
            ),
            LedgerRow(
              label: 'Less expenses',
              amount: summary.eligibleExpenses,
              currency: summary.currency,
              muted: true,
            ),
            const Divider(),
            LedgerRow(
              label: isLoss ? 'Net loss' : 'Net profit',
              amount: summary.netProfit,
              currency: summary.currency,
              signed: true,
              emphasis: true,
            ),

            const SizedBox(height: 12),
            Wrap(
              spacing: 20,
              runSpacing: 8,
              children: [
                _MiniStat(
                  label: 'Awaiting payment',
                  amount: summary.pendingPayments,
                  currency: summary.currency,
                  hint: 'not counted as revenue',
                ),
                _MiniStat(
                  label: 'Unpaid bills',
                  amount: summary.unpaidExpenses,
                  currency: summary.currency,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({
    required this.label,
    required this.amount,
    required this.currency,
    this.hint,
  });

  final String label;
  final String amount;
  final String currency;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        Figure(amount, currency: currency, size: 15, muted: true),
        if (hint != null)
          Text(
            hint!,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
      ],
    );
  }
}

class _CountsRow extends StatelessWidget {
  const _CountsRow({required this.data});

  final Dashboard data;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _CountTile(
            icon: Icons.folder_outlined,
            value: '${data.activeProjects}',
            label: 'Active projects',
            onTap: () => context.push('/projects'),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _CountTile(
            icon: Icons.autorenew,
            value: '${data.activeSubscriptions}',
            label: 'Subscriptions',
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _CountTile(
            icon: Icons.flag_outlined,
            value: '${data.needingReview}',
            label: 'To assign',
            urgent: data.needingReview > 0,
            onTap: () => context.go('/transactions'),
          ),
        ),
      ],
    );
  }
}

class _CountTile extends StatelessWidget {
  const _CountTile({
    required this.icon,
    required this.value,
    required this.label,
    this.urgent = false,
    this.onTap,
  });

  final IconData icon;
  final String value;
  final String label;
  final bool urgent;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = urgent ? AppTheme.pending(context) : theme.colorScheme.onSurfaceVariant;

    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
          child: Column(
            children: [
              Icon(icon, size: 18, color: color),
              const SizedBox(height: 6),
              Text(
                value,
                style: AppTheme.figureStyle(size: 20, color: urgent ? color : null),
              ),
              const SizedBox(height: 2),
              Text(
                label,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
                maxLines: 2,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TrendCard extends StatelessWidget {
  const _TrendCard({required this.points, required this.currency});

  final List<MonthlyTrendPoint> points;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Doubles appear only here, at the chart boundary. The displayed figures
    // elsewhere are always the API's decimal strings.
    final revenueSpots = <FlSpot>[];
    final profitSpots = <FlSpot>[];
    for (var i = 0; i < points.length; i++) {
      revenueSpots.add(FlSpot(i.toDouble(), Money.toChartValue(points[i].netRevenue)));
      profitSpots.add(FlSpot(i.toDouble(), Money.toChartValue(points[i].netProfit)));
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 16, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 6),
              child: Text('Revenue and profit', style: theme.textTheme.titleSmall),
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 180,
              child: LineChart(
                LineChartData(
                  gridData: FlGridData(
                    show: true,
                    drawVerticalLine: false,
                    getDrawingHorizontalLine: (_) => FlLine(
                      color: theme.colorScheme.outlineVariant.withValues(alpha: 0.5),
                      strokeWidth: 1,
                    ),
                  ),
                  borderData: FlBorderData(show: false),
                  titlesData: FlTitlesData(
                    topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    leftTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        reservedSize: 52,
                        getTitlesWidget: (value, meta) => Text(
                          Money.format(value.toStringAsFixed(0),
                              currency: currency, compact: true),
                          style: theme.textTheme.labelSmall,
                        ),
                      ),
                    ),
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        interval: 1,
                        getTitlesWidget: (value, meta) {
                          final index = value.toInt();
                          if (index < 0 || index >= points.length) {
                            return const SizedBox.shrink();
                          }
                          // Thin out labels so they do not collide on a phone.
                          if (points.length > 6 && index % 2 != 0) {
                            return const SizedBox.shrink();
                          }
                          return Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              Dates.monthLabel(points[index].month),
                              style: theme.textTheme.labelSmall,
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                  lineBarsData: [
                    LineChartBarData(
                      spots: revenueSpots,
                      color: AppTheme.gain(context),
                      barWidth: 2.5,
                      isCurved: true,
                      dotData: const FlDotData(show: false),
                    ),
                    LineChartBarData(
                      spots: profitSpots,
                      color: theme.colorScheme.onSurface,
                      barWidth: 2,
                      isCurved: true,
                      dotData: const FlDotData(show: false),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _LegendDot(color: AppTheme.gain(context), label: 'Net revenue'),
                const SizedBox(width: 16),
                _LegendDot(color: theme.colorScheme.onSurface, label: 'Net profit'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 10, height: 3, color: color),
        const SizedBox(width: 6),
        Text(label, style: Theme.of(context).textTheme.labelSmall),
      ],
    );
  }
}

class _ProjectsCard extends StatelessWidget {
  const _ProjectsCard({required this.rows, required this.currency});

  final List<ProjectRevenueRow> rows;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text('By project', style: theme.textTheme.titleSmall),
          ),
          for (final row in rows.take(8))
            ListTile(
              dense: true,
              title: Text(row.name, maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: Text(
                '${row.code} · ${row.transactionCount} payment${row.transactionCount == 1 ? '' : 's'}',
                style: theme.textTheme.bodySmall,
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Figure(row.netRevenue, currency: currency, size: 15),
                  Figure(row.netProfit, currency: currency, size: 12, signed: true),
                ],
              ),
              onTap: row.projectId == null ? null : () => context.push('/projects/${row.projectId}'),
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
