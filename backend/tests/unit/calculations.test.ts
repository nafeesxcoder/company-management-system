import { describe, expect, it } from 'vitest';
import {
  calculateTotals,
  groupNetRevenue,
  refundableRemainder,
  statusAfterRefund,
  type ExpenseLike,
  type RefundLike,
  type TransactionLike,
} from '../../src/modules/reports/calculations.js';
import { Decimal, convertToBase, splitByPercentages, toMoneyString } from '../../src/utils/money.js';

const INR = 'INR';

function txn(partial: Partial<TransactionLike>): TransactionLike {
  return {
    id: Math.random().toString(36).slice(2),
    status: 'SUCCEEDED',
    grossAmount: '1000.0000',
    feeAmount: '0.0000',
    currency: INR,
    exchangeRateToBase: null,
    ...partial,
  };
}

function refund(partial: Partial<RefundLike>): RefundLike {
  return { status: 'SUCCEEDED', amount: '100.0000', feeRefunded: '0.0000', currency: INR, ...partial };
}

function expense(partial: Partial<ExpenseLike>): ExpenseLike {
  return { paymentStatus: 'PAID', amount: '100.0000', taxAmount: '0.0000', currency: INR, ...partial };
}

describe('calculateTotals — revenue recognition', () => {
  it('counts only money that actually arrived', () => {
    const totals = calculateTotals(
      {
        transactions: [
          txn({ status: 'SUCCEEDED', grossAmount: '1000' }),
          txn({ status: 'PARTIALLY_REFUNDED', grossAmount: '500' }),
          txn({ status: 'REFUNDED', grossAmount: '300' }),
          txn({ status: 'PENDING', grossAmount: '9999' }),
          txn({ status: 'FAILED', grossAmount: '8888' }),
          txn({ status: 'CANCELED', grossAmount: '7777' }),
          txn({ status: 'DISPUTED', grossAmount: '250' }),
        ],
        refunds: [],
        expenses: [],
      },
      INR,
    );

    expect(totals.grossRevenue.toString()).toBe('1800');
    expect(totals.pendingPayments.toString()).toBe('9999');
    expect(totals.disputedAmount.toString()).toBe('250');
  });

  it('excludes pending payments from revenue but tracks them as receivables', () => {
    const totals = calculateTotals(
      { transactions: [txn({ status: 'PENDING', grossAmount: '4200.50' })], refunds: [], expenses: [] },
      INR,
    );
    expect(totals.grossRevenue.toString()).toBe('0');
    expect(totals.netRevenue.toString()).toBe('0');
    expect(totals.pendingPayments.toString()).toBe('4200.5');
  });
});

describe('calculateTotals — refunds', () => {
  it('net revenue = gross revenue minus settled refunds', () => {
    const totals = calculateTotals(
      {
        transactions: [txn({ grossAmount: '1000' })],
        refunds: [refund({ amount: '250' })],
        expenses: [],
      },
      INR,
    );
    expect(totals.netRevenue.toString()).toBe('750');
  });

  it('ignores refunds that have not settled', () => {
    const totals = calculateTotals(
      {
        transactions: [txn({ grossAmount: '1000' })],
        refunds: [refund({ amount: '250', status: 'PENDING' }), refund({ amount: '100', status: 'FAILED' })],
        expenses: [],
      },
      INR,
    );
    expect(totals.totalRefunds.toString()).toBe('0');
    expect(totals.netRevenue.toString()).toBe('1000');
  });

  it('handles a full refund leaving zero net revenue', () => {
    const totals = calculateTotals(
      { transactions: [txn({ status: 'REFUNDED', grossAmount: '999.99' })], refunds: [refund({ amount: '999.99' })], expenses: [] },
      INR,
    );
    expect(totals.netRevenue.toString()).toBe('0');
  });
});

