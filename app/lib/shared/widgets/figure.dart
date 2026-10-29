import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/money.dart';

/// The one way money is rendered in this app.
///
/// Serif with tabular numerals, so a column of amounts aligns on the decimal.
/// `signed: true` colours by sign; otherwise the figure stays neutral, because
/// colour here means something and is not decoration.
class Figure extends StatelessWidget {
  const Figure(
    this.amount, {
    super.key,
    this.currency = 'INR',
    this.size = 16,
    this.weight = FontWeight.w600,
    this.signed = false,
    this.muted = false,
    this.compact = false,
  });

  final String? amount;
  final String currency;
  final double size;
  final FontWeight weight;
  final bool signed;
  final bool muted;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    Color? color;
    if (muted) {
      color = scheme.onSurfaceVariant;
    } else if (signed) {
      if (Money.isNegative(amount)) {
        color = AppTheme.loss(context);
      } else if (!Money.isZero(amount)) {
        color = AppTheme.gain(context);
      } else {
        color = scheme.onSurfaceVariant;
      }
    }

    return Text(
      Money.format(amount, currency: currency, compact: compact),
      style: AppTheme.figureStyle(size: size, weight: weight, color: color),
    );
  }
}

/// A labelled ledger line: label left, figure right-aligned.
class LedgerRow extends StatelessWidget {
  const LedgerRow({
    super.key,
    required this.label,
    required this.amount,
    required this.currency,
    this.hint,
    this.signed = false,
    this.muted = false,
    this.emphasis = false,
  });

  final String label;
  final String amount;
  final String currency;
  final String? hint;
  final bool signed;
  final bool muted;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.symmetric(vertical: emphasis ? 10 : 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: emphasis ? FontWeight.w600 : FontWeight.w400,
                    color: emphasis ? null : theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                if (hint != null)
                  Text(
                    hint!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Figure(
            amount,
            currency: currency,
            size: emphasis ? 18 : 15,
            signed: signed,
            muted: muted,
          ),
        ],
      ),
    );
  }
}
