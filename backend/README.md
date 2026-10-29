# Backend API

Express + TypeScript + Prisma + MySQL 8. The only component that talks to the
database, and the only place money is calculated.

## Quick start

```bash
cp .env.example .env     # set DATABASE_URL, generate the three secrets
npm install
npm run prisma:migrate   # apply migrations
npm run seed             # demo data — development only
npm run dev              # http://localhost:4000, docs at /api/v1/docs
```

Secrets must be generated, not invented:

```bash
openssl rand -base64 48   # ACCESS_TOKEN_SECRET
openssl rand -base64 48   # REFRESH_TOKEN_SECRET (must differ from the above)
openssl rand -hex 32      # APP_ENCRYPTION_KEY (exactly 64 hex characters)
```

Config is validated at boot: the process refuses to start on a missing or weak
value rather than running insecurely.

## Scripts

| | |
|---|---|
| `npm run dev` | Watch mode (tsx) |
| `npm run build` | `prisma generate` + `tsc` |
| `npm start` | Run the built server |
| `npm test` | Vitest — unit + integration |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` | Create and apply a dev migration |
| `npm run prisma:deploy` | Apply migrations in production — creates nothing |
| `npm run prisma:status` | What is applied vs. pending |
| `npm run seed` | Demo company and sample data (dev only) |
| `npm run create:owner` | Interactive: creates one real OWNER, no demo data |

## Layout

```
src/
├── config/        env validation (Zod), Prisma client, Swagger
├── middleware/    authenticate · companyScope · validate · rateLimit
│                  requestContext · errorHandler
├── modules/       one folder per area: routes · controller · service · validators
│   ├── auth/              login, rotation, invites, password reset
│   ├── companies/         company, members, audit logs
│   ├── projects/          registration and per-project financials
│   ├── transactions/      income, refunds, attribution
│   ├── expenses/          expenses and categories
│   ├── reports/           THE AUTHORITATIVE FIGURES (calculations.ts)
│   ├── profit-sharing/    configured split and actual payouts
│   └── payment-providers/ accounts, webhooks, signature verification,
│                          ingestion, retry worker
├── utils/         money · dates · errors · pagination · crypto · csv · logger
├── app.ts         builds the Express app (no listening, no timers)
└── server.ts      process entry: boot checks, listen, retry worker, shutdown
```

`app.ts` builds the app; `server.ts` runs it. Tests import `createApp()` without
starting a port or a background timer.

### Layer discipline

| Layer | Does | Never |
|---|---|---|
| routes | paths, middleware, OpenAPI annotation | logic |
| controllers | read request, call service, shape response | touch Prisma, calculate |
| services | business rules, money, transactions | know about `req`/`res` |
| validators | Zod schemas — the request contract | |

## Where the money rules live

`src/modules/reports/calculations.ts`, as pure functions so they can be unit
tested without HTTP or a database:

```
Net revenue = gross revenue (received only) − settled refunds
Net profit  = net revenue − processing fees − eligible expenses
```

- **Received** = `SUCCEEDED`, `PARTIALLY_REFUNDED`, `REFUNDED`. `PENDING` and
  `FAILED` are outstanding, not revenue.
- **Fees** are deducted exactly once, net of fees returned with refunds.
- **Eligible expenses** exclude canceled and `excludeFromProfit` rows; the
  report shows both eligible and total recorded so the difference is visible.
- **Calculated profit share ≠ money paid.** Payouts are separate rows.

Amounts are Prisma `Decimal` end to end and serialize as **strings**. Nothing
widens them to a float.

## Testing

```bash
npm test                                   # all
npx vitest run tests/unit                  # pure calculation tests
npx vitest run tests/integration/auth.test.ts
```

193 tests. Integration tests run against a real MySQL database
(`company_management_test`, from `.env.test`, loaded with override so the suite
cannot touch dev or production data) and cover login and rotation, token reuse
detection, company isolation, financial calculations, refunds, webhook signature
rejection, duplicate-event idempotency, the retry worker, and profit sharing.

## Database

Schema: `prisma/schema.prisma`. Migrations: `prisma/migrations/`.

**`prisma migrate` only — never `db push` as a production strategy.** Changing a
populated column follows expand → migrate → contract; see `docs/database.md`.

### Behind a restrictive network

Prisma downloads its engine binaries from `binaries.prisma.sh` on
`prisma generate` and `prisma migrate`. If that host is blocked you will see
`403 Forbidden` fetching `schema-engine`, which looks like a schema error and is
not one — `tsc` and the already-generated client are unaffected.

Allowlist `binaries.prisma.sh`, or generate the client on a machine that can
reach it and ship `src/generated/`. `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`
only skips the checksum lookup; it does not help when the binary itself is
unreachable.

## Webhooks

`POST /api/v1/webhooks/{stripe|razorpay|google-play|generic}/:accountId`

Unauthenticated by design — the signature is the authentication. Raw bytes are
preserved for verification, comparisons are constant-time, and idempotency is
enforced by unique database constraints rather than application checks that
could race.

A verified event whose processing fails is retried by the worker in
`modules/payment-providers/retry-worker.ts` (5-minute sweep, doubling backoff
capped at 6 hours, `NEEDS_REVIEW` after 6 attempts). Without it, an event that
failed after being answered `200` would simply be lost.

See `docs/payment-integrations.md`.
