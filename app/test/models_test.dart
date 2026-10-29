import 'dart:convert';

import 'package:company_management/shared/models.dart';
import 'package:flutter_test/flutter_test.dart';

/// Contract tests against real API payloads.
///
/// The JSON below was captured verbatim from a running backend
/// (`GET /api/v1/dashboard` and `GET /api/v1/reports/profit-loss`), trimmed
/// only in the number of list entries. If the API's field names or nesting
/// change, these tests fail here rather than the app silently rendering em
/// dashes on a partner's phone.
void main() {
  group('Dashboard.fromJson', () {
    final json = jsonDecode(_dashboardPayload) as Map<String, dynamic>;
    final dashboard = Dashboard.fromJson(json);

    test('reads the range label', () {
      expect(dashboard.rangeLabel, 'This year');
    });

    test('keeps every monetary figure as the exact string the API sent', () {
      expect(dashboard.summary.grossRevenue, '159969.12');
      expect(dashboard.summary.netRevenue, '159500.00');
      expect(dashboard.summary.netProfit, '141313.88');
      expect(dashboard.summary.totalRefunds, '469.12');
      expect(dashboard.summary.processingFees, '3786.12');
    });

    test('reads counts from the nested counts object', () {
      expect(dashboard.activeProjects, 3);
      expect(dashboard.totalProjects, 3);
      expect(dashboard.needingReview, 0);
    });

    test('reads revenue by project', () {
      expect(dashboard.revenueByProject, hasLength(3));
      final first = dashboard.revenueByProject.first;
      expect(first.name, '[DEMO] Client Website');
      expect(first.netRevenue, '69500.00');
    });

    test('survives a payload with the optional sections missing', () {
      final sparse = Dashboard.fromJson({
        'range': {'label': 'Today'},
        'summary': {'currency': 'INR'},
      });
      expect(sparse.rangeLabel, 'Today');
      expect(sparse.revenueByProject, isEmpty);
      expect(sparse.activeProjects, 0);
      // A missing amount must default to a parseable '0', never null.
      expect(sparse.summary.netProfit, '0');
    });
  });

  group('ProfitLossReport.fromJson', () {
    final json = jsonDecode(_profitLossPayload) as Map<String, dynamic>;
    final report = ProfitLossReport.fromJson(json);

    test('flattens the nested revenue, costs and result objects', () {
      expect(report.grossRevenue, '35469.12');
      expect(report.refunds, '469.12');
      expect(report.netRevenue, '35000.00');
      expect(report.processingFees, '847.92');
      expect(report.eligibleExpenses, '2400.00');
      expect(report.netProfit, '31752.08');
      expect(report.profitMargin, '90.72');
    });

    test('reads outstanding amounts, which are NOT part of profit', () {
      expect(report.pendingPayments, '0.00');
      expect(report.unpaidExpenses, '0.00');
      expect(report.disputedAmount, '0.00');
    });

    test('reads expense categories', () {
      expect(report.byCategory, hasLength(1));
      expect(report.byCategory.first.name, 'Hosting & Infrastructure');
      expect(report.byCategory.first.total, '2400.00');
    });

    test('keeps the server-supplied definitions verbatim', () {
      expect(report.definitions['netProfit'], contains('Net revenue minus'));
      expect(report.definitions, contains('receivedStatuses'));
    });

    test('hasExcludedExpenses is false when recorded equals eligible', () {
      expect(report.hasExcludedExpenses, isFalse);
    });

    test('hasExcludedExpenses is true when some expenses are excluded', () {
      final partial = ProfitLossReport.fromJson({
        'currency': 'INR',
        'costs': {'eligibleExpenses': '100.00', 'totalExpensesRecorded': '250.00'},
      });
      expect(partial.hasExcludedExpenses, isTrue);
    });

    test('survives an empty payload rather than throwing', () {
      final empty = ProfitLossReport.fromJson(const {});
      expect(empty.currency, 'INR');
      expect(empty.netProfit, '0');
      expect(empty.byCategory, isEmpty);
      expect(empty.definitions, isEmpty);
    });
  });
}

