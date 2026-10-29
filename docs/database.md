# Database

MySQL 8, accessed only through Prisma, from the backend only. Schema lives in
`backend/prisma/schema.prisma` (821 lines, 20 models, 18 enums); every change
to it becomes a versioned migration under `backend/prisma/migrations/`.

## Money and time: the two rules

**1. Money is `DECIMAL`, never `FLOAT` or `DOUBLE`.**

| Column kind | Type | Why |
|---|---|---|
| Amounts (gross, fee, refunded, expense, payout) | `DECIMAL(18,4)` | Exact. Four places so sub-paisa provider fees and per-unit prices survive storage. |
| Exchange rates | `DECIMAL(18,8)` | Rates need more precision than the amounts they convert. |
| Profit-share percentages | `DECIMAL(7,4)` | e.g. `33.3333`, and the three shares must still total exactly 100. |

Nothing in the stack widens these to a float: Prisma reads them as `Decimal`,
the API serializes them as **strings**, and both clients keep them as strings.

**2. Timestamps are stored in UTC; ranges are computed in the company's
timezone.**

`Company.timezone` (default `Asia/Kolkata`) decides where a day starts. "This
month" for an Indian company is not the UTC month — the range helper converts
the company's local boundary to UTC before querying, which is why a payment at
11pm on the 31st lands in the right month.

## The models

### Identity and tenancy

| Model | Holds |
|---|---|
| `User` | Login identity. `passwordHash` (Argon2id), timezone, locale, `isActive`. A user is not owned by a company. |
| `Company` | The business. `baseCurrency` (default INR), `timezone`, fiscal settings. |
| `CompanyMembership` | The join: which user, which company, which `MembershipRole`, which `MembershipStatus`. **This is the only thing that grants access to financial data.** |
| `RefreshToken` | One row per issued refresh token, stored **hashed**, with `revokedAt`, `replacedById`, device/IP metadata. Rotation chains live here, which is how token reuse is detected. |

A user may belong to more than one company. Every financial query is filtered by
the company id that `companyScope` resolved and verified — never by a value the
client supplied unchecked.

### Projects

| Model | Holds |
|---|---|
| `Project` | Name, unique `code`, `ProjectType`, `RevenueModel`, status, URLs, launch date, currency, notes. Registering a project does **not** import its code — it keeps running on its own infrastructure. |
| `PaymentProviderAccount` | A connected Stripe/Razorpay/Play account. **Secrets are encrypted at rest** (AES-GCM via `APP_ENCRYPTION_KEY`), never returned by the API. |
| `ProviderProductMapping` | Maps a provider-side product/price/plan id to a project. This is how an incoming payment is attributed without guessing. |

### Money in

| Model | Holds |
|---|---|
| `Transaction` | One payment. `grossAmount`, `feeAmount`, `refundedAmount`, `currency`, `status`, `occurredAt`, `source` (`MANUAL`/`AUTOMATED`), `reviewStatus`, `createdById`. |
| `Refund` | A refund against a transaction, full or partial, with its own status and fee return. |
| `Subscription` | Recurring billing: interval, status, current period, linked project. Renewals arrive as transactions. |
| `Invoice` | Optional payment reference for client/milestone work. |
| `WebhookEvent` | Every received provider event: raw payload, signature outcome, processing status, retry count, error. The audit trail for anything that arrived from outside. |

`Transaction.refundedAmount` is a maintained running total, updated inside the
same database transaction as the refund row. Reading "how much of this was
refunded" is therefore a column read, not a `SUM` over a join — and it cannot
drift, because nothing updates one without the other.

### Money out

| Model | Holds |
|---|---|
| `Expense` | Project-scoped or company-wide. Category, vendor, amount, date, `ExpensePaymentStatus`, receipt URL, `excludeFromProfit`, `createdById`. |
| `ExpenseCategory` | Per-company categories, with colour for the charts. |

### Partners

| Model | Holds |
|---|---|
| `PartnerProfitShare` | The configured split — percentage per member, with effective dates. Percentages must total 100. |
| `PartnerPayout` | Money **actually paid** to a partner: amount, date, reference, status, note. |

