# Company Management System

Income, projects, expenses and partner profit across every app and client
project a two-partner company runs — one set of books instead of a Stripe
dashboard, a Razorpay dashboard, a Play console and a spreadsheet.

Three applications, one API, one database:

```
company-management-system/
├── backend/     Express + TypeScript + Prisma + MySQL 8   — the only thing that touches the DB
├── frontend/    Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
├── app/         Flutter + Riverpod + Dio + GoRouter
└── docs/        architecture · database · api · payment integrations · deployment
```

Both clients call the same `/api/v1`. Neither holds a database credential or a
payment provider secret.

---

## The one rule

**The backend does all the arithmetic on money.** Clients format; they never
compute.

Every amount crosses the wire as a decimal **string** (`"35000.00"`, not
`35000.00`), is stored as `DECIMAL(18,4)`, and is rendered as a string. A
`double` cannot hold `1999.99` exactly — if the phone and the browser each did
their own summing, they could disagree about the same company's profit, and
whoever was looking at the phone would have no way to know.

So `GET /dashboard` returns the figures, and both clients display what they are
given, down to the profit margin.

---

## Running it locally

**Prerequisites:** Node 20+, MySQL 8, and (for the mobile app) the Flutter SDK.

### 1. Database

```sql
CREATE DATABASE company_management
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'cms'@'localhost' IDENTIFIED BY 'cmspass';
GRANT ALL PRIVILEGES ON company_management.* TO 'cms'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Backend → http://localhost:4000

```bash
cd backend
cp .env.example .env          # then set DATABASE_URL and generate the secrets
npm install
npm run prisma:migrate        # applies migrations
npm run seed                  # demo company + sample data (development only)
npm run dev
```

Secrets, generated separately:

```bash
openssl rand -base64 48   # ACCESS_TOKEN_SECRET
openssl rand -base64 48   # REFRESH_TOKEN_SECRET (must differ)
openssl rand -hex 32      # APP_ENCRYPTION_KEY (exactly 64 hex characters)
```

The server validates its config at boot and refuses to start on a weak or
missing value. API docs: **http://localhost:4000/api/v1/docs**

For a real deployment use `npm run create:owner` instead of `npm run seed` — it
creates one owner account and no demo data.

### 3. Web app → http://localhost:3000

```bash
cd frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
npm install
npm run dev
```

### 4. Mobile app

Platform folders are generated rather than committed:

```bash
cd app
flutter create --platforms=android,ios --org com.timexsolution --project-name company_management .
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1   # Android emulator
```

See `app/README.md` for the three manifest changes a release build needs.

---

## What it does

**Projects.** Every app, SaaS product, website or client project is registered
with its type, revenue model, currency and payment configuration. Registering a
project does **not** import its code — each one keeps running on its own server,
domain and repository.

**Income.** Verified webhooks from Stripe, Razorpay and Google Play; a signed
generic adapter so your own app backends can report their payments; and manual
entry for anything with no gateway. Signature-verified, idempotent at the
database level, and attributed to a project by subscription or configured
product mapping — never by a guess. Anything unattributable is flagged for
review rather than assigned to an arbitrary project.

**Expenses.** Hosting, domains, ad spend, developer payments, gateway charges —
per project or company-wide, with categories, receipts and payment status.

**The figures.**

```
Net revenue = gross revenue (received payments only) − settled refunds
Net profit  = net revenue − processing fees − eligible expenses
```

Pending and failed payments are not revenue; they are tracked separately as
outstanding. Processing fees are deducted exactly once. The API publishes its
own definitions alongside the numbers, and both clients show them.

**Partner profit sharing.** Configurable percentages (not a hardcoded 50/50),
validated to total 100. Calculated share and money actually paid are separate
records, and the system reports the gap — a calculated share is not a payment.

**Audit log.** Who changed what, with IP and request id.

---

## Security

| | |
|---|---|
| Passwords | Argon2id |
| Access token | 15 minutes, memory only on both clients — never `localStorage` |
| Refresh token | Rotating; `HttpOnly` cookie on web, platform keystore on mobile; stored hashed; reuse revokes the whole family |
| Roles | `OWNER > ADMIN > PARTNER > VIEWER`, checked by rank |
| Company isolation | Middleware resolves and verifies membership; a foreign company is a 403, not an empty list |
| Provider secrets | AES-256-GCM at rest, never returned by any endpoint |
| Webhooks | Constant-time signature comparison on raw bytes, with replay windows where the provider supplies a timestamp |
| Also | Helmet, CORS allowlist, rate limiting (tighter on `/auth`), Zod validation at every boundary |

There is **no public sign-up**. Accounts exist only by invitation from an owner
or admin.

---

## Tests

```bash
cd backend  && npm test      # 193 tests — unit + integration against a real MySQL
cd frontend && npm run build # typecheck + production build
cd app      && flutter test  # money formatting, API contract, widgets
```

Backend tests run against a separate `company_management_test` database,
configured in `.env.test`, which the suite loads with override so it can never
touch development or production data.

---

## Documentation

| | |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | How the three apps fit together, the request path, where the authoritative figures live |
| [`docs/database.md`](docs/database.md) | Models, constraints, indexes, the migration strategy, how to change the schema without losing data |
| [`docs/api-documentation.md`](docs/api-documentation.md) | Conventions, error codes, auth flow, all 65 endpoints |
| [`docs/payment-integrations.md`](docs/payment-integrations.md) | Per-provider setup and the end-to-end check that tells you it actually works |
| [`docs/deployment.md`](docs/deployment.md) | Hosting each piece, backups, monitoring, pre-launch checklist |

---

## Known limitations

Stated plainly, because a system that overstates what it does is worse than one
that does less:

- **Email is not configured.** Invitations and password resets generate links
  rather than sending mail. In production the reset token is not returned in the
  API response, so a reset currently needs an admin to pass the link on.
- **Google Play income is recorded, not converted to revenue.** A Play
  notification does not carry a trustworthy amount; turning it into revenue
  needs a Play Developer API lookup with a service account, which is not
  implemented. Treat Play income as manual entry until it is.
- **Rate limiting is per-process.** Behind more than one instance the effective
  limit multiplies; move it to Redis before scaling out.
- **Exchange rates are not fetched automatically.** A payment in a currency with
  no configured rate is recorded but excluded from converted totals and reported
  as `unconvertedRecords`, rather than converted at an invented rate.
