'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Money input.
 *
 * The value is kept as a STRING throughout — typed, held in form state, and
 * sent to the API. It is never parsed into a JS number, because doing so would
 * round the user's figure before it ever reached the server.
 *
 * Input is constrained to a decimal with at most 4 places, matching the
 * DECIMAL(18,4) columns, so the API never has to reject a well-meant entry.
 */
export const MoneyInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> & {
    value?: string;
    onChange?: (value: string) => void;
    currency?: string;
    allowNegative?: boolean;
  }
>(({ className, value, onChange, currency = 'INR', allowNegative = false, ...props }, ref) => {
  const pattern = allowNegative ? /^-?\d{0,14}(\.\d{0,4})?$/ : /^\d{0,14}(\.\d{0,4})?$/;

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        {currency}
      </span>
      <Input
        ref={ref}
        // "decimal" gives mobile keyboards a decimal point without the
        // spinner and scroll-to-change problems of type="number".
        inputMode="decimal"
        autoComplete="off"
        className={cn('figure pl-12 text-right', className)}
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.value.trim();
          if (next === '' || pattern.test(next)) onChange?.(next);
        }}
        placeholder="0.00"
        {...props}
      />
    </div>
  );
});
MoneyInput.displayName = 'MoneyInput';