const _dashboardPayload = '''
{
  "range": {
    "from": "2025-12-31T18:30:00.000Z",
    "to": "2026-10-14T18:29:59.999Z",
    "label": "This year"
  },
  "summary": {
    "currency": "INR",
    "grossRevenue": "159969.12",
    "totalRefunds": "469.12",
    "netRevenue": "159500.00",
    "processingFees": "3786.12",
    "totalExpenses": "14400.00",
    "eligibleExpenses": "14400.00",
    "unpaidExpenses": "0.00",
    "netProfit": "141313.88",
    "pendingPayments": "0.00",
    "disputedAmount": "0.00",
    "transactionCount": 20,
    "refundCount": 2,
    "expenseCount": 6,
    "unconvertedRecords": 0
  },
  "counts": {
    "activeProjects": 3,
    "totalProjects": 3,
    "activeSubscriptions": 0,
    "transactionsNeedingReview": 0
  },
  "revenueByProject": [
    {
      "projectId": "5928ca2c-8fc3-4111-82f9-b94405ff2aa7",
      "code": "DEMO-CLIENT",
      "name": "[DEMO] Client Website",
      "type": "CLIENT_WEBSITE",
      "status": "ACTIVE",
      "grossRevenue": "69969.12",
      "refunds": "469.12",
      "netRevenue": "69500.00",
      "processingFees": "1662.12",
      "expenses": "0.00",
      "netProfit": "67837.88",
      "transactionCount": 8
    },
    {
      "projectId": "c6eb4d13-c4bc-4a66-a10e-c05ddaac2907",
      "code": "DEMO-APP",
      "name": "[DEMO] Dating App",
      "type": "MOBILE_APPLICATION",
      "status": "ACTIVE",
      "grossRevenue": "52500.00",
      "refunds": "0.00",
      "netRevenue": "52500.00",
      "processingFees": "1239.00",
      "expenses": "0.00",
      "netProfit": "51261.00",
      "transactionCount": 6
    },
    {
      "projectId": "49a878e5-3d26-4506-a2fd-f57566fca8a1",
      "code": "DEMO-SAAS",
      "name": "[DEMO] Invoice SaaS",
      "type": "SAAS",
      "status": "ACTIVE",
      "grossRevenue": "37500.00",
      "refunds": "0.00",
      "netRevenue": "37500.00",
      "processingFees": "885.00",
      "expenses": "14400.00",
      "netProfit": "22215.00",
      "transactionCount": 6
    }
  ]
}
''';

const _profitLossPayload = '''
{
  "range": {
    "from": "2026-09-30T18:30:00.000Z",
    "to": "2026-10-14T18:29:59.999Z",
    "label": "This month"
  },
  "currency": "INR",
  "revenue": {
    "grossRevenue": "35469.12",
    "refunds": "469.12",
    "netRevenue": "35000.00"
  },
  "costs": {
    "processingFees": "847.92",
    "eligibleExpenses": "2400.00",
    "totalExpensesRecorded": "2400.00",
    "byCategory": [
      {
        "categoryId": "2ef718fe-990b-4e23-944d-e698e97c9426",
        "name": "Hosting & Infrastructure",
        "total": "2400.00",
        "countedTowardProfit": "2400.00"
      }
    ]
  },
  "result": {
    "netProfit": "31752.08",
    "profitMargin": "90.72"
  },
  "outstanding": {
    "pendingPayments": "0.00",
    "unpaidExpenses": "0.00",
    "disputedAmount": "0.00"
  },
  "dataQuality": {
    "unconvertedRecords": 0,
    "note": null
  },
  "definitions": {
    "netRevenue": "Gross revenue (received payments) minus settled refunds",
    "processingFees": "Provider fees on received payments, minus fees returned with refunds",
    "eligibleExpenses": "Recorded expenses excluding canceled ones and those flagged excludeFromProfit",
    "netProfit": "Net revenue minus processing fees minus eligible expenses",
    "receivedStatuses": "SUCCEEDED, PARTIALLY_REFUNDED, REFUNDED. PENDING and FAILED are excluded."
  }
}
''';
