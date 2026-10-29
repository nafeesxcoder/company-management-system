'use client';

import * as React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cn, formatMoney, moneyToNumber } from '@/lib/utils';
import type { Money } from '@/types/api';

/**
 * Figure — the single way money is rendered in this app.
 *
 * Always serif + tabular numerals so two amounts of different magnitude line
 * up on the decimal. Colour carries meaning (gain/loss) and is never used
 * decoratively; `tone="plain"` is the default so that only figures where sign
 * matters are coloured.
 */
export function Figure({
  amount,
  currency = 'INR',
  size = 'md',
  tone = 'plain',
  compact,
  showSign,
  className,
}: {
  amount: Money | null | undefined;
  currency?: string;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  tone?: 'plain' | 'signed' | 'muted';
  compact?: boolean;
  showSign?: boolean;
  className?: string;
}) {
  const value = moneyToNumber(amount);

  const sizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-2xl',
    hero: 'text-hero',
  } as const;

  const toneClass =
    tone === 'signed'
      ? value < 0
        ? 'text-[hsl(var(--loss))]'
        : value > 0
          ? 'text-[hsl(var(--gain))]'
          : 'text-muted-foreground'
      : tone === 'muted'
        ? 'text-muted-foreground'
        : '';

  return (
    <span className={cn('figure', sizes[size], toneClass, className)}>
      {formatMoney(amount, currency, { compact, showSign })}
    </span>
  );
}

/**
 * The dashboard hero: net profit as the result of an equation, because that is
 * exactly what it is. Reading left to right shows how the headline figure was
 * reached, which is the question a partner asks next.
 */
export function LedgerEquation({
  currency,
  netRevenue,
  processingFees,
  expenses,
  netProfit,
  grossRevenue,
  refunds,
}: {
  currency: string;
  grossRevenue: Money;
  refunds: Money;
  netRevenue: Money;
  processingFees: Money;
  expenses: Money;
  netProfit: Money;
}) {
  const isLoss = moneyToNumber(netProfit) < 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Figure
          amount={netProfit}
          currency={currency}
          size="hero"
          className={isLoss ? 'text-[hsl(var(--loss))]' : 'text-foreground'}
        />
        <span className="text-sm text-muted-foreground">
          {isLoss ? 'net loss' : 'net profit'}
        </span>
      </div>

      {/* The working, as a single readable line. */}
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-2 text-sm">
        <EquationTerm label="gross" amount={grossRevenue} currency={currency} />
        <Operator>−</Operator>
        <EquationTerm label="refunds" amount={refunds} currency={currency} />
        <Operator>−</Operator>
        <EquationTerm label="fees" amount={processingFees} currency={currency} />
        <Operator>−</Operator>
        <EquationTerm label="expenses" amount={expenses} currency={currency} />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Net revenue {formatMoney(netRevenue, currency)} after refunds.
      </p>
    </div>
  );
}

function EquationTerm({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: Money;
  currency: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <Figure amount={amount} currency={currency} size="sm" />
    </span>
  );
}

function Operator({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground/60" aria-hidden>
      {children}
    </span>
  );
}

/**
 * A single ledger line: label on the left, figure right-aligned so a column of
 * these reads as a statement.
 */
export function LedgerRow({
  label,
  amount,
  currency,
  hint,
  tone = 'plain',
  emphasis,
}: {
  label: string;
  amount: Money;
  currency: string;
  hint?: string;
  tone?: 'plain' | 'signed' | 'muted';
  emphasis?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2', emphasis && 'border-t border-border pt-3')}>
      <span className={cn('text-sm', emphasis ? 'font-medium' : 'text-muted-foreground')}>
        {label}
        {hint ? <span className="ml-1.5 text-xs text-muted-foreground/70">{hint}</span> : null}
      </span>
      <Figure amount={amount} currency={currency} tone={tone} size={emphasis ? 'md' : 'sm'} className={emphasis ? 'font-semibold' : ''} />
    </div>
  );
}

/**
 * Shown whenever figures exclude records the backend could not convert.
 * A total that quietly drops rows is worse than one that admits it.
 */
export function DataQualityNotice({
  unconvertedRecords,
  needingReview,
}: {
  unconvertedRecords: number;
  needingReview: number;
}) {
  if (unconvertedRecords === 0 && needingReview === 0) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-md border border-[hsl(var(--pending))]/30 bg-[hsl(var(--pending))]/5 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--pending))]" aria-hidden />
      <div className="space-y-1">
        {unconvertedRecords > 0 ? (
          <p>
            <strong className="font-medium">
              {unconvertedRecords} record{unconvertedRecords === 1 ? '' : 's'} excluded from these totals.
            </strong>{' '}
            They are in a currency with no recorded exchange rate. Add a rate to include them.
          </p>
        ) : null}
        {needingReview > 0 ? (
          <p>
            {needingReview} payment{needingReview === 1 ? '' : 's'} could not be matched to a project.{' '}
            <a href="/transactions?reviewStatus=NEEDS_REVIEW" className="underline underline-offset-2">
              Assign {needingReview === 1 ? 'it' : 'them'}
            </a>{' '}
            so project figures are complete.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Marks a figure as estimated or definitional, never left to guesswork. */
export function FigureNote({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Info className="h-3 w-3" aria-hidden />
      {children}
    </span>
  );
}
