import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';

export const TRANSACTION_TYPES = [
  'ONE_TIME_PAYMENT',
  'SUBSCRIPTION_INITIAL',
  'SUBSCRIPTION_RENEWAL',
  'IN_APP_PURCHASE',
  'MILESTONE_PAYMENT',
  'MANUAL_ENTRY',
  'ADVERTISING_PAYOUT',
  'OTHER',
] as const;

export const TRANSACTION_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'DISPUTED',
] as const;

export const PAYMENT_PROVIDERS = ['STRIPE', 'RAZORPAY', 'GOOGLE_PLAY', 'MANUAL_BANK', 'OTHER'] as const;

/**
 * Money arrives as a STRING, never a JSON number.
 *
 * `1999.99` as a JSON number is already a float by the time it reaches us and
 * may have lost precision in the client. Requiring a string keeps the decimal
 * exact from the form field all the way to the DECIMAL(18,4) column.
 */
export const moneySchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,14}(\.\d{1,4})?$/, 'Amount must be a decimal string with at most 4 decimal places')
  .refine((v) => Number.isFinite(Number(v)), 'Amount must be a valid number');

export const positiveMoneySchema = moneySchema.refine(
  (v) => Number(v) > 0,
  'Amount must be greater than zero',
);

export const nonNegativeMoneySchema = moneySchema.refine(
  (v) => Number(v) >= 0,
  'Amount must not be negative',
);

export const currencySchema = z
  .string()
  .trim()
  .length(3)
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO-4217 code');

export const exchangeRateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,8})?$/, 'Exchange rate must be a positive decimal string')
  .refine((v) => Number(v) > 0, 'Exchange rate must be greater than zero');

export const createTransactionSchema = z
  .object({
    projectId: z.string().uuid('Invalid project id'),
    type: z.enum(TRANSACTION_TYPES).default('MANUAL_ENTRY'),
    status: z.enum(TRANSACTION_STATUSES).default('SUCCEEDED'),
    provider: z.enum(PAYMENT_PROVIDERS).default('MANUAL_BANK'),
    providerAccountId: z.string().uuid().nullish(),
    externalTransactionId: z.string().trim().max(191).nullish(),

    grossAmount: positiveMoneySchema,
    feeAmount: nonNegativeMoneySchema.default('0'),
    currency: currencySchema,
    /** Required when `currency` differs from the company base currency. */
    exchangeRateToBase: exchangeRateSchema.nullish(),

    customerReference: z.string().trim().max(191).nullish(),
    description: z.string().trim().max(500).nullish(),
    invoiceId: z.string().uuid().nullish(),
    subscriptionId: z.string().uuid().nullish(),

    occurredAt: z.string().datetime({ offset: true }).or(z.string().date()),
    settledAt: z.string().datetime({ offset: true }).nullish(),
  })
  .refine((v) => Number(v.feeAmount) <= Number(v.grossAmount), {
    message: 'Fee cannot exceed the gross amount',
    path: ['feeAmount'],
  });

export const updateTransactionSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    type: z.enum(TRANSACTION_TYPES).optional(),
    status: z.enum(TRANSACTION_STATUSES).optional(),
    grossAmount: positiveMoneySchema.optional(),
    feeAmount: nonNegativeMoneySchema.optional(),
    currency: currencySchema.optional(),
    exchangeRateToBase: exchangeRateSchema.nullish(),
    customerReference: z.string().trim().max(191).nullish(),
    description: z.string().trim().max(500).nullish(),
    occurredAt: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
    settledAt: z.string().datetime({ offset: true }).nullish(),
    reviewNote: z.string().trim().max(500).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const transactionIdParamSchema = z.object({ id: z.string().uuid('Invalid transaction id') });

export const listTransactionsQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().uuid().optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  provider: z.enum(PAYMENT_PROVIDERS).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  source: z.enum(['AUTOMATED', 'MANUAL', 'IMPORTED']).optional(),
  reviewStatus: z.enum(['NOT_REQUIRED', 'NEEDS_REVIEW', 'RESOLVED']).optional(),
  currency: currencySchema.optional(),
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  minAmount: moneySchema.optional(),
  maxAmount: moneySchema.optional(),
});

/** Resolves a payment that could not be matched to a project automatically. */
export const assignProjectSchema = z.object({
  projectId: z.string().uuid('Invalid project id'),
  note: z.string().trim().max(500).optional(),
});

export const createRefundSchema = z.object({
  amount: positiveMoneySchema,
  /** Omitted or equal to the remaining balance means a full refund. */
  reason: z.string().trim().max(500).nullish(),
  externalRefundId: z.string().trim().max(191).nullish(),
  feeRefunded: nonNegativeMoneySchema.default('0'),
  occurredAt: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
export type CreateRefundInput = z.infer<typeof createRefundSchema>;
export type AssignProjectInput = z.infer<typeof assignProjectSchema>;
