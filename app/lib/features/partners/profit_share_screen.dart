import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../shared/models.dart';
import '../../shared/widgets/figure.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';

final profitShareProvider =
    FutureProvider.autoDispose.family<ProfitShareStatement, String>((ref, preset) async {
  final api = ref.watch(apiClientProvider);
  final json = await api.get('/profit-sharing', query: {'preset': preset});
  return ProfitShareStatement.fromJson(json);
});

/// Partner split.
///
/// The screen keeps "owed" and "paid" visually separate, because treating a
/// calculated share as money already paid is exactly the confusion that causes
/// disagreements between partners.
class ProfitShareScreen extends ConsumerStatefulWidget {
  const ProfitShareScreen({super.key});

  @override
  ConsumerState<ProfitShareScreen> createState() => _ProfitShareScreenState();
}

class _ProfitShareScreenState extends ConsumerState<ProfitShareScreen> {
  String _preset = 'thisYear';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final statement = ref.watch(profitShareProvider(_preset));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profit split'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.date_range_outlined),
            tooltip: 'Change period',
            onSelected: (value) => setState(() => _preset = value),
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'thisMonth', child: Text('This month')),
              PopupMenuItem(value: 'thisQuarter', child: Text('This quarter')),
              PopupMenuItem(value: 'thisYear', child: Text('This year')),
              PopupMenuItem(value: 'allTime', child: Text('All time')),
            ],
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(profitShareProvider(_preset)),
        child: statement.when(
          loading: () => const LoadingState(label: 'Working out the split'),
          error: (error, _) => ListView(children: [
            const SizedBox(height: 120),
            ErrorStateView(error: error, onRetry: () => ref.invalidate(profitShareProvider(_preset))),
          ]),
          data: (data) {
            if (!data.configured) {
              return ListView(children: [
                const SizedBox(height: 100),
                EmptyState(
                  title: 'No split configured',
                  description: data.message ??
                      'Set the percentages each partner receives in the web app before distributing profit.',
                  icon: Icons.balance_outlined,
                ),
              ]);
            }

            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Figure(data.netProfit, currency: data.currency, size: 34, signed: true),
                        const SizedBox(height: 4),
                        Text(
                          'net profit · ${data.rangeLabel}',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                for (final partner in data.partners) ...[
                  _PartnerCard(partner: partner, currency: data.currency),
                  const SizedBox(height: 12),
                ],

                if (data.totalOutstanding != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                      child: LedgerRow(
                        label: 'Still to pay out',
                        amount: data.totalOutstanding!,
                        currency: data.currency,
                        signed: true,
                        emphasis: true,
                      ),
                    ),
                  ),

                const SizedBox(height: 16),
                Text(
                  'A calculated share is what a partner is owed, not money that has been paid. '
                  'Record payouts in the web app to reduce the outstanding figure.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
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

class _PartnerCard extends StatelessWidget {
  const _PartnerCard({required this.partner, required this.currency});

  final PartnerShare partner;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor: theme.colorScheme.primaryContainer,
                  child: Text(
                    _initials(partner.fullName),
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: theme.colorScheme.onPrimaryContainer,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(partner.fullName, style: theme.textTheme.titleSmall),
                      Text(
                        '${partner.percentage}% share',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Divider(),
            LedgerRow(
              label: 'Owed for this period',
              amount: partner.calculatedShare,
              currency: currency,
            ),
            LedgerRow(
              label: 'Actually paid',
              amount: partner.actuallyPaid,
              currency: currency,
              muted: true,
            ),
            const Divider(),
            LedgerRow(
              label: 'Outstanding',
              amount: partner.outstanding,
              currency: currency,
              signed: true,
              emphasis: true,
            ),
          ],
        ),
      ),
    );
  }

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return parts.take(2).map((p) => p[0].toUpperCase()).join();
  }
}
