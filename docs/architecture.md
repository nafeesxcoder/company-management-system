# Architecture

## The shape of it

Three applications, one API, one database.

```
┌──────────────────┐     ┌──────────────────┐
│  Next.js web     │     │  Flutter app     │
│  (browser)       │     │  (Android / iOS) │
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         │   HTTPS · JSON · JWT   │
         └───────────┬────────────┘
                     ▼
         ┌───────────────────────┐        ┌─────────────────────┐
         │  Express API /api/v1  │◀───────│  Stripe · Razorpay  │
         │  auth · business      │webhook │  Google Play        │
         │  logic · calculations │  POST  │  (verified sigs)    │
         └───────────┬───────────┘        └─────────────────────┘
                     │ Prisma
                     ▼
         ┌───────────────────────┐
         │   MySQL 8 (private)   │
         └───────────────────────┘
```

Neither client ever reaches MySQL. Neither client holds a payment provider
secret. Both clients render figures the API computed.

## The rule that drives most of the design

**The backend is the only thing that does arithmetic on money.**

A number shown on the phone and the same number shown in the browser come from
the same API response. The clients format; they do not compute. This is why:

- every monetary value crosses the wire as a **decimal string**, never a JSON
  number — `"35000.00"`, not `35000.00`
- Dart models type money as `String`; TypeScript types it as `string`
- the web dashboard and the Flutter overview both call `GET /dashboard` and
  render what comes back, including derived values like profit margin

A `double` cannot hold `1999.99` exactly. If either client did its own summing,
the two could disagree about the same company's profit — and the person looking
at the phone would have no way to tell which was right.

In the database, money is `DECIMAL(18,4)` — four decimal places, not two, so
that per-unit prices and provider fees that carry sub-paisa precision survive
storage instead of being rounded on the way in. Exchange rates use
`DECIMAL(18,8)`. In the API layer amounts are handled as Prisma `Decimal`. At
no point does an amount become a float.

## Request path

```
request
  → helmet (security headers)
  → cors (explicit origin allowlist)
  → rate limiter (tighter on /auth and /webhooks)
  → request-context (assigns requestId, starts the logger child)
  → body parser (raw body preserved for webhook signature checks)
  → authenticate        (verifies the access token → req.user)
  → companyScope        (resolves X-Company-Id → verifies membership)
  → validate            (Zod on params / query / body)
  → controller          (HTTP in, HTTP out — no business logic)
  → service             (business rules, money, transactions)
  → Prisma              (the only thing that speaks SQL)
  → error handler       (one JSON error shape for everything)
```

Two middlewares carry most of the security weight:

**`authenticate`** verifies the short-lived access token and populates
`req.user`. Nothing downstream re-checks the signature.

**`companyScope`** turns the `X-Company-Id` header into a verified membership.
It fails closed: a company the caller does not belong to is a 403, not an empty
result set. Every financial query filters on the company id it produced, which
is what makes cross-company data leakage a structural impossibility rather than
a thing each query has to remember.

## Module layout

Each business area is a folder under `src/modules/` holding its own routes,
controller, service, and validators:

```
auth · companies · projects · transactions · expenses
refunds · subscriptions · payment-providers · reports
profit-sharing · audit-logs
```

The split is consistent:

| Layer | Allowed to | Never does |
|---|---|---|
| `routes` | wire paths to middleware and controllers, carry the OpenAPI annotation | contain logic |
| `controllers` | read the request, call a service, shape the response | touch Prisma, calculate |
| `services` | business rules, money, multi-step transactions | know about `req` / `res` |
| `validators` | Zod schemas — the only definition of a valid request | — |

The practical benefit: the financial calculations in
`modules/reports/calculations.ts` are pure functions over plain inputs, so they
are unit-testable without an HTTP request or a database.

## Where the authoritative figures live

`modules/reports/calculations.ts` holds every definition in one place:

```
Net revenue  = gross revenue (received payments only) − settled refunds
Net profit   = net revenue − processing fees − eligible expenses
```

