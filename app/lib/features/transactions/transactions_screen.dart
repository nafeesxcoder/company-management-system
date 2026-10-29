import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/money.dart';
import '../../shared/models.dart';
import '../../shared/widgets/figure.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';

final transactionsProvider =
    FutureProvider.autoDispose.family<List<Transaction>, String?>((ref, reviewStatus) async {
  final api = ref.watch(apiClientProvider);
  final paged = await api.getPaged('/transactions', query: {
    'pageSize': 50,
    if (reviewStatus != null) 'reviewStatus': reviewStatus,
  });
  return paged.items
      .map((item) => Transaction.fromJson(item as Map<String, dynamic>))
      .toList();
});

class TransactionsScreen extends ConsumerStatefulWidget {
  const TransactionsScreen({super.key});

  @override
  ConsumerState<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends ConsumerState<TransactionsScreen> {
  bool _onlyNeedingReview = false;

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final filter = _onlyNeedingReview ? 'NEEDS_REVIEW' : null;
    final transactions = ref.watch(transactionsProvider(filter));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Income'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: Row(
              children: [
                FilterChip(
                  label: const Text('Needs a project'),
                  selected: _onlyNeedingReview,
                  onSelected: (value) => setState(() => _onlyNeedingReview = value),
                ),
              ],
            ),
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(transactionsProvider(filter)),
        child: transactions.when(
          loading: () => const LoadingState(label: 'Loading payments'),
          error: (error, _) => ListView(children: [
            const SizedBox(height: 120),
            ErrorStateView(error: error, onRetry: () => ref.invalidate(transactionsProvider(filter))),
          ]),
          data: (items) {
            if (items.isEmpty) {
              return ListView(children: [
                const SizedBox(height: 100),
                EmptyState(
                  title: _onlyNeedingReview ? 'Nothing to assign' : 'No payments yet',
                  description: _onlyNeedingReview
                      ? 'Every payment has been matched to a project.'
                      : 'Record income from the web app, or connect a payment provider.',
                  icon: Icons.receipt_outlined,
                ),
              ]);
            }

            return ListView.separated(
              padding: const EdgeInsets.only(bottom: 24),
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1, indent: 16, endIndent: 16),
              itemBuilder: (context, index) => _TransactionTile(
                transaction: items[index],
                canWrite: auth.canWrite,
                onRefund: () => _showRefundSheet(items[index], filter),
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _showRefundSheet(Transaction transaction, String? filter) async {
    final recorded = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _RefundSheet(transaction: transaction),
    );
    if (recorded == true) ref.invalidate(transactionsProvider(filter));
  }
}

class _TransactionTile extends StatelessWidget {
  const _TransactionTile({
    required this.transaction,
    required this.canWrite,
    required this.onRefund,
  });

  final Transaction transaction;
  final bool canWrite;
  final VoidCallback onRefund;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      title: Text(
        transaction.description ??
            transaction.customerReference ??
            humanize(transaction.type),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 2),
          Text(
            '${transaction.projectName ?? 'No project'} · ${Dates.short(transaction.occurredAt)}',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            children: [
              _StatusChip(status: transaction.status),
              if (transaction.needsProject)
                Chip(
                  label: const Text('Needs a project'),
                  visualDensity: VisualDensity.compact,
                  labelStyle: theme.textTheme.labelSmall
                      ?.copyWith(color: AppTheme.pending(context)),
                  side: BorderSide(color: AppTheme.pending(context).withValues(alpha: 0.5)),
                ),
              if (transaction.source == 'AUTOMATED')
                Chip(
                  label: const Text('Auto'),
                  visualDensity: VisualDensity.compact,
                  labelStyle: theme.textTheme.labelSmall,
                ),
            ],
          ),
        ],
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Figure(transaction.netAmount, currency: transaction.currency, size: 15),
          if (Money.toChartValue(transaction.refundedAmount) > 0)
            Text(
              '${Money.format(transaction.refundedAmount, currency: transaction.currency)} refunded',
              style: theme.textTheme.labelSmall?.copyWith(color: AppTheme.loss(context)),
            ),
        ],
      ),
      onTap: canWrite && transaction.canRefund ? onRefund : null,
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final (label, color) = switch (status) {
      'SUCCEEDED' => ('Received', AppTheme.gain(context)),
      'PENDING' => ('Awaiting', AppTheme.pending(context)),
      'REFUNDED' => ('Refunded', AppTheme.loss(context)),
      'PARTIALLY_REFUNDED' => ('Part refunded', AppTheme.loss(context)),
      'FAILED' => ('Failed', theme.colorScheme.onSurfaceVariant),
      'CANCELED' => ('Canceled', theme.colorScheme.onSurfaceVariant),
      'DISPUTED' => ('Disputed', AppTheme.loss(context)),
      _ => (humanize(status), theme.colorScheme.onSurfaceVariant),
    };

    return Chip(
      label: Text(label),
      visualDensity: VisualDensity.compact,
      labelStyle: theme.textTheme.labelSmall?.copyWith(color: color),
      side: BorderSide(color: color.withValues(alpha: 0.4)),
    );
  }
}

/// Refund sheet.
///
/// The amount is typed and sent as a STRING. The app never computes the
/// remaining balance itself — it shows what the API reported and lets the API
/// reject anything larger.
class _RefundSheet extends ConsumerStatefulWidget {
  const _RefundSheet({required this.transaction});

  final Transaction transaction;

  @override
  ConsumerState<_RefundSheet> createState() => _RefundSheetState();
}

class _RefundSheetState extends ConsumerState<_RefundSheet> {
  late final TextEditingController _amountController =
      TextEditingController(text: widget.transaction.refundableRemaining);
  final _reasonController = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _amountController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await ref.read(apiClientProvider).post(
        '/transactions/${widget.transaction.id}/refunds',
        body: {
          'amount': _amountController.text.trim(),
          if (_reasonController.text.trim().isNotEmpty) 'reason': _reasonController.text.trim(),
        },
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _error = ApiException.from(error).message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final transaction = widget.transaction;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        20, 20, 20, MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Record a refund', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            '${Money.format(transaction.refundableRemaining, currency: transaction.currency)} is still refundable.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 20),

          if (_error != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.errorContainer.withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(_error!, style: theme.textTheme.bodySmall),
            ),
            const SizedBox(height: 16),
          ],

          TextField(
            controller: _amountController,
            // Decimal keyboard, but the value stays a string end to end.
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: 'Refund amount',
              prefixText: '${Money.symbolFor(transaction.currency)} ',
            ),
            style: AppTheme.figureStyle(size: 18),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _reasonController,
            decoration: const InputDecoration(labelText: 'Reason (optional)'),
          ),
          const SizedBox(height: 24),

          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: _submitting
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Record refund'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _submitting ? null : () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }
}
