# Payment integrations

> **Nothing here is "working" until you have configured real credentials,
> registered the webhook URL with the provider, and seen a test payment arrive.**
> The code paths are implemented and covered by tests against signed fixtures,
> but an integration is only live once the end-to-end check at the bottom of
> each section passes with your own keys.

## How money gets in

Four ways, in descending order of trust:

1. **Provider webhook** — Stripe, Razorpay, Google Play. Signed, verified,
   idempotent.
2. **Generic HMAC adapter** — for a custom gateway, or for one of your own
   existing app backends reporting its verified payments here.
3. **Manual entry** — `POST /transactions`, for projects with no gateway at all
   (bank transfer, cash, client cheque). Recorded with `source: MANUAL` and the
   user who entered it.
4. **Nothing else.** There is no path that creates revenue without either a
   verified signature or an authenticated user behind it.

## The shape of every webhook request

```
POST /api/v1/webhooks/<provider>/<accountId>
```

`accountId` is the `PaymentProviderAccount` id from this system — so each
connected account has its own URL and its own secret. Rotating one account's
secret cannot break another's.

These routes are **unauthenticated by design**: providers cannot hold a bearer
token. The signature *is* the authentication. Consequently:

- the **raw request bytes** are preserved before JSON parsing, because
  re-serialising changes whitespace and key order and would invalidate every
  signature;
- comparisons are **constant-time** (`timingSafeEqual`), never `===`, which
  leaks the match position through timing;
- a failed verification returns `400`, writes **nothing** financial, and records
  the rejection as a `WebhookEvent` so repeated forgery attempts are visible;
- the response is `200` for processed, duplicate, and deliberately-ignored
  events alike — a provider should not retry something that was received.

### Processing order

```
raw body ─▶ verify signature ─▶ record WebhookEvent ─▶ normalize ─▶ attribute
                   │                   │                               │
                 400 ✗          duplicate → 200,              no match → flag
                                  no reprocessing             for review + notify
                                                                        │
                                                        write records in a DB transaction
```

**Idempotency is enforced twice.** First at `WebhookEvent` on
`(provider, externalEventId)` — the unique insert failing *is* the gate, not an
application check that could race. Second at `Transaction` on
`(provider, externalTransactionId)`, because the same payment can legitimately
arrive under two different event ids (Stripe sends both
`payment_intent.succeeded` and `charge.succeeded`).

### Project attribution

An amount with no project is useless for reporting, so attribution is explicit:

1. **An existing subscription** owned by this system — strongest signal.
2. **A `ProviderProductMapping`** an admin configured, mapping the provider's
   product / price / plan id to a project.
3. **Nothing else.** There is deliberately no fallback guess.

An unattributable payment is still recorded — the money is real — with
`reviewStatus: NEEDS_REVIEW` and a notification to every admin. Resolve it with
`POST /transactions/:id/assign-project`, or in the web app under Income →
"Needs a project". Guessing would silently skew per-project profit for months.

---

## Stripe

**Webhook URL** `https://your-api/api/v1/webhooks/stripe/<accountId>`

**Verification** — `Stripe-Signature: t=<unix>,v1=<hex>`. HMAC-SHA256 over
`${t}.${rawBody}` with the endpoint secret (`whsec_…`). The timestamp must be
within `WEBHOOK_TOLERANCE_SECONDS` (default 300), which is what stops a captured
request being replayed. Multiple `v1` signatures are accepted, so a secret
rotation does not drop events mid-flight.

**Events handled**

| Event | Effect |
|---|---|
| `charge.succeeded`, `payment_intent.succeeded` | Revenue |
| `invoice.payment_succeeded` | Revenue (subscription renewal) |
| `charge.refunded`, `refund.created` | Refund, full or partial |
| `charge.failed`, `payment_intent.payment_failed` | Recorded as failed — **not** revenue |
| `customer.subscription.*` | Subscription created / updated / canceled |

Amounts arrive in **minor units** (paise, cents) and are converted using the
currency's exponent — zero-decimal currencies like JPY are handled, not assumed.
`balance_transaction` fee data populates `feeAmount` so processing cost is
deducted exactly once.

**Setup**

1. Dashboard → Developers → Webhooks → *Add endpoint*, with the URL above.
2. Select the events in the table.
3. Copy the signing secret into the provider account in this system
   (Integrations → Add provider). It is encrypted at rest and never returned.
4. For products/plans that map to a project, add a mapping under
   `POST /payment-providers/:id/mappings` with Stripe's `price_…` or
   `prod_…` id.

**Verify it works**

```bash
stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe/<accountId>
stripe trigger payment_intent.succeeded
```
Then confirm: a row in Income, a `WebhookEvent` with status `PROCESSED`, and the
dashboard total moved by the expected amount. Re-run `stripe trigger` with the
same event and confirm **no second transaction** appears.

---

## Razorpay

**Webhook URL** `https://your-api/api/v1/webhooks/razorpay/<accountId>`

**Verification** — `X-Razorpay-Signature`, HMAC-SHA256 of the raw body with the
webhook secret. Razorpay sends **no timestamp**, so there is no replay window to
check; protection rests entirely on event-id idempotency. That is the reason
`(provider, externalEventId)` is a database constraint rather than a code check.

**Events handled**

| Event | Effect |
|---|---|
| `payment.captured` | Revenue |
| `payment.failed` | Recorded as failed |
| `refund.created`, `refund.processed` | Refund against the original payment |
| `subscription.*` | Subscription lifecycle |

Amounts are in paise and converted on the way in. INR is the default company
currency, so these usually need no FX conversion at all.

