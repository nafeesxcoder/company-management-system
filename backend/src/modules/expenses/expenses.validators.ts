import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import {
  currencySchema,
  exchangeRateSchema,
  nonNegativeMoneySchema,
  positiveMoneySchema,
} from '../transactions/transactions.validators.js';

export const EXPENSE_PAYMENT_STATUSES = ['PENDING', 'PAID', 'OVERDUE', 'CANCELED'] as const;

export const BILLING_INTERVALS = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUAL',
  'ANNUAL',
  'CUSTOM',
] as const;

export const createExpenseSchema = z.object({
  /** Null means a company-wide overhead rather than a project cost. */
  projectId: z.string().uuid().nullish(),
  categoryId: z.string().uuid('A category is required'),
  vendor: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).nullish(),

  amount: positiveMoneySchema,
  taxAmount: nonNegativeMoneySchema.default('0'),
  currency: currencySchema,
  exchangeRateToBase: exchangeRateSchema.nullish(),

  expenseDate: z.string().date().or(z.string().datetime({ offset: true })),
  paymentStatus: z.enum(EXPENSE_PAYMENT_STATUSES).default('PAID'),
  paidAt: z.string().datetime({ offset: true }).nullish(),

  receiptUrl: z.string().url().max(512).nullish(),
  notes: z.string().trim().max(5000).nullish(),

  /**
   * Set for a cost already captured elsewhere — most often a payment gateway
   * fee, which is deducted on the transaction row. Keeps profit honest.
   */
  excludeFromProfit: z.boolean().default(false),

  isRecurring: z.boolean().default(false),
  recurringInterval: z.enum(BILLING_INTERVALS).nullish(),
});

export const updateExpenseSchema = createExpenseSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const expenseIdParamSchema = z.object({ id: z.string().uuid('Invalid expense id') });

export const listExpensesQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  paymentStatus: z.enum(EXPENSE_PAYMENT_STATUSES).optional(),
  vendor: z.string().trim().max(160).optional(),
  currency: currencySchema.optional(),
  companyWideOnly: z.coerce.boolean().optional(),
  from: z.string().date().or(z.string().datetime({ offset: true })).optional(),
  to: z.string().date().or(z.string().datetime({ offset: true })).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #2563eb')
    .optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  isActive: z.boolean().optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
