/// API models.
///
/// EVERY MONETARY FIELD IS A `String`.
///
/// That is deliberate and load-bearing. `double` is binary floating point and
/// cannot represent 1999.99 exactly; parsing money into one here would mean the
/// phone and the web dashboard could show different totals for the same data.
/// Amounts arrive as decimal strings, are stored as strings, and are formatted
/// as strings. The backend is the only thing that does arithmetic on them.

String? _str(dynamic value) => value == null ? null : value.toString();

String _money(dynamic value) => value?.toString() ?? '0';

int _int(dynamic value) => (value as num?)?.toInt() ?? 0;

bool _bool(dynamic value) => value as bool? ?? false;

class SessionUser {
  const SessionUser({
    required this.id,
    required this.email,
    required this.fullName,
    this.avatarUrl,
    required this.timezone,
    required this.locale,
  });

  final String id;
  final String email;
  final String fullName;
  final String? avatarUrl;
  final String timezone;
  final String locale;

  factory SessionUser.fromJson(Map<String, dynamic> json) => SessionUser(
        id: json['id'] as String,
        email: json['email'] as String,
        fullName: json['fullName'] as String,
        avatarUrl: _str(json['avatarUrl']),
        timezone: json['timezone'] as String? ?? 'Asia/Kolkata',
        locale: json['locale'] as String? ?? 'en-IN',
      );
}

class Membership {
  const Membership({
    required this.companyId,
    required this.companyName,
    required this.role,
    required this.baseCurrency,
    required this.timezone,
  });

  final String companyId;
  final String companyName;
  final String role;
  final String baseCurrency;
  final String timezone;

  factory Membership.fromJson(Map<String, dynamic> json) => Membership(
        companyId: json['companyId'] as String,
        companyName: json['companyName'] as String? ?? 'Company',
        role: json['role'] as String? ?? 'PARTNER',
        baseCurrency: json['baseCurrency'] as String? ?? 'INR',
        timezone: json['timezone'] as String? ?? 'Asia/Kolkata',
      );

  /// `/auth/me` nests the company; `/auth/login` flattens it. One parser for both.
  factory Membership.fromProfileJson(Map<String, dynamic> json) {
    final company = json['company'] as Map<String, dynamic>? ?? const {};
    return Membership(
      companyId: json['companyId'] as String,
      companyName: company['name'] as String? ?? 'Company',
      role: json['role'] as String? ?? 'PARTNER',
      baseCurrency: company['baseCurrency'] as String? ?? 'INR',
      timezone: company['timezone'] as String? ?? 'Asia/Kolkata',
    );
  }

  bool get canWrite => role == 'OWNER' || role == 'ADMIN' || role == 'PARTNER';
  bool get canAdminister => role == 'OWNER' || role == 'ADMIN';
}

class LoginResult {
  const LoginResult({
    required this.user,
    required this.memberships,
    required this.accessToken,
    required this.refreshToken,
  });

  final SessionUser user;
  final List<Membership> memberships;
  final String accessToken;
  final String? refreshToken;

  factory LoginResult.fromJson(Map<String, dynamic> json) => LoginResult(
        user: SessionUser.fromJson(json['user'] as Map<String, dynamic>),
        memberships: (json['memberships'] as List<dynamic>? ?? [])
            .map((m) => Membership.fromJson(m as Map<String, dynamic>))
            .toList(),
        accessToken: json['accessToken'] as String,
        refreshToken: _str(json['refreshToken']),
      );
}

class FinancialSummary {
  const FinancialSummary({
    required this.currency,
    required this.grossRevenue,
    required this.totalRefunds,
    required this.netRevenue,
    required this.processingFees,
    required this.totalExpenses,
    required this.eligibleExpenses,
    required this.unpaidExpenses,
    required this.netProfit,
    required this.pendingPayments,
    required this.disputedAmount,
    required this.transactionCount,
    required this.expenseCount,
    required this.unconvertedRecords,
  });