describe('calculateTotals — provider fees deducted exactly once', () => {
  it('deducts the fee from profit once, from the transaction row', () => {
    const totals = calculateTotals(
      {
        transactions: [txn({ grossAmount: '1000', feeAmount: '29.50' })],
        refunds: [],
        expenses: [],
      },
      INR,
    );
    expect(totals.processingFees.toString()).toBe('29.5');
    // 1000 net revenue − 29.50 fee − 0 expenses
    expect(totals.netProfit.toString()).toBe('970.5');
  });

  it('does not double-count a gateway fee also entered as an expense', () => {
    const totals = calculateTotals(
      {
        transactions: [txn({ grossAmount: '1000', feeAmount: '29.50' })],
        refunds: [],
        // Same fee recorded as a bookkeeping expense, correctly flagged.
        expenses: [expense({ amount: '29.50', excludeFromProfit: true })],
      },
      INR,
    );
    expect(totals.processingFees.toString()).toBe('29.5');
    expect(totals.eligibleExpenses.toString()).toBe('0');
    expect(totals.totalExpenses.toString()).toBe('29.5');
    expect(totals.netProfit.toString()).toBe('970.5');
  });

  it('credits back a returned fee so it is not deducted twice', () => {
    const totals = calculateTotals(
      {
        transactions: [txn({ status: 'REFUNDED', grossAmount: '1000', feeAmount: '29.50' })],
        refunds: [refund({ amount: '1000', feeRefunded: '29.50' })],
        expenses: [],
      },
      INR,
    );
    expect(totals.processingFees.toString()).toBe('0');
    expect(totals.netProfit.toString()).toBe('0');
  });
});

describe('calculateTotals — expenses and profit', () => {
  it('net profit = net revenue − fees − eligible expenses', () => {
    const totals = calculateTotals(
      {
        transactions: [txn({ grossAmount: '10000', feeAmount: '236' })],
        refunds: [refund({ amount: '1000' })],
        expenses: [expense({ amount: '2000' }), expense({ amount: '500', taxAmount: '90' })],
      },
      INR,
    );
    expect(totals.netRevenue.toString()).toBe('9000');
    expect(totals.eligibleExpenses.toString()).toBe('2590');
    expect(totals.netProfit.toString()).toBe('6174'); // 9000 − 236 − 2590
  });

  it('excludes canceled expenses entirely and reports unpaid ones separately', () => {
    const totals = calculateTotals(
      {
        transactions: [],
        refunds: [],
        expenses: [
          expense({ amount: '100', paymentStatus: 'CANCELED' }),
          expense({ amount: '200', paymentStatus: 'PENDING' }),
          expense({ amount: '300', paymentStatus: 'OVERDUE' }),
          expense({ amount: '400', paymentStatus: 'PAID' }),
        ],
      },
      INR,
    );
    expect(totals.totalExpenses.toString()).toBe('900');
    expect(totals.unpaidExpenses.toString()).toBe('500');
    expect(totals.netProfit.toString()).toBe('-900');
  });
});

describe('calculateTotals — multi-currency safety', () => {
  it('converts foreign currency using the recorded rate', () => {
    const totals = calculateTotals(
      {
        transactions: [txn({ grossAmount: '100', currency: 'USD', exchangeRateToBase: '83.25' })],
        refunds: [],
        expenses: [],
      },
      INR,
    );
    expect(totals.grossRevenue.toString()).toBe('8325');
    expect(totals.unconvertedRecords).toBe(0);
  });

  it('never silently adds a foreign amount with no rate — it is excluded and counted', () => {
    const totals = calculateTotals(
      {
        transactions: [
          txn({ grossAmount: '1000', currency: 'INR' }),
          txn({ grossAmount: '100', currency: 'USD', exchangeRateToBase: null }),
        ],
        refunds: [],
        expenses: [],
      },
      INR,
    );
    expect(totals.grossRevenue.toString()).toBe('1000');
    expect(totals.unconvertedRecords).toBe(1);
  });

  it('convertToBase throws rather than guessing a rate', () => {
    expect(() => convertToBase('100', 'USD', 'INR', null)).toThrow(/no exchange rate/i);
    expect(() => convertToBase('100', 'USD', 'INR', '0')).toThrow(/greater than zero/i);
  });
});

