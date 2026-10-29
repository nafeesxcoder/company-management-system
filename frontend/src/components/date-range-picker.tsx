'use client';

import * as React from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { DatePreset } from '@/types/api';

/**
 * Range filter.
 *
 * Presets are resolved server-side in the COMPANY's timezone, not the
 * browser's — "today" must mean the same thing for a partner in California and
 * one in Uttar Pradesh looking at the same company.
 */

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7days', label: '7 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'thisYear', label: 'This year' },
  { value: 'allTime', label: 'All time' },
];

export interface DateRangeValue extends Record<string, unknown> {
  preset: DatePreset;
  from?: string;
  to?: string;
}

export function DateRangePicker({
  value,
  onChange,
  className,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [customFrom, setCustomFrom] = React.useState(value.from ?? '');
  const [customTo, setCustomTo] = React.useState(value.to ?? '');

  function applyCustom() {
    if (!customFrom || !customTo) return;
    onChange({ preset: 'custom', from: customFrom, to: customTo });
    setOpen(false);
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} role="group" aria-label="Date range">
      {PRESETS.map((preset) => (
        <Button
          key={preset.value}
          variant={value.preset === preset.value ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={value.preset === preset.value}
          onClick={() => onChange({ preset: preset.value })}
        >
          {preset.label}
        </Button>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={value.preset === 'custom' ? 'secondary' : 'ghost'} size="sm">
            <Calendar />
            {value.preset === 'custom' && value.from && value.to ? `${value.from} → ${value.to}` : 'Custom'}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="range-from">From</Label>
            <Input
              id="range-from"
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="range-to">To</Label>
            <Input
              id="range-to"
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </div>
          <Button className="w-full" size="sm" onClick={applyCustom} disabled={!customFrom || !customTo}>
            Apply range
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
