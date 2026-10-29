import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';

export const PROJECT_TYPES = [
  'SAAS',
  'WEB_APPLICATION',
  'MOBILE_APPLICATION',
  'CLIENT_WEBSITE',
  'CUSTOM_SOFTWARE',
  'OTHER',
] as const;

export const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as const;

export const REVENUE_MODELS = [
  'MONTHLY_SUBSCRIPTION',
  'ANNUAL_SUBSCRIPTION',
  'ONE_TIME_PAYMENT',
  'IN_APP_PURCHASE',
  'ADVERTISING',
  'CLIENT_MILESTONE',
  'MANUAL_BANK_TRANSFER',
  'OTHER',
] as const;

const currencySchema = z
  .string()
  .trim()
  .length(3)
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO-4217 code');

/**
 * A stable, human-readable identifier unique within the company. Used in CSV
 * exports and provider product mappings, so it is uppercase and URL-safe.
 */
const projectCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Code may contain only letters, digits, hyphens and underscores');

export const createProjectSchema = z.object({
  code: projectCodeSchema,
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(5000).nullish(),
  type: z.enum(PROJECT_TYPES).default('OTHER'),
  status: z.enum(PROJECT_STATUSES).default('ACTIVE'),
  revenueModel: z.enum(REVENUE_MODELS).default('OTHER'),
  currency: currencySchema.default('INR'),
  projectUrl: z.string().url().max(512).nullish(),
  repositoryUrl: z.string().url().max(512).nullish(),
  launchDate: z.string().date().nullish(),
  notes: z.string().trim().max(5000).nullish(),
});

export const updateProjectSchema = createProjectSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Provide at least one field to update' },
);

export const projectIdParamSchema = z.object({ id: z.string().uuid('Invalid project id') });

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PROJECT_STATUSES).optional(),
  type: z.enum(PROJECT_TYPES).optional(),
  revenueModel: z.enum(REVENUE_MODELS).optional(),
  includeArchived: z.coerce.boolean().default(false),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