**Setup**

1. Dashboard → Settings → Webhooks → *Add New Webhook*.
2. Set the URL, choose the events above, set a secret.
3. Store the secret in the provider account here.

**Verify it works** — use Razorpay test mode, make a test payment, confirm the
transaction appears and is attributed to the right project. Then use the
dashboard's *Resend* on the same event and confirm no duplicate.

---

## Google Play Billing

> **This one needs more than a URL, and it is the least complete of the three.**

Play does not post to an arbitrary endpoint. It publishes **Real-time developer
notifications** to a Cloud Pub/Sub topic; a push subscription then delivers them
here, base64-encoded inside a Pub/Sub envelope (which this system decodes).

**Webhook URL** `https://your-api/api/v1/webhooks/google-play/<accountId>`

**Verification** — a shared `verificationToken` query parameter, compared in
constant time. This is weaker than an HMAC signature, which is why:

**A Play notification is recorded, but is NOT converted into revenue on its
own.** The notification says *something happened to a purchase token*; it does
not carry a trustworthy amount. Turning it into revenue requires calling the
Play Developer API (`purchases.subscriptionsv2.get` /
`purchases.products.get`) with a service account to read the real order and
price. **That call is not implemented.** The event is stored with status
`RECEIVED` for review, and the code says so rather than inventing an amount.

**To finish this integration**

1. Play Console → Monetisation setup → set the Pub/Sub topic.
2. Create a push subscription to the URL above, including the verification
   token.
3. Create a service account with *View financial data*, download its JSON key,
   and store it on the **backend** (never in the app).
4. Implement the Developer API lookup in
   `modules/payment-providers/ingestion.service.ts`, mapping the returned
   `productId` to a project via a `ProviderProductMapping`.

Until step 4 exists, treat Play income as manual entry.

---

## Generic adapter — your own app backends

This is the route for the apps you already run. Your backend already knows a
payment succeeded; it reports it here over a signed request. No gateway
credentials are shared with this system.

**URL** `https://your-api/api/v1/webhooks/generic/<accountId>`

**Headers**

```
X-Signature:  hex HMAC-SHA256 of `${timestamp}.${rawBody}` using the account secret
X-Timestamp:  unix seconds (must be within WEBHOOK_TOLERANCE_SECONDS)
Content-Type: application/json
```

**Body** — amounts are **decimal strings in major units**, because your backend
already knows the real figure and should not be re-deriving it from paise:

```jsonc
{
  "eventId": "evt_2026_10_14_0001",       // your id; the idempotency key
  "eventType": "payment.succeeded",        // or payment.failed / payment.refunded
  "transactionId": "order_8812",           // your payment id
  "productId": "pro_monthly",              // matched to a project via a mapping
  "amount": "499.00",
  "currency": "INR",
  "feeAmount": "11.78",                    // optional
  "customerReference": "user_4471",        // optional
  "occurredAt": "2026-10-14T09:31:00Z",    // optional, defaults to now
  "subscriptionId": "sub_221"              // optional
}
```

For a refund: `eventType: "payment.refunded"` with `refundId`, `refundAmount`,
and the original `transactionId`.

**Sending one (Node)**

```js
const crypto = require('node:crypto');

async function report(event, secret, url) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${body}`).digest('hex');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': signature,
      'X-Timestamp': String(timestamp),
    },
    body,                      // the exact string that was signed
  });
  if (!res.ok) throw new Error(`report failed: ${res.status}`);
}
```

Sign the **exact bytes you send**. Building the signature from a re-serialised
object is the single most common cause of a verification failure here.

**Retries** — if your call fails, retry with the **same `eventId`**. The
duplicate is absorbed and answered `200`. Do not generate a new id on retry;
that is how double-counted revenue happens.

---

## Operating it

**Failed deliveries and the retry worker.** A webhook whose signature verified
but whose *processing* failed (database blip, deadlock, transient bug) has
already been answered `200` — the provider will never resend it. Left alone,
that payment exists at Stripe and not here.

`modules/payment-providers/retry-worker.ts` sweeps every 5 minutes and
reprocesses those events:

- backoff doubles from 5 minutes, capped at 6 hours
- after **6 attempts** the event stops retrying and becomes `NEEDS_REVIEW`,
  because retrying forever hides a permanent fault behind a quiet loop
- rows are **claimed** before work starts, so two app instances sweeping at once
  cannot process the same event twice
- events whose **signature failed** are never retried — a forged request must
  not be resurrected by the retry path
- retrying is safe because ingestion is idempotent at the database level, so a
  retry after a partial write cannot double-count revenue

Inspect the queue at `GET /payment-providers/webhook-events` or in the web app
under Integrations. Anything sitting at `NEEDS_REVIEW` wants a human.

**Reconciliation.** Compare the provider's own payout report against
`GET /reports/export/transactions` for the same range. The external transaction
id is in both, so a mismatch points to a specific payment.

**Fees.** Taken from the provider's own fee field where supplied. Where it is
not, `feeAmount` stays `0` rather than being estimated — an estimated fee would
quietly misstate profit. Record it manually if you need it exact.

**Secrets.** Encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY` and never
returned by any endpoint. Rotating `APP_ENCRYPTION_KEY` requires re-entering
every provider secret — there is no silent re-encryption on key change.

**Currencies.** A payment in a currency with no configured `ExchangeRate` is
recorded but excluded from converted totals, and reported as
`dataQuality.unconvertedRecords` in the dashboard rather than folded in at a
made-up rate.
