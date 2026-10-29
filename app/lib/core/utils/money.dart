import 'package:intl/intl.dart';

/// Money formatting.
///
/// THIS FILE FORMATS. IT DOES NOT CALCULATE.
///
/// Every amount arrives from the API as a decimal string and is rendered as
/// one. The app never adds, subtracts or totals money: a double cannot hold
/// 1999.99 exactly, and two clients doing their own arithmetic is how a phone
/// and a dashboard end up disagreeing. If a figure is needed, the API computes
/// it and sends it.
class Money {
  const Money._();

  static const _zeroDecimalCurrencies = {'JPY', 'KRW', 'VND', 'CLP', 'ISK'};

  static int _decimals(String currency) =>
      _zeroDecimalCurrencies.contains(currency.toUpperCase()) ? 0 : 2;

  /// Formats a decimal string for display. Returns an em dash for a missing
  /// value rather than a misleading zero.
  static String format(String? amount, {String currency = 'INR', bool compact = false}) {
    if (amount == null || amount.isEmpty) return '—';

    final value = double.tryParse(amount);
    if (value == null) return '—';

    final decimals = _decimals(currency);
    final locale = currency.toUpperCase() == 'INR' ? 'en_IN' : 'en_US';

    if (compact) {
      return NumberFormat.compactCurrency(
        locale: locale,
        symbol: symbolFor(currency),
        decimalDigits: 1,
      ).format(value);
    }

    return NumberFormat.currency(
      locale: locale,
      symbol: symbolFor(currency),
      decimalDigits: decimals,
    ).format(value);
  }

  static String symbolFor(String currency) {
    switch (currency.toUpperCase()) {
      case 'INR':
        return '₹';
      case 'USD':
        return '\$';
      case 'EUR':
        return '€';
      case 'GBP':
        return '£';
      case 'JPY':
        return '¥';
      default:
        return '${currency.toUpperCase()} ';
    }
  }

  /// Sign test for colouring a figure. Used only for presentation — never to
  /// derive another amount.
  static bool isNegative(String? amount) {
    if (amount == null || amount.isEmpty) return false;
    return (double.tryParse(amount) ?? 0) < 0;
  }

  static bool isZero(String? amount) {
    if (amount == null || amount.isEmpty) return true;
    return (double.tryParse(amount) ?? 0) == 0;
  }

  /// For charts only, where a double is unavoidable. Never fed back into a
  /// displayed figure.
  static double toChartValue(String? amount) =>
      amount == null ? 0 : (double.tryParse(amount) ?? 0);
}

class Dates {
  const Dates._();

  static String short(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final parsed = DateTime.tryParse(iso);
    if (parsed == null) return '—';
    return DateFormat('d MMM yyyy').format(parsed.toLocal());
  }

  static String withTime(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final parsed = DateTime.tryParse(iso);
    if (parsed == null) return '—';
    return DateFormat('d MMM yyyy, HH:mm').format(parsed.toLocal());
  }

  static String monthLabel(String monthKey) {
    final parts = monthKey.split('-');
    if (parts.length != 2) return monthKey;
    final year = int.tryParse(parts[0]);
    final month = int.tryParse(parts[1]);
    if (year == null || month == null) return monthKey;
    return DateFormat('MMM').format(DateTime(year, month));
  }

  static String relative(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final parsed = DateTime.tryParse(iso);
    if (parsed == null) return '—';

    final diff = DateTime.now().difference(parsed.toLocal());
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 30) return '${diff.inDays}d ago';
    return short(iso);
  }
}

/// Turns an API enum into readable text: MONTHLY_SUBSCRIPTION → Monthly subscription.
String humanize(String? value) {
  if (value == null || value.isEmpty) return '—';
  final lower = value.replaceAll('_', ' ').toLowerCase();
  return lower[0].toUpperCase() + lower.substring(1);
}
