# Deployment

Three deployable units, deployed independently:

| Unit | Needs | Suitable hosts |
|---|---|---|
| **Backend API** | A **continuously running** Node process | Railway · Render · Fly.io · AWS App Runner · ECS/Fargate · a plain EC2 box with systemd |
| **Web frontend** | Static + SSR Node | Vercel · Netlify · AWS Amplify · the same box |
| **MySQL 8** | Managed, private | Amazon RDS · Aiven · PlanetScale · DigitalOcean Managed MySQL |
| **Flutter app** | Build machine only | Play Console · App Store Connect |

> **On AWS Amplify:** Amplify Hosting is built for static sites and SSR
> frontends. It is **not** a home for this Express API — the API is a long-lived
> process that holds a database pool, runs a background retry worker, and must
> receive provider webhooks at a stable URL. Host the Next.js frontend on
> Amplify if you like, and put the API on **App Runner, ECS/Fargate, or EC2**,
> with **RDS for MySQL**. That keeps the whole thing inside AWS without
> pretending a request-scoped runtime can hold a connection pool.

---

## 1. Database first

Create the database and a user that only the backend will use.

```sql
CREATE DATABASE company_management
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'cms_app'@'%' IDENTIFIED BY '<a long random password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON company_management.* TO 'cms_app'@'%';
-- Schema changes run as a separate migration user, not the app user:
CREATE USER 'cms_migrate'@'%' IDENTIFIED BY '<another long random password>';
GRANT ALL PRIVILEGES ON company_management.* TO 'cms_migrate'@'%';
FLUSH PRIVILEGES;
```

Two users is deliberate: the running app has no `DROP`, so an application-level
compromise cannot destroy the schema.

**Network.** MySQL must not be publicly reachable. On RDS: no public
accessibility, a security group that admits only the API's security group on
3306. Elsewhere: bind to the private network, firewall 3306. Require TLS
(`?ssl=true` on the connection string) for any hop outside the VPC.

**MariaDB note.** The development container used for this build ships MariaDB,
which Prisma's `mysql` provider talks to happily. Target **MySQL 8** in
production — it is what the schema and the `DECIMAL` behaviour were written
against.

---

## 2. Backend API

### Configure

```bash
cd backend
cp .env.example .env
```

Generate real secrets — never reuse the placeholders:

```bash
openssl rand -base64 48     # ACCESS_TOKEN_SECRET
openssl rand -base64 48     # REFRESH_TOKEN_SECRET  (must differ)
openssl rand -hex 32        # APP_ENCRYPTION_KEY    (exactly 64 hex chars)
```

The process validates its configuration at boot and **refuses to start** on a
missing or too-weak value, rather than running insecurely.

Production values that matter:

```bash
NODE_ENV=production
DATABASE_URL="mysql://cms_app:...@db.internal:3306/company_management?ssl=true"
WEB_ORIGIN=https://app.yourdomain.com      # comma-separated allowlist, HTTPS only
TRUST_PROXY=true                           # behind a load balancer, so client IPs are real
COOKIE_DOMAIN=.yourdomain.com              # if the API and web app share a parent domain
SWAGGER_ENABLED=false                      # do not publish the API surface
LOG_PRETTY=false                           # JSON lines for the log collector
```

`APP_ENCRYPTION_KEY` encrypts stored payment provider secrets. **Rotating it
makes existing secrets unreadable** — you must re-enter each one afterwards.
Keep it in a secrets manager, not in the repository.

### Migrate, then start

```bash
npm ci
npx prisma generate
npm run build

DATABASE_URL="mysql://cms_migrate:...@db:3306/company_management" \
  npm run prisma:deploy      # applies pending migrations; creates nothing new

npm start                    # node dist/src/server.js
```

Never run `prisma migrate dev` or `prisma db push` against production. `deploy`
applies committed migrations and nothing else.

**Always back up before migrating:**

```bash
mysqldump --single-transaction --routines --triggers \
  -u cms_migrate -p company_management > backup-$(date +%F-%H%M).sql
```

### Create the first owner

```bash
npm run create:owner
```

Interactive: prompts for name, email and password, creates one `OWNER` and the
company, and nothing else. **Do not run `npm run seed` in production** — it
creates `[DEMO]` data.

That owner then invites the second partner from the web app (Team → Invite a
partner), which produces a single-use link valid for 72 hours.

### Process management

The API must stay running. Behind systemd:

```ini
# /etc/systemd/system/cms-api.service
[Unit]
Description=CMS API
After=network.target

[Service]
Type=simple
User=cms
WorkingDirectory=/srv/cms/backend
EnvironmentFile=/srv/cms/backend/.env
ExecStart=/usr/bin/node dist/src/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

`SIGTERM` triggers a graceful shutdown: it stops the retry worker, drains
in-flight requests, and disconnects Prisma, with a 15-second force-exit guard.
Give your platform at least 20 seconds to stop the container.

### Running more than one instance

Two things are per-process today and need attention before you scale out:

1. **Rate limiting** is in-memory, so each instance counts separately. Move it
   to a shared Redis store, or the effective limit is `limit × instances`.
2. **The webhook retry worker** runs on every instance. It claims rows before
   working, so duplicate processing is prevented — but running it on one
   instance (or as a scheduled job) is tidier.

### Health checks

```
GET /health          liveness — no auth, no database hit
GET /api/v1/ping     readiness
```

Point the load balancer at `/health`.

---

## 3. Web frontend

```bash
cd frontend
cp .env.example .env.local
```

`NEXT_PUBLIC_*` variables are **compiled into the browser bundle**. Only the API
URL belongs here. There is no secret a visitor cannot read:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com/api/v1
```

