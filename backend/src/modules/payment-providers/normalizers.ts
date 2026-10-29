import type { NormalizedPaymentEvent } from './ingestion.service.js';

/**
 * Provider payload → one internal event shape.
 *
 * Each provider has its own vocabulary and its own minor-unit convention.
 * Getting the unit conversion wrong is the classic way to be out by a factor of
 * 100, so each normaliser states its convention explicitly.
 */

/** Converts an integer minor-unit amount (cents/paise) to a decimal string. */
function fromMinorUnits(amount: number | string | undefined, exponent = 2): string | undefined {
  if (amount === undefined || amount === null) return undefined;
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return undefined;

  const negative = value < 0;
  const digits = Math.abs(Math.trunc(value)).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Zero-decimal currencies: the amount is already whole units. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'BIF', 'DJF', 'GNF', 'KMF', 'MGA']);

function exponentFor(currency: string | undefined): number {
  return currency && ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/**
 * Stripe. Amounts are in the smallest currency unit.
 * Fee is on the balance transaction, which is only present when expanded —
 * absent means zero here, and reconciliation can fill it in later.
 */
export function normalizeStripeEvent(payload: Record<string, any>): NormalizedPaymentEvent {
  const eventType: string = payload?.type ?? 'unknown';
  const object = payload?.data?.object ?? {};
  const currency: string | undefined = object.currency?.toUpperCase();
  const exponent = exponentFor(currency);

  const base = {
    provider: 'STRIPE' as const,
    externalEventId: payload?.id ?? `stripe_${Date.now()}`,
    eventType,
    raw: payload,
    occurredAt: payload?.created ? new Date(payload.created * 1000) : new Date(),
  };

  if (eventType === 'charge.succeeded' || eventType === 'payment_intent.succeeded') {
    return {
      ...base,
      kind: 'payment',
      externalTransactionId: object.id,
      externalProductId:
        object.metadata?.product_id ??
        object.lines?.data?.[0]?.price?.id ??
        object.metadata?.price_id,
      externalSubscriptionId: object.subscription ?? undefined,
      grossAmount: fromMinorUnits(object.amount ?? object.amount_received, exponent),
      feeAmount: fromMinorUnits(object.balance_transaction?.fee, exponent) ?? '0',
      currency,
      status: 'SUCCEEDED',
      customerReference: object.customer ?? object.billing_details?.email ?? undefined,
      description: object.description ?? undefined,
    };
  }

  if (eventType === 'invoice.payment_succeeded') {
    return {
      ...base,
      kind: 'payment',
      externalTransactionId: object.charge ?? object.id,
      externalProductId: object.lines?.data?.[0]?.price?.id,
      externalSubscriptionId: object.subscription ?? undefined,
      grossAmount: fromMinorUnits(object.amount_paid, exponent),
      currency,
      status: 'SUCCEEDED',
      customerReference: object.customer_email ?? object.customer ?? undefined,
      description: `Invoice ${object.number ?? object.id}`,
    };
  }

  if (eventType === 'charge.refunded' || eventType === 'refund.created') {
    const refund = object.refunds?.data?.[0] ?? object;
    return {
      ...base,
      kind: 'refund',
      externalTransactionId: object.id ?? refund.charge,
      externalRefundId: refund.id,
      refundAmount: fromMinorUnits(object.amount_refunded ?? refund.amount, exponent),
      currency,
      description: refund.reason ?? 'Refund',
    };
  }

  if (eventType === 'charge.failed' || eventType === 'payment_intent.payment_failed') {
    return {
      ...base,
      kind: 'payment',
      externalTransactionId: object.id,
      grossAmount: fromMinorUnits(object.amount, exponent),
      currency,
      status: 'FAILED',
      description: object.failure_message ?? 'Payment failed',
    };
  }

  if (eventType.startsWith('customer.subscription.')) {
    const statusMap: Record<string, NormalizedPaymentEvent['subscriptionStatus']> = {
      trialing: 'TRIALING',
      active: 'ACTIVE',
      past_due: 'PAST_DUE',
      paused: 'PAUSED',
      canceled: 'CANCELED',
      unpaid: 'PAST_DUE',
      incomplete_expired: 'EXPIRED',
    };
    return {
      ...base,
      kind: 'subscription',
      externalSubscriptionId: object.id,
      externalProductId: object.items?.data?.[0]?.price?.id,
      subscriptionStatus: statusMap[object.status] ?? 'ACTIVE',
      currency,
      customerReference: object.customer ?? undefined,
    };
  }

  return { ...base, kind: 'unhandled' };
}

/**
 * Razorpay. Amounts are in paise (INR) or the smallest unit of the currency.
 * The fee is reported directly on the payment entity.
 */
export function normalizeRazorpayEvent(payload: Record<string, any>): NormalizedPaymentEvent {
  const eventType: string = payload?.event ?? 'unknown';
  const payment = payload?.payload?.payment?.entity ?? {};
  const refund = payload?.payload?.refund?.entity ?? {};
  const subscription = payload?.payload?.subscription?.entity ?? {};

  const currency: string | undefined = (payment.currency ?? refund.currency ?? 'INR')?.toUpperCase();
  const exponent = exponentFor(currency);

  const base = {
    provider: 'RAZORPAY' as const,
    // Razorpay has no top-level event id, so derive a stable one from the
    // entity id plus the event name — enough to make retries idempotent.
    externalEventId:
      payload?.id ??
      `${eventType}_${payment.id ?? refund.id ?? subscription.id ?? Date.now()}`,
    eventType,
    raw: payload,
    occurredAt: payload?.created_at ? new Date(payload.created_at * 1000) : new Date(),
  };

  if (eventType === 'payment.captured') {
    return {
      ...base,
      kind: 'payment',
      externalTransactionId: payment.id,
      externalProductId: payment.notes?.product_id ?? payment.notes?.project_code,
      externalSubscriptionId: payment.subscription_id ?? undefined,
      grossAmount: fromMinorUnits(payment.amount, exponent),
      feeAmount: fromMinorUnits(payment.fee, exponent) ?? '0',
      currency,
      status: 'SUCCEEDED',
      customerReference: payment.email ?? payment.contact ?? undefined,
      description: payment.description ?? undefined,
    };
  }

  if (eventType === 'payment.failed') {
    return {
      ...base,
      kind: 'payment',
      externalTransactionId: payment.id,
      grossAmount: fromMinorUnits(payment.amount, exponent),
      currency,
      status: 'FAILED',
      description: payment.error_description ?? 'Payment failed',
    };
  }

  if (eventType === 'refund.created' || eventType === 'refund.processed') {
    return {
      ...base,
      kind: 'refund',
      externalTransactionId: refund.payment_id,
      externalRefundId: refund.id,
      refundAmount: fromMinorUnits(refund.amount, exponent),
      currency,
      description: refund.notes?.reason ?? 'Refund',
    };
  }

  if (eventType.startsWith('subscription.')) {
    const statusMap: Record<string, NormalizedPaymentEvent['subscriptionStatus']> = {
      created: 'ACTIVE',
      authenticated: 'ACTIVE',
      activated: 'ACTIVE',
      charged: 'ACTIVE',
      pending: 'PAST_DUE',
      halted: 'PAST_DUE',
      cancelled: 'CANCELED',
      completed: 'EXPIRED',
      paused: 'PAUSED',
    };
    return {
      ...base,
      kind: 'subscription',
      externalSubscriptionId: subscription.id,
      externalProductId: subscription.plan_id,
      subscriptionStatus: statusMap[subscription.status] ?? 'ACTIVE',
      currency,
    };
  }

  return { ...base, kind: 'unhandled' };
}

/**
 * Google Play Real-time Developer Notifications.
 *
 * The push body carries only a notification envelope — purchase token, product
 * id and a notification type. Getting the ACTUAL AMOUNT requires a follow-up
 * call to the Play Developer API with the purchase token, which this build does
 * not make.
 *
 * So Play events are normalised for the record and flagged `unhandled`, which
 * stores the event without inventing a revenue figure. See
 * docs/payment-integrations.md for completing this integration.
 */
export function normalizeGooglePlayEvent(payload: Record<string, any>): NormalizedPaymentEvent {
  const decoded = decodePubSubMessage(payload);
  const notification =
    decoded?.subscriptionNotification ?? decoded?.oneTimeProductNotification ?? {};

  return {
    provider: 'GOOGLE_PLAY',
    externalEventId:
      payload?.message?.messageId ?? `play_${notification.purchaseToken ?? Date.now()}`,
    eventType: decoded?.subscriptionNotification
      ? `subscription.${notification.notificationType ?? 'unknown'}`
      : `product.${notification.notificationType ?? 'unknown'}`,
    // No amount is available without a Play Developer API lookup, so this is
    // recorded rather than turned into revenue.
    kind: 'unhandled',
    externalProductId: notification.subscriptionId ?? notification.sku,
    externalSubscriptionId: notification.purchaseToken,
    occurredAt: decoded?.eventTimeMillis ? new Date(Number(decoded.eventTimeMillis)) : new Date(),
    raw: payload,
  };
}

function decodePubSubMessage(payload: Record<string, any>): Record<string, any> | null {
  const data = payload?.message?.data;
  if (!data || typeof data !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Generic adapter for a custom provider, or for one of the user's own app
 * backends reporting its verified payments to this system.
 *
 * The documented contract (see docs/payment-integrations.md):
 *   { eventId, eventType: "payment.succeeded" | "payment.refunded",
 *     transactionId, productId, amount: "12.34", currency: "INR",
 *     feeAmount?, refundId?, refundAmount?, customerReference?, occurredAt? }
 *
 * Amounts here are DECIMAL STRINGS in major units, not minor units — the app
 * backend already knows the real figure.
 */
export function normalizeGenericEvent(payload: Record<string, any>): NormalizedPaymentEvent {
  const eventType: string = payload?.eventType ?? 'unknown';

  const base = {
    provider: 'OTHER' as const,
    externalEventId: payload?.eventId ?? `generic_${Date.now()}`,
    eventType,
    raw: payload,
    occurredAt: payload?.occurredAt ? new Date(payload.occurredAt) : new Date(),
    currency: payload?.currency?.toUpperCase(),
    customerReference: payload?.customerReference,
  };

  if (eventType === 'payment.succeeded') {
    return {
      ...base,
      kind: 'payment',
      externalTransactionId: payload.transactionId,
      externalProductId: payload.productId,
      externalSubscriptionId: payload.subscriptionId,
      grossAmount: payload.amount,
      feeAmount: payload.feeAmount ?? '0',
      status: 'SUCCEEDED',
      description: payload.description,
    };
  }

  if (eventType === 'payment.failed') {
    return {
      ...base,
      kind: 'payment',
      externalTransactionId: payload.transactionId,
      grossAmount: payload.amount,
      status: 'FAILED',
      description: payload.description ?? 'Payment failed',
    };
  }

  if (eventType === 'payment.refunded') {
    return {
      ...base,
      kind: 'refund',
      externalTransactionId: payload.transactionId,
      externalRefundId: payload.refundId,
      refundAmount: payload.refundAmount ?? payload.amount,
      description: payload.reason,
    };
  }

  return { ...base, kind: 'unhandled' };
}