with the rules that make those lines unambiguous:

- **Received** means `SUCCEEDED`, `PARTIALLY_REFUNDED` or `REFUNDED`. `PENDING`
  and `FAILED` are not revenue; they are tracked separately as outstanding.
- **Processing fees** are deducted exactly once, net of fees the provider
  returned with a refund.
- **Eligible expenses** exclude canceled ones and any flagged
  `excludeFromProfit`. The report shows both the eligible figure and the total
  recorded, so the difference is visible rather than mysterious.
- **Calculated profit share is not money paid.** Partner payouts are separate
  records; the system reports the gap between them as outstanding.

The API returns a `definitions` object alongside the figures in
`GET /reports/profit-loss`, and both clients display it verbatim. If a
definition changes, the explanation in the UI changes with it instead of going
quietly stale.

## Authentication

Short-lived access token + rotating refresh token, with the storage mechanism
differing per client because the threat model does:

| | Access token | Refresh token |
|---|---|---|
| **Web** | memory only (never `localStorage`) | `HttpOnly` `SameSite` cookie — JavaScript cannot read it |
| **Flutter** | memory only | platform keystore via `flutter_secure_storage` |

Refresh tokens rotate on every use and are stored hashed. Presenting a token
that has already been rotated is treated as theft: the whole token family is
revoked and the session dies. Both clients therefore funnel concurrent 401s
into a **single in-flight refresh** — ten parallel requests firing ten
rotations would otherwise trip the reuse detector and log the user out.

Roles are `OWNER > ADMIN > PARTNER > VIEWER`, checked by rank rather than
equality, so adding a role later does not mean auditing every guard.

## Payment ingestion

Money arrives from outside the system, so the ingestion path assumes nothing:

1. **Verify the signature** against the provider's scheme, using the preserved
   raw body. A failed verification is a 400 and nothing is written.
2. **Record the event** — `(provider, externalEventId)` is unique, so a
   duplicate delivery fails the insert and is answered `200` without being
   processed twice. That constraint *is* the idempotency gate.
3. **Attribute it to a project** — by an owned subscription first, then by an
   admin-configured product mapping. There is deliberately **no fallback
   guess**: an unattributable payment is recorded and flagged for review, and
   admins are notified. Guessing would silently corrupt per-project reporting.
4. **Write the financial records** inside a database transaction.

A payment in a currency with no configured exchange rate is still recorded —
the money is real — but it is reported as `unconvertedRecords` rather than
folded into a total at an invented rate.

See `payment-integrations.md` for the per-provider detail.

## Technology choices, and why

| Choice | Reason |
|---|---|
| **Prisma Migrate**, never `db push` | Every schema change is a reviewable SQL file in version control. `db push` mutates a database with no history and can drop columns to force convergence. |
| **Zod at the boundary** | One schema validates and types the request. The validator is the contract, so handlers receive data that is already the right shape. |
| **Argon2id** for passwords | Memory-hard, so GPU cracking is expensive. bcrypt is the fallback option; Argon2 is what is wired up. |
| **Decimal, never float** | See above. This is the single most consequential decision in the codebase. |
| **UTC storage, timezone on display** | Every timestamp is stored UTC. Ranges like "this month" are computed in the company's timezone, so an Asia/Kolkata month boundary is not a UTC one. |
| **Hand-written Dart models** | No `build_runner` step before the app runs, and every money field's string handling is explicit at the point of parsing. |

## What is intentionally not here

- **No public sign-up.** This is a private two-partner system. Accounts exist
  only by invitation from an owner or admin; `/accept-invite` is the only route
  into the company.
- **No source code of the tracked projects.** Registering a project records
  its metadata and payment configuration. Each project keeps running on its own
  server, domain and repository.
- **No email delivery.** Invitations and password resets generate tokens and
  return links; wiring a transactional email provider is a deployment step, and
  the system says so plainly rather than pretending mail was sent.