  final String currency;
  final String grossRevenue;
  final String totalRefunds;
  final String netRevenue;
  final String processingFees;
  final String totalExpenses;
  final String eligibleExpenses;
  final String unpaidExpenses;
  final String netProfit;
  final String pendingPayments;
  final String disputedAmount;
  final int transactionCount;
  final int expenseCount;
  final int unconvertedRecords;

  factory FinancialSummary.fromJson(Map<String, dynamic> json) => FinancialSummary(
        currency: json['currency'] as String? ?? 'INR',
        grossRevenue: _money(json['grossRevenue']),
        totalRefunds: _money(json['totalRefunds']),
        netRevenue: _money(json['netRevenue']),
        processingFees: _money(json['processingFees']),
        totalExpenses: _money(json['totalExpenses']),
        eligibleExpenses: _money(json['eligibleExpenses']),
        unpaidExpenses: _money(json['unpaidExpenses']),
        netProfit: _money(json['netProfit']),
        pendingPayments: _money(json['pendingPayments']),
        disputedAmount: _money(json['disputedAmount']),
        transactionCount: _int(json['transactionCount']),
        expenseCount: _int(json['expenseCount']),
        unconvertedRecords: _int(json['unconvertedRecords']),
      );
}

class ProjectRevenueRow {
  const ProjectRevenueRow({
    this.projectId,
    required this.code,
    required this.name,
    required this.netRevenue,
    required this.netProfit,
    required this.expenses,
    required this.transactionCount,
  });

  final String? projectId;
  final String code;
  final String name;
  final String netRevenue;
  final String netProfit;
  final String expenses;
  final int transactionCount;

  factory ProjectRevenueRow.fromJson(Map<String, dynamic> json) => ProjectRevenueRow(
        projectId: _str(json['projectId']),
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
        netRevenue: _money(json['netRevenue']),
        netProfit: _money(json['netProfit']),
        expenses: _money(json['expenses']),
        transactionCount: _int(json['transactionCount']),
      );
}

class MonthlyTrendPoint {
  const MonthlyTrendPoint({
    required this.month,
    required this.netRevenue,
    required this.expenses,
    required this.netProfit,
  });

  final String month;
  final String netRevenue;
  final String expenses;
  final String netProfit;

  factory MonthlyTrendPoint.fromJson(Map<String, dynamic> json) => MonthlyTrendPoint(
        month: json['month'] as String? ?? '',
        netRevenue: _money(json['netRevenue']),
        expenses: _money(json['expenses']),
        netProfit: _money(json['netProfit']),
      );
}

class ExpenseCategoryTotal {
  const ExpenseCategoryTotal({required this.name, required this.total, this.color});

  final String name;
  final String total;
  final String? color;

  factory ExpenseCategoryTotal.fromJson(Map<String, dynamic> json) => ExpenseCategoryTotal(
        name: json['name'] as String? ?? '',
        total: _money(json['total']),
        color: _str(json['color']),
      );
}

class Dashboard {
  const Dashboard({
    required this.rangeLabel,
    required this.summary,
    required this.activeProjects,
    required this.totalProjects,
    required this.activeSubscriptions,
    required this.needingReview,
    required this.revenueByProject,
    required this.expensesByCategory,
    required this.monthlyTrend,
    required this.hasUnconvertedRecords,
    required this.unconvertedRecords,
  });

  final String rangeLabel;
  final FinancialSummary summary;
  final int activeProjects;
  final int totalProjects;
  final int activeSubscriptions;
  final int needingReview;
  final List<ProjectRevenueRow> revenueByProject;
  final List<ExpenseCategoryTotal> expensesByCategory;
  final List<MonthlyTrendPoint> monthlyTrend;
  final bool hasUnconvertedRecords;
  final int unconvertedRecords;

