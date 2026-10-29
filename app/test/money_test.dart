import 'package:company_management/core/utils/money.dart';
import 'package:flutter_test/flutter_test.dart';

/// Money is formatted, never calculated, on the device. These tests pin that
/// down: the formatter must not round, re-scale, or quietly turn a decimal
/// string into a double somewhere along the way.
///
/// Assertions check the digits and the symbol rather than one exact string,
/// because `intl` is free to place a non-breaking space between them and that
/// is not the behaviour under test.
void main() {
  group('Money.format', () {
    test('groups INR in the Indian system (lakh/crore), not in thousands', () {
      final formatted = Money.format('1234567.89');
      expect(formatted, contains('12,34,567.89'));
      expect(formatted, contains('₹'));
      // The Western grouping would be 1,234,567.89 — it must not appear.
      expect(formatted, isNot(contains('1,234,567')));
    });

    test('keeps two decimals for a whole amount', () {
      expect(Money.format('35000'), contains('35,000.00'));
    });

    test('does not lose the paisa that a double would', () {
      // 1999.99 has no exact binary representation; it must still print whole.
      expect(Money.format('1999.99'), contains('1,999.99'));
    });

    test('renders a missing amount as an em dash, not as zero', () {
      expect(Money.format(null), '—');
      expect(Money.format(''), '—');
    });

    test('renders an unparseable amount as an em dash', () {
      expect(Money.format('not-a-number'), '—');
    });

    test('uses zero decimals for zero-decimal currencies', () {
      final formatted = Money.format('5000', currency: 'JPY');
      expect(formatted, contains('5,000'));
      expect(formatted, isNot(contains('.00')));
    });

    test('groups USD in thousands', () {
      final formatted = Money.format('1234567.89', currency: 'USD');
      expect(formatted, contains('1,234,567.89'));
      expect(formatted, contains(r'$'));
    });

    test('falls back to the ISO code for a currency with no symbol', () {
      expect(Money.format('100', currency: 'AED'), contains('AED'));
    });

    test('keeps a negative amount negative', () {
      final formatted = Money.format('-2400.50');
      expect(formatted, contains('2,400.50'));
      expect(formatted, anyOf(contains('-'), contains('(')));
    });

    test('compact form shortens large figures', () {
      final compact = Money.format('1500000', compact: true);
      expect(compact.length, lessThan(Money.format('1500000').length));
    });
  });

  group('Money.symbolFor', () {
    test('maps the currencies the app ships with, case-insensitively', () {
      expect(Money.symbolFor('INR'), '₹');
      expect(Money.symbolFor('usd'), r'$');
      expect(Money.symbolFor('EUR'), '€');
      expect(Money.symbolFor('GBP'), '£');
    });

    test('falls back to the uppercased code', () {
      expect(Money.symbolFor('aed'), contains('AED'));
    });
  });

  group('sign helpers', () {
    test('isNegative is true only below zero', () {
      expect(Money.isNegative('-0.01'), isTrue);
      expect(Money.isNegative('0.00'), isFalse);
      expect(Money.isNegative('12.00'), isFalse);
      expect(Money.isNegative(null), isFalse);
    });

    test('isZero treats 0 and 0.00 alike, and treats absent as zero', () {
      expect(Money.isZero('0'), isTrue);
      expect(Money.isZero('0.00'), isTrue);
      expect(Money.isZero(null), isTrue);
      expect(Money.isZero('0.01'), isFalse);
    });
  });

  group('Money.toChartValue', () {
    test('parses for charting and defaults to zero', () {
      expect(Money.toChartValue('2400.50'), closeTo(2400.50, 0.001));
      expect(Money.toChartValue(null), 0);
      expect(Money.toChartValue('nonsense'), 0);
    });
  });

  group('humanize', () {
    test('turns an API enum into readable text', () {
      expect(humanize('PARTIALLY_REFUNDED'), 'Partially refunded');
      expect(humanize('MONTHLY_SUBSCRIPTION'), 'Monthly subscription');
    });

    test('renders an absent value as an em dash', () {
      expect(humanize(null), '—');
      expect(humanize(''), '—');
    });
  });

  group('Dates', () {
    test('renders an absent or invalid date as an em dash', () {
      expect(Dates.short(null), '—');
      expect(Dates.short('not-a-date'), '—');
      expect(Dates.withTime(''), '—');
    });

    test('formats a month key', () {
      expect(Dates.monthLabel('2026-03'), 'Mar');
      // A malformed key comes back untouched rather than throwing.
      expect(Dates.monthLabel('garbage'), 'garbage');
    });
  });
}
