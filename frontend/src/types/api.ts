/**
 * Types mirroring the API contract.
 *
 * Every monetary field is `Money` — a decimal STRING, never a number. Parsing
 * money into a JS number loses precision (0.1 + 0.2 !== 0.3), so amounts are
 * kept as strings and only converted for display or charting.
 */
export type Money = string;

export type MembershipRole = 'OWNER' | 'ADMIN' | 'PARTNER' | 'VIEWER';
export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED';

export type ProjectType =
  | 'SAAS'
  | 'WEB_APPLICATION'
  | 'MOBILE_APPLICATION'
  | 'CLIENT_WEBSITE'
  | 'CUSTOM_SOFTWARE'
  | 'OTHER';

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';

export type RevenueModel =
  | 'MONTHLY_SUBSCRIPTION'
  | 'ANNUAL_SUBSCRIPTION'
  | 'ONE_TIME_PAYMENT'
  | 'IN_APP_PURCHASE'
  | 'ADVERTISING'
  | 'CLIENT_MILESTONE'
  | 'MANUAL_BANK_TRANSFER'
  | 'OTHER';

export type PaymentProvider = 'STRIPE' | 'RAZORPAY' | 'GOOGLE_PLAY' | 'MANUAL_BANK' | 'OTHER';

export type TransactionStatus =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'DISPUTED';

export type TransactionType =
  | 'ONE_TIME_PAYMENT'
  | 'SUBSCRIPTION_INITIAL'
  | 'SUBSCRIPTION_RENEWAL'
  | 'IN_APP_PURCHASE'
  | 'MILESTONE_PAYMENT'
  | 'MANUAL_ENTRY'
  | 'ADVERTISING_PAYOUT'
  | 'OTHER';

export type ExpensePaymentStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED';
export type ReviewStatus = 'NOT_REQUIRED' | 'NEEDS_REVIEW' | 'RESOLVED';
export type RecordSource = 'AUTOMATED' | 'MANUAL' | 'IMPORTED';

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'thisYear'
  | 'lastYear'
  | 'allTime'
  | 'custom';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
}

export interface MembershipSummary {
  companyId: string;
  companyName: string;
  role: MembershipRole;
  baseCurrency: string;
  timezone: string;
}

export interface LoginResponse {
  user: SessionUser;
  memberships: MembershipSummary[];
  accessToken: string;
  accessTokenExpiresIn: number;
  tokenType: string;
}

export interface UserProfile extends SessionUser {
  lastLoginAt: string | null;
  createdAt: string;
  memberships: {
    companyId: string;
    role: MembershipRole;
    joinedAt: string | null;
    company: {
      id: string;
      name: string;
      baseCurrency: string;
      timezone: string;
      logoUrl: string | null;
    };
  }[];
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: ProjectType;
  status: ProjectStatus;
  revenueModel: RevenueModel;
  currency: string;
  projectUrl: string | null;
  repositoryUrl: string | null;
  launchDate: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; fullName: string } | null;
  _count?: { transactions: number; expenses: number; subscriptions: number };
}

export interface ProjectFinancials {
  currency: string;
  grossRevenue: Money;
  totalRefunds: Money;
  netRevenue: Money;
  processingFees: Money;
  totalExpenses: Money;
  eligibleExpenses: Money;
  netProfit: Money;
  pendingPayments: Money;
  transactionCount: number;
  expenseCount: number;
  unconvertedRecords: number;
}

export interface Transaction {
  id: string;
  projectId: string | null;
  provider: PaymentProvider;
  providerAccountId: string | null;
  externalTransactionId: string | null;
  type: TransactionType;
  status: TransactionStatus;
  grossAmount: Money;
  feeAmount: Money;
  refundedAmount: Money;
  netAmount: Money;
  refundableRemaining: Money;
  currency: string;
  exchangeRateToBase: string | null;
  customerReference: string | null;
  description: string | null;
  source: RecordSource;
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  occurredAt: string;
  settledAt: string | null;
  createdAt: string;
  project?: { id: string; code: string; name: string; currency: string } | null;
  createdBy?: { id: string; fullName: string } | null;
  providerAccount?: { id: string; label: string; provider: PaymentProvider } | null;
  refunds?: Refund[];
}

export interface Refund {
  id: string;
  amount: Money;
  feeRefunded: Money;
  currency: string;
  status: string;
  isPartial: boolean;
  reason: string | null;
  source: RecordSource;
  occurredAt: string;
  createdBy?: { id: string; fullName: string } | null;
  transaction?: {
    id: string;
    grossAmount: Money;
    currency: string;
    project: { id: string; code: string; name: string } | null;
  };
}

export interface ExpenseCategory {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  isSystem: boolean;
  isActive: boolean;
  _count?: { expenses: number };
}

export interface Expense {
  id: string;
  projectId: string | null;
  categoryId: string;
  vendor: string;
  description: string | null;
  amount: Money;
  taxAmount: Money;
  totalAmount: Money;
  currency: string;
  exchangeRateToBase: string | null;
  expenseDate: string;
  paymentStatus: ExpensePaymentStatus;
  paidAt: string | null;
  receiptUrl: string | null;
  notes: string | null;
  excludeFromProfit: boolean;
  isRecurring: boolean;
  source: RecordSource;
  createdAt: string;
  project?: { id: string; code: string; name: string } | null;
  category: { id: string; name: string; slug: string; color: string | null };
  createdBy?: { id: string; fullName: string } | null;
}