```bash
npm ci
npm run build
npm start          # or deploy to Vercel / Amplify
```

Set `NEXT_PUBLIC_API_BASE_URL` in the host's environment settings, then
**rebuild** — it is baked in at build time, not read at runtime.

### CORS and cookies

The refresh token is an `HttpOnly` cookie, so the API and the web app must agree:

- the API's `WEB_ORIGIN` must list the web app's exact origin, HTTPS included
- same parent domain (`app.yourdomain.com` + `api.yourdomain.com`) → set
  `COOKIE_DOMAIN=.yourdomain.com`
- different registrable domains → the cookie needs `SameSite=None; Secure`,
  which browsers accept only over HTTPS

A login that succeeds but is forgotten on reload is almost always this.

---

## 4. Flutter app

Platform folders are generated, not committed — see `app/README.md`:

```bash
cd app
flutter create --platforms=android,ios --org com.timexsolution --project-name company_management .
flutter pub get
flutter test
```

### Android release

Create a keystore (once) and keep it off the repository:

```bash
keytool -genkey -v -keystore ~/cms-upload.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias upload
```

`android/key.properties` (gitignored):

```properties
storePassword=...
keyPassword=...
keyAlias=upload
storeFile=/absolute/path/to/cms-upload.jks
```

Wire it into `android/app/build.gradle` per the Flutter signing docs, then:

```bash
flutter build appbundle --release \
  --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1 \
  --dart-define=IS_PRODUCTION=true
```

`IS_PRODUCTION=true` with a non-HTTPS API URL trips `isInsecureProductionConfig`
and fails loudly, rather than shipping a build that sends partner financials in
the clear.

Losing the upload keystore means you cannot update the app. Back it up somewhere
you will still have in five years.

### iOS release

```bash
flutter build ipa --release \
  --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1 \
  --dart-define=IS_PRODUCTION=true
```

Needs macOS, Xcode, and an Apple Developer account; signing is configured in
Xcode.

---

## 5. Webhooks

Register each provider's URL only after the API has a stable HTTPS address:

```
https://api.yourdomain.com/api/v1/webhooks/stripe/<accountId>
https://api.yourdomain.com/api/v1/webhooks/razorpay/<accountId>
https://api.yourdomain.com/api/v1/webhooks/generic/<accountId>
```

`accountId` comes from the provider account you created under Integrations.
Webhook routes are excluded from the authenticated middleware and verify a
signature instead — do not put them behind IP allowlisting that would block the
provider. Full detail in `payment-integrations.md`.

---

## 6. Email

Not configured. Invitations and password resets **generate tokens and return
links** instead of sending mail; the API says so in `deliveryNote` rather than
pretending a message was sent.

To wire it up, send the token from `authService.createPasswordResetToken` and
the invite flow through your provider (SES, Resend, Postmark). Until then, the
owner copies the invite link out of the Team screen and sends it over a channel
they trust. In production the reset token is **not** returned in the response —
that only happens outside production — so a password reset currently needs an
admin to pass the link on.

---

## 7. Backups and restore

```bash
# Nightly, kept 30 days
mysqldump --single-transaction --routines --triggers --events \
  -u cms_migrate -p company_management | gzip > cms-$(date +%F).sql.gz
```

`--single-transaction` snapshots InnoDB without locking writes.

**Restore:**

```bash
gunzip < cms-2026-10-14.sql.gz | mysql -u cms_migrate -p company_management
```

On RDS, enable automated backups and point-in-time recovery, and still take
periodic logical dumps — a dump can be restored somewhere else, a snapshot
mostly cannot.

**Test the restore.** A backup nobody has restored is a hypothesis. Restore into
a scratch database quarterly and sign in against it.

Keep `APP_ENCRYPTION_KEY` backed up separately from the database. The database
without the key means every stored provider secret is unreadable.

---

## 8. Logs and monitoring

Pino writes structured JSON (`LOG_PRETTY=false` in production). Every line
carries the `requestId` that errors return to the client, so a user-reported
failure maps to exact log lines.

Worth alerting on:

| Signal | Why |
|---|---|
| `WebhookEvent` rows at `NEEDS_REVIEW` | Revenue arrived that could not be attributed, or exhausted its retries |
| Repeated `WEBHOOK_SIGNATURE_INVALID` | Someone is probing the webhook URL |
| Transactions at `reviewStatus: NEEDS_REVIEW` | Per-project figures are drifting until resolved |
| `dataQuality.unconvertedRecords > 0` | Foreign-currency payments are missing an exchange rate |
| 5xx rate, p95 latency, DB pool saturation | The usual |

`AuditLog` records who changed what, with IP and request id. It is the record
you will want after any argument about a figure.

---

## Pre-launch checklist

- [ ] `NODE_ENV=production`, `SWAGGER_ENABLED=false`, `LOG_PRETTY=false`
- [ ] All three secrets freshly generated; access ≠ refresh
- [ ] `APP_ENCRYPTION_KEY` stored in a secrets manager **and** backed up separately
- [ ] MySQL not publicly reachable; TLS on; app user has no `DROP`
- [ ] `WEB_ORIGIN` lists only real HTTPS origins
- [ ] `TRUST_PROXY=true` if behind a load balancer
- [ ] Migrations applied with `prisma:deploy`; backup taken first
- [ ] First owner created with `create:owner` — **not** `seed`
- [ ] Seeded/demo passwords changed; no `[DEMO]` rows in production
- [ ] HTTPS everywhere, with HSTS
- [ ] Backups scheduled **and a restore tested**
- [ ] Webhooks registered; one signed test event processed end to end per provider
- [ ] Release Flutter build points at the HTTPS API and `IS_PRODUCTION=true`
- [ ] Health check wired to `/health`
