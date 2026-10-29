import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env.js';

/**
 * OpenAPI document, assembled from the @openapi JSDoc blocks on each route file.
 * Served at `${API_PREFIX}/docs` when SWAGGER_ENABLED is true.
 */
export const openApiSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Company Management System API',
      version: '1.0.0',
      description: [
        'Financial, project and partner management API.',
        '',
        '**Money format.** All monetary values cross the wire as decimal *strings*',
        '(e.g. `"1999.99"`), never as JSON numbers, so no client can lose precision',
        'to a float. Every amount is paired with an ISO-4217 `currency`.',
        '',
        '**Authority.** All financial figures are computed by this API. The web and',
        'mobile clients render what they are given and never recompute totals.',
        '',
        '**Company scoping.** Every financial route resolves the company from the',
        "caller's active membership. Pass `X-Company-Id` when a user belongs to more",
        'than one company; otherwise the first membership is used.',
      ].join('\n'),
      license: { name: 'Proprietary' },
    },
    servers: [
      { url: `http://localhost:${env.PORT}${env.API_PREFIX}`, description: 'Local development' },
      { url: `https://api.example.com${env.API_PREFIX}`, description: 'Production' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Short-lived access token from `/auth/login`.',
        },
      },
      parameters: {
        CompanyId: {
          in: 'header',
          name: 'X-Company-Id',
          required: false,
          schema: { type: 'string', format: 'uuid' },
          description: 'Selects the company when the user belongs to more than one.',
        },
        Page: { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
        PageSize: {
          in: 'query',
          name: 'pageSize',
          schema: { type: 'integer', minimum: 1, maximum: 200, default: 25 },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string' },
                details: {},
                requestId: { type: 'string' },
              },
            },
          },
        },
        Money: {
          type: 'string',
          description: 'Decimal amount as a string, e.g. "1999.99".',
          example: '1999.99',
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
            totalItems: { type: 'integer' },
            totalPages: { type: 'integer' },
            hasNextPage: { type: 'boolean' },
            hasPreviousPage: { type: 'boolean' },
          },
        },
        FinancialSummary: {
          type: 'object',
          description: 'All figures in the company base currency.',
          properties: {
            currency: { type: 'string', example: 'INR' },
            grossRevenue: { $ref: '#/components/schemas/Money' },
            totalRefunds: { $ref: '#/components/schemas/Money' },
            netRevenue: { $ref: '#/components/schemas/Money' },
            processingFees: { $ref: '#/components/schemas/Money' },
            totalExpenses: { $ref: '#/components/schemas/Money' },
            eligibleExpenses: { $ref: '#/components/schemas/Money' },
            netProfit: { $ref: '#/components/schemas/Money' },
            pendingPayments: { $ref: '#/components/schemas/Money' },
            unconvertedRecords: {
              type: 'integer',
              description: 'Records excluded because no exchange rate was recorded.',
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing, expired or invalid access token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'Authenticated but not permitted',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Resource not found, or not visible to this company',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        ValidationError: {
          description: 'Request failed validation',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Sign-in, tokens, profile and password management' },
      { name: 'Companies', description: 'Company settings' },
      { name: 'Members', description: 'Partners, roles and invitations' },
      { name: 'Projects', description: 'Registered apps, SaaS products and client projects' },
      { name: 'Dashboard', description: 'Aggregated financial figures' },
      { name: 'Transactions', description: 'Income and payment records' },
      { name: 'Refunds', description: 'Full and partial refunds' },
      { name: 'Subscriptions', description: 'Recurring revenue' },
      { name: 'Expenses', description: 'Costs and expense categories' },
      { name: 'Reports', description: 'Profit and loss, exports' },
      { name: 'Profit Sharing', description: 'Partner shares and payouts' },
      { name: 'Payment Providers', description: 'Integrations and product mappings' },
      { name: 'Webhooks', description: 'Verified provider callbacks' },
      { name: 'Audit Logs', description: 'Who changed what' },
    ],
  },
  // Works for both tsx (src/**/*.ts) and the compiled build (dist/**/*.js).
  apis: ['src/modules/**/*.routes.ts', 'src/routes/*.ts', 'dist/modules/**/*.routes.js', 'dist/routes/*.js'],
});