describe('decimal precision', () => {
  it('does not drift the way floats do', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754; it must here.
    const totals = calculateTotals(
      {
        transactions: [txn({ grossAmount: '0.10' }), txn({ grossAmount: '0.20' })],
        refunds: [],
        expenses: [],
      },
      INR,
    );
    expect(totals.grossRevenue.equals(new Decimal('0.30'))).toBe(true);
  });

  it('survives a thousand small amounts without rounding error', () => {
    const transactions = Array.from({ length: 1000 }, () => txn({ grossAmount: '0.07' }));
    const totals = calculateTotals({ transactions, refunds: [], expenses: [] }, INR);
    expect(totals.grossRevenue.toString()).toBe('70');
  });

  it('formats to the currency minor units', () => {
    expect(toMoneyString('1234.56789', 'INR')).toBe('1234.5700');
    expect(toMoneyString('1234.5', 'JPY')).toBe('1235.0000'); // zero-decimal currency
  });
});

describe('refund guards', () => {
  it('reports the remaining refundable amount', () => {
    expect(refundableRemainder('1000', '250').toString()).toBe('750');
    expect(refundableRemainder('1000', '1000').toString()).toBe('0');
    expect(refundableRemainder('1000', '1200').toString()).toBe('0');
  });

  it('derives transaction status from the refunded total', () => {
    expect(statusAfterRefund('1000', '0', 'SUCCEEDED')).toBe('SUCCEEDED');
    expect(statusAfterRefund('1000', '400', 'SUCCEEDED')).toBe('PARTIALLY_REFUNDED');
    expect(statusAfterRefund('1000', '1000', 'SUCCEEDED')).toBe('REFUNDED');
  });
});

describe('profit share splitting', () => {
  it('splits 50/50 exactly', () => {
    const shares = splitByPercentages('1000', [{ key: 'a', percentage: '50' }, { key: 'b', percentage: '50' }], INR);
    expect(shares.map((s) => s.amount.toString())).toEqual(['500', '500']);
  });

  it('splits an odd amount without losing or inventing a paisa', () => {
    const shares = splitByPercentages('1000.01', [{ key: 'a', percentage: '50' }, { key: 'b', percentage: '50' }], INR);
    const total = shares.reduce((acc, s) => acc.plus(s.amount), new Decimal(0));
    expect(total.toString()).toBe('1000.01');
  });

  it('handles a 60/40 split and an awkward third', () => {
    const two = splitByPercentages('100', [{ key: 'a', percentage: '60' }, { key: 'b', percentage: '40' }], INR);
    expect(two.map((s) => s.amount.toString())).toEqual(['60', '40']);

    const three = splitByPercentages(
      '100',
      [
        { key: 'a', percentage: '33.3333' },
        { key: 'b', percentage: '33.3333' },
        { key: 'c', percentage: '33.3334' },
      ],
      INR,
    );
    const total = three.reduce((acc, s) => acc.plus(s.amount), new Decimal(0));
    expect(total.toString()).toBe('100');
  });

  it('distributes a loss without losing a unit either', () => {
    const shares = splitByPercentages('-1000.01', [{ key: 'a', percentage: '50' }, { key: 'b', percentage: '50' }], INR);
    const total = shares.reduce((acc, s) => acc.plus(s.amount), new Decimal(0));
    expect(total.toString()).toBe('-1000.01');
  });

  it('rejects percentages that do not total 100', () => {
    expect(() =>
      splitByPercentages('1000', [{ key: 'a', percentage: '50' }, { key: 'b', percentage: '30' }], INR),
    ).toThrow(/must total exactly 100/i);
  });
});

describe('grouping', () => {
  it('groups net revenue by project with refunds applied', () => {
    const t1 = txn({ id: 't1', projectId: 'p1', grossAmount: '1000', feeAmount: '20' });
    const t2 = txn({ id: 't2', projectId: 'p1', grossAmount: '500' });
    const t3 = txn({ id: 't3', projectId: 'p2', grossAmount: '2000' });
    const t4 = txn({ id: 't4', projectId: 'p2', grossAmount: '999', status: 'FAILED' });

    const refundsByTxn = new Map<string, RefundLike[]>([['t1', [refund({ amount: '100' })]]]);

    const grouped = groupNetRevenue([t1, t2, t3, t4], refundsByTxn, (t) => t.projectId ?? 'unassigned', INR);

    expect(grouped.get('p1')!.net.toString()).toBe('1400');
    expect(grouped.get('p1')!.fees.toString()).toBe('20');
    expect(grouped.get('p1')!.count).toBe(2);
    expect(grouped.get('p2')!.net.toString()).toBe('2000');
    expect(grouped.get('p2')!.count).toBe(1); // FAILED excluded
  });
});
