# API

Base path `/api/v1`. Interactive OpenAPI docs run with the server at
**`http://localhost:4000/api/v1/docs`** (disable in production with
`SWAGGER_ENABLED=false`). This file is the orientation; Swagger is the
per-endpoint reference, generated from annotations beside the routes so it
cannot drift from the code.

## Conventions

### Every response is enveloped

```jsonc
// Success
{ "data": { ... } }

// Success, paginated
{ "data": [ ... ],
  "meta": { "page": 1, "pageSize": 25, "totalItems": 143,
            "totalPages": 6, "hasNextPage": true, "hasPreviousPage": false } }

// Failure — always this shape, for every error
{ "error": { "code": "VALIDATION_ERROR",
             "message": "Request validation failed",
             "details": [{ "field": "amount", "message": "Required" }],
             "requestId": "a6d15fd4-e2db-44c4-94de-decdf0ad7bab" } }
```

`requestId` appears on every error and in every log line for that request, so a
user-reported failure can be found in the logs directly.

### Money is a string

```jsonc
{ "grossAmount": "35469.12", "currency": "INR" }   // ✅ exact
{ "grossAmount": 35469.12 }                        // ❌ never sent
```

Send amounts as strings too. The server parses them as `Decimal`.

### Headers

| Header | When |
|---|---|
| `Authorization: Bearer <access token>` | Every authenticated request |
| `X-Company-Id: <uuid>` | Every company-scoped request — i.e. everything except `/auth/*` |

A missing or non-member `X-Company-Id` is a `403`, never a silently empty list.

### Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod rejected the request; `details` carries field errors |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password — deliberately does not say which |
| `UNAUTHENTICATED` | 401 | Missing or malformed bearer token |
| `TOKEN_EXPIRED` / `TOKEN_INVALID` | 401 | Access token expired / refresh token rejected or reused |
| `FORBIDDEN` | 403 | Authenticated, but the role or company membership does not allow it |
| `NOT_FOUND` | 404 | No such record **in this company** |
| `CONFLICT` | 409 | Uniqueness violation, e.g. a duplicate project code |
| `UNPROCESSABLE` | 422 | Well-formed but not allowed — an expired invite, a refund above the refundable balance |
| `CURRENCY_MISMATCH` | 422 | An amount in a currency the operation cannot combine |
| `PAYLOAD_TOO_LARGE` | 413 | Body over the limit |
| `RATE_LIMITED` | 429 | Too many requests; `/auth` has a tighter budget |
| `WEBHOOK_SIGNATURE_INVALID` | 400 | Provider signature did not verify — nothing was written |
| `INTERNAL_ERROR` | 500 | Unexpected. The message is generic; details are in the logs under `requestId` |

### Pagination, sorting, filtering

`?page=1&pageSize=25&sortBy=occurredAt&sortOrder=desc&search=...`

`pageSize` defaults to 25 and is capped at 200.

### Date ranges

Reporting endpoints take `?preset=` with one of:

```
today · yesterday · last7days · last30days · thisMonth · lastMonth
thisQuarter · thisYear · lastYear · allTime · custom
```

`custom` requires `from` and `to` (ISO date or datetime). Ranges are resolved in
the **company's timezone**, then converted to UTC for the query. The response
echoes the resolved range and its label.

## Authentication flow

```
POST /auth/login          { email, password, client: "web" | "mobile" }
   → { user, memberships, accessToken, accessTokenExpiresIn, tokenType }
     web:    refresh token set as an HttpOnly cookie
     mobile: refreshToken returned in the body, for the keystore

POST /auth/refresh        { client }  (+ cookie, or { refreshToken } on mobile)
   → { accessToken }   — the refresh token ROTATES on every call

POST /auth/logout         revokes the current refresh token
```

Access tokens are short-lived (`ACCESS_TOKEN_TTL_MINUTES`, default 15).
Refresh tokens rotate on use and are stored hashed; presenting an already-used
one revokes the entire family, on the assumption it was stolen. **Both clients
must funnel concurrent 401s into a single refresh** — parallel rotations look
exactly like theft.

### Getting an account

There is no public sign-up.

```
POST /members/invite        (admin) → { inviteToken, inviteUrl, deliveryNote }
POST /auth/accept-invite    { token, fullName, password } → a full session
```

Email delivery is not configured, so the invite link is returned to the admin to
pass on over a channel they trust. Invites expire after 72 hours and are
single-use.