export interface FinancialSummary {
  currency: string;
  grossRevenue: Money;
  totalRefunds: Money;
  netRevenue: Money;
  processingFees: Money;
  totalExpenses: Money;
  eligibleExpenses: Money;
  unpaidExpenses: Money;
  netProfit: Money;
  pendingPayments: Money;
  disputedAmount: Money;
  transactionCount: number;
  refundCount: number;
  expenseCount: number;
  unconvertedRecords: number;
}

export interface ProjectRevenueRow {
  projectId: string | null;
  code: string;
  name: string;
  type: ProjectType | null;
  status: ProjectStatus | null;
  grossRevenue: Money;
  refunds: Money;
  netRevenue: Money;
  processingFees: Money;
  expenses: Money;
  netProfit: Money;
  transactionCount: number;
}

export interface MonthlyTrendPoint {
  month: string;
  grossRevenue: Money;
  refunds: Money;
  netRevenue: Money;
  processingFees: Money;
  expenses: Money;
  netProfit: Money;
}

export interface Dashboard {
  range: { from: string; to: string; label: string };
  summary: FinancialSummary;
  counts: {
    activeProjects: number;
    totalProjects: number;
    activeSubscriptions: number;
    transactionsNeedingReview: number;
  };
  revenueByProject: ProjectRevenueRow[];
  revenueByProvider: {
    provider: PaymentProvider;
    grossRevenue: Money;
    processingFees: Money;
    transactionCount: number;
  }[];
  expensesByCategory: {
    categoryId: string;
    name: string;
    color: string | null;
    total: Money;
    count: number;
  }[];
  monthlyTrend: MonthlyTrendPoint[];
  dataQuality: {
    unconvertedRecords: number;
    hasUnconvertedRecords: boolean;
    transactionsNeedingReview: number;
  };
}

export interface ProfitLossReport {
  range: { from: string; to: string; label: string };
  currency: string;
  revenue: { grossRevenue: Money; refunds: Money; netRevenue: Money };
  costs: {
    processingFees: Money;
    eligibleExpenses: Money;
    totalExpensesRecorded: Money;
    byCategory: { categoryId: string; name: string; total: Money; countedTowardProfit: Money }[];
  };
  result: { netProfit: Money; profitMargin: string | null };
  outstanding: { pendingPayments: Money; unpaidExpenses: Money; disputedAmount: Money };
  dataQuality: { unconvertedRecords: number; note: string | null };
  definitions: Record<string, string>;
}

export interface PartnerShareRow {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  percentage: string;
  calculatedShare: Money;
  actuallyPaid: Money;
  outstanding: Money;
  effectiveFrom: string;
}

export interface ProfitShareStatement {
  range: { from: string; to: string; label: string };
  currency: string;
  netProfit: Money;
  configured: boolean;
  message?: string;
  partners: PartnerShareRow[];
  totals?: { calculated: Money; paid: Money; outstanding: Money };
  note?: string;
}

export interface Payout {
  id: string;
  userId: string;
  amount: Money;
  currency: string;
  payoutDate: string;
  status: 'PENDING' | 'PAID' | 'CANCELED';
  method: string | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  partner: { id: string; fullName: string; email?: string };
  createdBy?: { id: string; fullName: string } | null;
}

export interface ProviderAccount {
  id: string;
  provider: PaymentProvider;
  label: string;
  externalAccountId: string | null;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  isActive: boolean;
  isVerified: boolean;
  lastWebhookAt: string | null;
  createdAt: string;
  productMappingCount: number;
  transactionCount: number;
  webhookUrl: string;
  readiness: {
    credentialsStored: boolean;
    productMappingsConfigured: boolean;
    signedEventReceived: boolean;
    ready: boolean;
  };
}

export interface ProductMapping {
  id: string;
  externalProductId: string;
  label: string | null;
  isActive: boolean;
  createdAt: string;
  project: { id: string; code: string; name: string };
}

export interface WebhookEvent {
  id: string;
  provider: PaymentProvider;
  externalEventId: string;
  eventType: string;
  signatureValid: boolean;
  status: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'IGNORED' | 'NEEDS_REVIEW';
  attempts: number;
  lastError: string | null;
  receivedAt: string;
  processedAt: string | null;
  providerAccount: { id: string; label: string } | null;
}

export interface Member {
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
  invitedAt: string | null;
  joinedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    avatarUrl: string | null;
    isActive: boolean;
    lastLoginAt: string | null;
  };
  invitedBy: { id: string; fullName: string } | null;
}

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  baseCurrency: string;
  timezone: string;
  fiscalYearStartMonth: number;
  logoUrl: string | null;
  createdAt: string;
  yourRole: MembershipRole;
  _count?: { projects: number; memberships: number };
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  beforeData: unknown;
  afterData: unknown;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; email: string } | null;
}
