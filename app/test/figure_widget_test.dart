import 'package:company_management/core/theme/app_theme.dart';
import 'package:company_management/shared/widgets/figure.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Widget tests for the one component that renders money.
///
/// The point is not pixels — it is that an amount reaches the screen as the
/// API wrote it, and that a missing amount degrades to an em dash instead of a
/// confident, wrong zero.
void main() {
  Widget host(Widget child) => MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: Center(child: child)),
      );

  group('Figure', () {
    testWidgets('renders an INR amount with Indian grouping', (tester) async {
      await tester.pumpWidget(host(const Figure('159500.00')));
      expect(find.textContaining('1,59,500.00'), findsOneWidget);
    });

    testWidgets('renders a missing amount as an em dash', (tester) async {
      await tester.pumpWidget(host(const Figure(null)));
      expect(find.text('—'), findsOneWidget);
    });

    testWidgets('renders a USD amount with its own symbol', (tester) async {
      await tester.pumpWidget(host(const Figure('1200.00', currency: 'USD')));
      expect(find.textContaining(r'$'), findsOneWidget);
      expect(find.textContaining('1,200.00'), findsOneWidget);
    });

    testWidgets('a signed negative figure is coloured as a loss', (tester) async {
      await tester.pumpWidget(host(const Figure('-500.00', signed: true)));

      final text = tester.widget<Text>(find.byType(Text));
      expect(text.style?.color, isNotNull);
    });

    testWidgets('an unsigned figure stays neutral', (tester) async {
      await tester.pumpWidget(host(const Figure('-500.00')));

      final text = tester.widget<Text>(find.byType(Text));
      // No colour is applied, so it inherits the surrounding text colour.
      expect(text.style?.color, isNull);
    });
  });

  group('LedgerRow', () {
    testWidgets('shows the label, the hint and the amount together', (tester) async {
      await tester.pumpWidget(
        host(
          const LedgerRow(
            label: 'Net revenue',
            hint: 'After refunds',
            amount: '35000.00',
            currency: 'INR',
          ),
        ),
      );

      expect(find.text('Net revenue'), findsOneWidget);
      expect(find.text('After refunds'), findsOneWidget);
      expect(find.textContaining('35,000.00'), findsOneWidget);
    });

    testWidgets('omits the hint line when none is given', (tester) async {
      await tester.pumpWidget(
        host(const LedgerRow(label: 'Refunds', amount: '0.00', currency: 'INR')),
      );

      expect(find.text('Refunds'), findsOneWidget);
      // Label and figure only.
      expect(find.byType(Text), findsNWidgets(2));
    });
  });
}