  factory Dashboard.fromJson(Map<String, dynamic> json) {
    final counts = json['counts'] as Map<String, dynamic>? ?? const {};
    final quality = json['dataQuality'] as Map<String, dynamic>? ?? const {};
    final range = json['range'] as Map<String, dynamic>? ?? const {};

    return Dashboard(
      rangeLabel: range['label'] as String? ?? '',
      summary: FinancialSummary.fromJson(json['summary'] as Map<String, dynamic>? ?? const {}),
      activeProjects: _int(counts['activeProjects']),
      totalProjects: _int(counts['totalProjects']),
      activeSubscriptions: _int(counts['activeSubscriptions']),
      needingReview: _int(counts['transactionsNeedingReview']),
      revenueByProject: (json['revenueByProject'] as List<dynamic>? ?? [])
          .map((r) => ProjectRevenueRow.fromJson(r as Map<String, dynamic>))
          .toList(),
      expensesByCategory: (json['expensesByCategory'] as List<dynamic>? ?? [])
          .map((r) => ExpenseCategoryTotal.fromJson(r as Map<String, dynamic>))
          .toList(),
      monthlyTrend: (json['monthlyTrend'] as List<dynamic>? ?? [])
          .map((r) => MonthlyTrendPoint.fromJson(r as Map<String, dynamic>))
          .toList(),
      hasUnconvertedRecords: _bool(quality['hasUnconvertedRecords']),
      unconvertedRecords: _int(quality['unconvertedRecords']),
    );
  }
}

class Project {
  const Project({
    required this.id,
    required this.code,
    required this.name,
    this.description,
    required this.type,
    required this.status,
    required this.revenueModel,
    required this.currency,
    this.projectUrl,
    this.launchDate,
    this.archivedAt,
  });

  final String id;
  final String code;
  final String name;
  final String? description;
  final String type;
  final String status;
  final String revenueModel;
  final String currency;
  final String? projectUrl;
  final String? launchDate;
  final String? archivedAt;

  factory Project.fromJson(Map<String, dynamic> json) => Project(
        id: json['id'] as String,
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
        description: _str(json['description']),
        type: json['type'] as String? ?? 'OTHER',
        status: json['status'] as String? ?? 'ACTIVE',
        revenueModel: json['revenueModel'] as String? ?? 'OTHER',
        currency: json['currency'] as String? ?? 'INR',
        projectUrl: _str(json['projectUrl']),
        launchDate: _str(json['launchDate']),
        archivedAt: _str(json['archivedAt']),
      );
}

class ProjectFinancials {
  const ProjectFinancials({
    required this.currency,
    required this.grossRevenue,
    required this.netRevenue,
    required this.totalRefunds,
    required this.processingFees,
    required this.eligibleExpenses,
    required this.netProfit,
    required this.pendingPayments,
    required this.transactionCount,
    required this.expenseCount,
  });

  final String currency;
  final String grossRevenue;
  final String netRevenue;
  final String totalRefunds;
  final String processingFees;
  final String eligibleExpenses;
  final String netProfit;
  final String pendingPayments;
  final int transactionCount;
  final int expenseCount;

  factory ProjectFinancials.fromJson(Map<String, dynamic> json) => ProjectFinancials(
        currency: json['currency'] as String? ?? 'INR',
        grossRevenue: _money(json['grossRevenue']),
        netRevenue: _money(json['netRevenue']),
        totalRefunds: _money(json['totalRefunds']),
        processingFees: _money(json['processingFees']),
        eligibleExpenses: _money(json['eligibleExpenses']),
        netProfit: _money(json['netProfit']),
        pendingPayments: _money(json['pendingPayments']),
        transactionCount: _int(json['transactionCount']),
        expenseCount: _int(json['expenseCount']),
      );
}

class Transaction {
  const Transaction({
    required this.id,
    this.projectName,
    this.projectId,
    required this.status,
    required this.type,
    required this.provider,
    required this.grossAmount,
    required this.feeAmount,
    required this.refundedAmount,
    required this.netAmount,
    required this.refundableRemaining,
    required this.currency,
    this.description,
    this.customerReference,
    required this.occurredAt,
    required this.source,
    required this.reviewStatus,
    this.reviewNote,
  });

  final String id;
  final String? projectName;
  final String? projectId;
  final String status;
  final String type;
  final String provider;
  final String grossAmount;
  final String feeAmount;
  final String refundedAmount;
  final String netAmount;
  final String refundableRemaining;
  final String currency;
  final String? description;
  final String? customerReference;
  final String occurredAt;
  final String source;
  final String reviewStatus;
  final String? reviewNote;