These are deliberately two tables. A calculated share is not a payment; the
outstanding figure is the difference, and conflating them would report partners
as paid when they have not been.

### Supporting

| Model | Holds |
|---|---|
| `ExchangeRate` | Dated rate per currency pair. A transaction stores the rate used at the time, so restating history is a deliberate act. |
| `AuditLog` | Who did what: actor, action, entity, before/after summary, IP, user agent, request id. |
| `Notification` | In-app notices, e.g. revenue that could not be attributed to a project. |

## Constraints that enforce correctness

These are in the database, not just in application code, because application
code can be bypassed by a bug and a `UNIQUE` index cannot:

```sql
-- Idempotency for payment ingestion: a provider cannot deliver the same
-- payment twice. The duplicate INSERT fails, and that failure IS the gate.
UNIQUE (provider, externalTransactionId)   -- transactions

-- A webhook delivered twice is recorded once.
UNIQUE (provider, externalEventId)         -- webhook_events

-- A refund, a subscription and an invoice each get the same treatment.
UNIQUE (provider, externalRefundId)        -- refunds
UNIQUE (provider, externalSubscriptionId)  -- subscriptions
UNIQUE (companyId, number)                 -- invoices

-- One membership per user per company.
UNIQUE (companyId, userId)                 -- company_memberships

-- Project codes are unique within a company, not globally.
UNIQUE (companyId, code)                   -- projects
```

Indexes follow the queries the dashboard actually makes — composite and
company-first, because every read is already scoped to one company:

```
transactions:  (companyId, occurredAt) · (companyId, status, occurredAt)
               (projectId, occurredAt) · (companyId, reviewStatus)
expenses:      (companyId, expenseDate) · (companyId, paymentStatus)
               (projectId, expenseDate) · (categoryId)
audit_logs:    (companyId, createdAt)
```

Foreign keys use `onDelete: Cascade` where the child cannot exist alone (a
company's transactions), and `SetNull` where the record must survive its
reference (a transaction outlives the user who entered it, so `createdById`
goes null rather than deleting financial history).

## Migrations

**Prisma Migrate only. `db push` is never the production strategy** — it
mutates a database with no history and will drop a column to force the schema
to match.

```bash
# Development: creates a new timestamped migration and applies it
npm run prisma:migrate -- --name add_payout_reference

# Production: applies pending migrations, creates nothing, prompts for nothing
npm run prisma:deploy

# What is applied vs. pending
npm run prisma:status
```

Every migration is committed. The current baseline is
`20261013000000_init/migration.sql`.

### Changing the schema without losing data

The rule is **expand, migrate, contract** — never rename or re-type a populated
column in one step:

1. **Expand** — add the new column as nullable, deploy. Old and new code both run.
2. **Migrate** — backfill in a data migration, deploy the code that writes both.
3. **Contract** — once nothing reads the old column, drop it in a later migration.

Before any production migration:

```bash
mysqldump --single-transaction --routines --triggers \
  -u user -p company_management > backup-$(date +%F-%H%M).sql
npm run prisma:deploy
```

A migration that must drop or re-type a column should be reviewed as SQL first —
`prisma migrate dev --create-only` writes the file without applying it.

## Seeding and the first account

```bash
npm run seed           # demo company, projects, categories, sample transactions
npm run create:owner   # interactive — creates a real OWNER, no demo data
```

`seed` is for a development database. For a real deployment use
`create:owner`, which prompts for an email and password and creates nothing
else. Seeded demo rows are prefixed `[DEMO]` so they are obvious and easy to
remove.

Seed passwords default to `ChangeMe123!Now` and the script warns when that
default was used. Override with `SEED_OWNER_PASSWORD` / `SEED_PARTNER_PASSWORD`.

## Currency handling

The company has one `baseCurrency`. A transaction in another currency stores
both its own currency and the `exchangeRateToBase` used at the time.

If no rate is available, the transaction is still recorded — the money is real —
but it is **excluded from converted totals** and surfaced as
`dataQuality.unconvertedRecords`, which both the web dashboard and the phone
display as a banner. Totals never mix currencies at an invented rate, and they
never silently omit a payment without saying so.