Password reset works the same way: `POST /auth/forgot-password` answers
identically whether or not the address exists (so it cannot be used to discover
accounts), and outside production it returns `devResetToken` so the flow is
testable. `POST /auth/reset-password` consumes the token once and revokes every
session for that user.

## Endpoints

65 endpoints across 15 route groups. Everything below `/auth` requires both
headers.

### Auth — `/auth`
```
POST   /auth/login                 POST   /auth/forgot-password
POST   /auth/refresh               POST   /auth/reset-password
POST   /auth/logout                POST   /auth/accept-invite
GET    /auth/me                    POST   /auth/change-password
PATCH  /auth/me
```

### Company and team
```
GET    /companies/current          GET    /members/
PATCH  /companies/current          POST   /members/invite
GET    /audit-logs/                PATCH  /members/:id        (role, status)
                                   DELETE /members/:id
```

### Projects — `/projects`
```
GET    /projects/                  POST   /projects/:id/archive
GET    /projects/:id               POST   /projects/:id/restore
POST   /projects/                  DELETE /projects/:id
PATCH  /projects/:id
```
`GET /projects/:id` accepts a date range and returns that project's financials
alongside its metadata.

### Income — `/transactions`, `/refunds`
```
GET    /transactions/              POST   /transactions/:id/assign-project
GET    /transactions/:id           POST   /transactions/:id/refunds
POST   /transactions/              GET    /refunds/
PATCH  /transactions/:id           DELETE /refunds/:refundId
DELETE /transactions/:id
```
`POST /transactions` is manual income entry, for projects with no gateway.
`assign-project` resolves a payment that arrived unattributed.

### Expenses — `/expenses`, `/expense-categories`
```
GET    /expenses/                  GET    /expense-categories/
GET    /expenses/:id               POST   /expense-categories/
POST   /expenses/                  PATCH  /expense-categories/:id
PATCH  /expenses/:id               DELETE /expense-categories/:id
DELETE /expenses/:id
```

### Reporting — `/dashboard`, `/reports`
```
GET    /dashboard/                 GET    /reports/export/transactions  (CSV)
GET    /reports/profit-loss        GET    /reports/export/expenses      (CSV)
```
**These are the authoritative figures.** The web dashboard and the Flutter app
both render these responses as-is; neither recomputes a total. `profit-loss`
returns a `definitions` object explaining each line, which both clients display
verbatim.

### Partner profit sharing — `/profit-sharing`, `/payouts`
```
GET    /profit-sharing/            GET    /payouts/
GET    /profit-sharing/config      POST   /payouts/
PUT    /profit-sharing/config      PATCH  /payouts/:id
GET    /profit-sharing/history     DELETE /payouts/:id
```
`PUT /config` rejects percentages that do not total 100. Calculated share and
actual payout are separate: the statement reports both and the gap between them.

### Payment providers — `/payment-providers`
```
GET    /payment-providers/                      GET    /payment-providers/:id/mappings
POST   /payment-providers/                      POST   /payment-providers/:id/mappings
PATCH  /payment-providers/:id                   DELETE /payment-providers/:id/mappings/:mappingId
DELETE /payment-providers/:id                   GET    /payment-providers/webhook-events
```
Secrets are write-only: accepted on create/update, encrypted at rest, and never
returned by any endpoint.

### Webhooks — `/webhooks` (unauthenticated, signature-verified)
```
POST   /webhooks/stripe/:accountId        POST   /webhooks/google-play/:accountId
POST   /webhooks/razorpay/:accountId      POST   /webhooks/generic/:accountId
```
No bearer token — the signature is the authentication. See
`payment-integrations.md`.

### Health
```
GET    /health        (outside /api/v1 — liveness, no auth)
GET    /api/v1/ping
```

## Trying it

```bash
# 1. Sign in
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"...","client":"web"}'

# 2. Use the accessToken and a companyId from the response
curl -s 'http://localhost:4000/api/v1/dashboard?preset=thisYear' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Company-Id: $COMPANY_ID"

# 3. Record manual income
curl -s -X POST http://localhost:4000/api/v1/transactions \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Company-Id: $COMPANY_ID" \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"<uuid>","grossAmount":"25000.00","currency":"INR",
       "occurredAt":"2026-10-14T10:00:00Z","type":"ONE_TIME_PAYMENT",
       "description":"Milestone 2"}'
```