  factory Transaction.fromJson(Map<String, dynamic> json) {
    final project = json['project'] as Map<String, dynamic>?;
    return Transaction(
      id: json['id'] as String,
      projectId: _str(json['projectId']),
      projectName: project == null ? null : project['name'] as String?,
      status: json['status'] as String? ?? 'SUCCEEDED',
      type: json['type'] as String? ?? 'OTHER',
      provider: json['provider'] as String? ?? 'MANUAL_BANK',
      grossAmount: _money(json['grossAmount']),
      feeAmount: _money(json['feeAmount']),
      refundedAmount: _money(json['refundedAmount']),
      netAmount: _money(json['netAmount']),
      refundableRemaining: _money(json['refundableRemaining']),
      currency: json['currency'] as String? ?? 'INR',
      description: _str(json['description']),
      customerReference: _str(json['customerReference']),
      occurredAt: json['occurredAt'] as String? ?? '',
      source: json['source'] as String? ?? 'MANUAL',
      reviewStatus: json['reviewStatus'] as String? ?? 'NOT_REQUIRED',
      reviewNote: _str(json['reviewNote']),
    );
  }

  bool get needsProject => reviewStatus == 'NEEDS_REVIEW';
  bool get canRefund => (double.tryParse(refundableRemaining) ?? 0) > 0;
}

class Expense {
  const Expense({
    required this.id,
    this.projectName,
    required this.categoryName,
    required this.vendor,
    required this.amount,
    required this.totalAmount,
    required this.currency,
    required this.expenseDate,
    required this.paymentStatus,
    required this.excludeFromProfit,
  });

  final String id;
  final String? projectName;
  final String categoryName;
  final String vendor;
  final String amount;
  final String totalAmount;
  final String currency;
  final String expenseDate;
  final String paymentStatus;
  final bool excludeFromProfit;

  factory Expense.fromJson(Map<String, dynamic> json) {
    final project = json['project'] as Map<String, dynamic>?;
    final category = json['category'] as Map<String, dynamic>? ?? const {};
    return Expense(
      id: json['id'] as String,
      projectName: project == null ? null : project['name'] as String?,
      categoryName: category['name'] as String? ?? 'Uncategorised',
      vendor: json['vendor'] as String? ?? '',
      amount: _money(json['amount']),
      totalAmount: _money(json['totalAmount']),
      currency: json['currency'] as String? ?? 'INR',
      expenseDate: json['expenseDate'] as String? ?? '',
      paymentStatus: json['paymentStatus'] as String? ?? 'PAID',
      excludeFromProfit: _bool(json['excludeFromProfit']),
    );
  }
}

class PartnerShare {
  const PartnerShare({
    required this.userId,
    required this.fullName,
    required this.email,
    required this.percentage,
    required this.calculatedShare,
    required this.actuallyPaid,
    required this.outstanding,
  });

  final String userId;
  final String fullName;
  final String email;
  final String percentage;

  /// What this partner is OWED — not money that has been paid.
  final String calculatedShare;

  /// What has ACTUALLY been transferred to them.
  final String actuallyPaid;

  final String outstanding;

  factory PartnerShare.fromJson(Map<String, dynamic> json) => PartnerShare(
        userId: json['userId'] as String,
        fullName: json['fullName'] as String? ?? '',
        email: json['email'] as String? ?? '',
        percentage: _money(json['percentage']),
        calculatedShare: _money(json['calculatedShare']),
        actuallyPaid: _money(json['actuallyPaid']),
        outstanding: _money(json['outstanding']),
      );
}

class ProfitShareStatement {
  const ProfitShareStatement({
    required this.rangeLabel,
    required this.currency,
    required this.netProfit,
    required this.configured,
    required this.partners,
    this.message,
    this.totalOutstanding,
  });

  final String rangeLabel;
  final String currency;
  final String netProfit;
  final bool configured;
  final List<PartnerShare> partners;
  final String? message;
  final String? totalOutstanding;

  factory ProfitShareStatement.fromJson(Map<String, dynamic> json) {
    final range = json['range'] as Map<String, dynamic>? ?? const {};
    final totals = json['totals'] as Map<String, dynamic>?;
    return ProfitShareStatement(
      rangeLabel: range['label'] as String? ?? '',
      currency: json['currency'] as String? ?? 'INR',
      netProfit: _money(json['netProfit']),
      configured: _bool(json['configured']),
      partners: (json['partners'] as List<dynamic>? ?? [])
          .map((p) => PartnerShare.fromJson(p as Map<String, dynamic>))
          .toList(),
      message: _str(json['message']),
      totalOutstanding: totals == null ? null : _money(totals['outstanding']),
    );
  }
}

/// Profit-and-loss statement — `GET /reports/profit-loss`.
///
/// The server sends its own `definitions` map alongside the figures. We keep it
/// and show it, rather than writing our own wording in the app: if the backend
/// ever changes what counts as an eligible expense, the explanation on the
/// phone changes with it instead of quietly going stale.
class ProfitLossReport {
  const ProfitLossReport({
    required this.rangeLabel,
    required this.currency,
    required this.grossRevenue,
    required this.refunds,
    required this.netRevenue,
    required this.processingFees,
    required this.eligibleExpenses,
    required this.totalExpensesRecorded,
    required this.byCategory,
    required this.netProfit,
    required this.profitMargin,
    required this.pendingPayments,
    required this.unpaidExpenses,
    required this.disputedAmount,
    required this.unconvertedRecords,
    required this.dataQualityNote,
    required this.definitions,
  });

  final String rangeLabel;
  final String currency;

  final String grossRevenue;
  final String refunds;
  final String netRevenue;

  final String processingFees;
  final String eligibleExpenses;
  final String totalExpensesRecorded;
  final List<ExpenseCategoryTotal> byCategory;

  final String netProfit;

  /// A percentage, not money — the API sends it as a decimal string too.
  final String profitMargin;

  final String pendingPayments;
  final String unpaidExpenses;
  final String disputedAmount;

  final int unconvertedRecords;
  final String? dataQualityNote;

  /// The server's own description of each figure, in its own words.
  final Map<String, String> definitions;

  /// True when some expenses were recorded but excluded from profit, so the
  /// screen can explain the difference instead of showing two totals that look
  /// contradictory.
  bool get hasExcludedExpenses => eligibleExpenses != totalExpensesRecorded;

  factory ProfitLossReport.fromJson(Map<String, dynamic> json) {
    final range = json['range'] as Map<String, dynamic>? ?? const {};
    final revenue = json['revenue'] as Map<String, dynamic>? ?? const {};
    final costs = json['costs'] as Map<String, dynamic>? ?? const {};
    final result = json['result'] as Map<String, dynamic>? ?? const {};
    final outstanding = json['outstanding'] as Map<String, dynamic>? ?? const {};
    final quality = json['dataQuality'] as Map<String, dynamic>? ?? const {};
    final definitions = json['definitions'] as Map<String, dynamic>? ?? const {};

    return ProfitLossReport(
      rangeLabel: range['label'] as String? ?? '',
      currency: json['currency'] as String? ?? 'INR',
      grossRevenue: _money(revenue['grossRevenue']),
      refunds: _money(revenue['refunds']),
      netRevenue: _money(revenue['netRevenue']),
      processingFees: _money(costs['processingFees']),
      eligibleExpenses: _money(costs['eligibleExpenses']),
      totalExpensesRecorded: _money(costs['totalExpensesRecorded']),
      byCategory: (costs['byCategory'] as List<dynamic>? ?? [])
          .map((c) => ExpenseCategoryTotal.fromJson(c as Map<String, dynamic>))
          .toList(),
      netProfit: _money(result['netProfit']),
      profitMargin: _money(result['profitMargin']),
      pendingPayments: _money(outstanding['pendingPayments']),
      unpaidExpenses: _money(outstanding['unpaidExpenses']),
      disputedAmount: _money(outstanding['disputedAmount']),
      unconvertedRecords: _int(quality['unconvertedRecords']),
      dataQualityNote: _str(quality['note']),
      definitions: definitions.map((k, v) => MapEntry(k, v.toString())),
    );
  }
}
