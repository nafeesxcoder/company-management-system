'use client';

import * as React from 'react';
import { Plus, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Figure } from '@/components/money';
import { MoneyInput } from '@/components/money-input';
import { DateRangePicker, type DateRangeValue } from '@/components/date-range-picker';
import { EmptyState, ErrorState, LoadingBlock, PageHeading } from '@/components/states';
import { useAuth } from '@/features/auth/auth-context';
import {
  useCreatePayout,
  useMembers,
  usePayouts,
  useProfitSharing,
  useSetProfitShares,
} from '@/services/queries';
import { useToast } from '@/hooks/use-toast';
import { formatDate, todayInTimezone } from '@/lib/utils';

/**
 * Partner profit sharing.
 *
 * The screen is built around one distinction the numbers must never blur:
 * what a partner is OWED versus what has actually been PAID to them. They sit
 * in adjacent columns with the difference called out, because treating the
 * first as the second is the mistake that causes arguments between partners.
 */
export default function ProfitSharingPage() {
  const { activeCompany, canAdminister, canWrite } = useAuth();
  const currency = activeCompany?.baseCurrency ?? 'INR';
  const timezone = activeCompany?.timezone ?? 'Asia/Kolkata';

  const [range, setRange] = React.useState<DateRangeValue>({ preset: 'thisYear' });
  const [configOpen, setConfigOpen] = React.useState(false);
  const [payoutOpen, setPayoutOpen] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useProfitSharing(range);
  const { data: payouts } = usePayouts({ pageSize: 20 });

  return (
    <>
      <PageHeading
        title="Profit split"
        description="What each partner is owed, and what has actually been paid."
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            {canAdminister ? (
              <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
                <Scale />
                Set split
              </Button>
            ) : null}
            {canWrite ? (
              <Button size="sm" onClick={() => setPayoutOpen(true)}>
                <Plus />
                Record payout
              </Button>
            ) : null}
          </>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <LoadingBlock label="Working out the split" />
      ) : !data.configured ? (
        <EmptyState
          icon={Scale}
          title="No split configured"
          description={
            data.message ??
            'Set the percentages each partner receives before distributing profit. Percentages must total 100.'
          }
          action={
            canAdminister ? (
              <Button size="sm" onClick={() => setConfigOpen(true)}>
                Set the split
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-6">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <Figure amount={data.netProfit} currency={currency} size="hero" tone="signed" />
              <span className="text-sm text-muted-foreground">
                net profit · {data.range.label}
              </span>
            </div>
            <p className="mt-3 max-w-xl text-sm text-muted-foreground">{data.note}</p>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Each partner</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                    <TableHead className="text-right">Owed</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.partners.map((partner) => (
                    <TableRow key={partner.userId}>
                      <TableCell>
                        <span className="block text-sm font-medium">{partner.fullName}</span>
                        <span className="block text-xs text-muted-foreground">{partner.email}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">{partner.percentage}%</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Figure amount={partner.calculatedShare} currency={currency} size="sm" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Figure
                          amount={partner.actuallyPaid}
                          currency={currency}
                          size="sm"
                          tone="muted"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Figure
                          amount={partner.outstanding}
                          currency={currency}
                          size="sm"
                          tone="signed"
                          className="font-semibold"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {data.totals ? (
                <div className="flex flex-wrap items-baseline justify-end gap-6 border-t border-border px-4 py-3 text-sm">
                  <span className="text-muted-foreground">
                    Total owed <Figure amount={data.totals.calculated} currency={currency} size="sm" />
                  </span>
                  <span className="text-muted-foreground">
                    Total paid <Figure amount={data.totals.paid} currency={currency} size="sm" />
                  </span>
                  <span className="font-medium">
                    Still to pay{' '}
                    <Figure amount={data.totals.outstanding} currency={currency} size="sm" tone="signed" />
                  </span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payout history</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!payouts || payouts.items.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No payouts recorded"
                    description="Record money you actually transfer to a partner so the outstanding figure stays honest."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Partner</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payouts.items.map((payout) => (
                      <TableRow key={payout.id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDate(payout.payoutDate)}
                        </TableCell>
                        <TableCell className="text-sm">{payout.partner.fullName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {payout.method ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {payout.reference ?? '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Figure amount={payout.amount} currency={payout.currency} size="sm" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {configOpen ? <ConfigureSplitDialog onClose={() => setConfigOpen(false)} timezone={timezone} /> : null}
      {payoutOpen ? (
        <RecordPayoutDialog onClose={() => setPayoutOpen(false)} currency={currency} timezone={timezone} />
      ) : null}
    </>
  );
}

function ConfigureSplitDialog({ onClose, timezone }: { onClose: () => void; timezone: string }) {
  const { toast, toastError } = useToast();
  const { data: members } = useMembers();
  const setShares = useSetProfitShares();

  const [effectiveFrom, setEffectiveFrom] = React.useState(todayInTimezone(timezone));
  const [shares, setShares_] = React.useState<Record<string, string>>({});

  const activeMembers = (members ?? []).filter((m) => m.status === 'ACTIVE');

  React.useEffect(() => {
    if (activeMembers.length > 0 && Object.keys(shares).length === 0) {
      // An even starting split, which the user then adjusts. Not a hardcoded
      // rule — just a sensible default for the form.
      const even = (100 / activeMembers.length).toFixed(4);
      setShares_(Object.fromEntries(activeMembers.map((m) => [m.user.id, even])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  const total = Object.values(shares).reduce((sum, value) => sum + Number(value || '0'), 0);
  const totalsCorrectly = Math.abs(total - 100) < 0.00005;

  async function submit() {
    try {
      await setShares.mutateAsync({
        effectiveFrom,
        shares: Object.entries(shares).map(([userId, percentage]) => ({ userId, percentage })),
      });
      toast({ title: 'Split saved', variant: 'success' });
      onClose();
    } catch (error) {
      toastError(error, 'Could not save the split');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set the profit split</DialogTitle>
          <DialogDescription>
            Percentages must total exactly 100. The previous split is kept, so past statements still
            use the split that applied at the time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="effective-from">Effective from</Label>
            <Input
              id="effective-from"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            {activeMembers.map((member) => (
              <div key={member.user.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm">{member.user.fullName}</span>
                <div className="relative w-28">
                  <Input
                    inputMode="decimal"
                    className="figure pr-7 text-right"
                    value={shares[member.user.id] ?? ''}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next === '' || /^\d{0,3}(\.\d{0,4})?$/.test(next)) {
                        setShares_((current) => ({ ...current, [member.user.id]: next }));
                      }
                    }}
                    aria-label={`${member.user.fullName} share percentage`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div
            className={`flex items-baseline justify-between border-t border-border pt-3 text-sm ${
              totalsCorrectly ? '' : 'text-[hsl(var(--loss))]'
            }`}
          >
            <span>Total</span>
            <span className="figure font-semibold">{total.toFixed(4).replace(/\.?0+$/, '')}%</span>
          </div>
          {!totalsCorrectly ? (
            <p className="text-xs text-[hsl(var(--loss))]">
              Adjust the percentages until they total exactly 100.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={setShares.isPending} disabled={!totalsCorrectly}>
            Save split
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordPayoutDialog({
  onClose,
  currency,
  timezone,
}: {
  onClose: () => void;
  currency: string;
  timezone: string;
}) {
  const { toast, toastError } = useToast();
  const { data: members } = useMembers();
  const createPayout = useCreatePayout();

  const [userId, setUserId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [payoutDate, setPayoutDate] = React.useState(todayInTimezone(timezone));
  const [method, setMethod] = React.useState('');
  const [reference, setReference] = React.useState('');

  async function submit() {
    try {
      await createPayout.mutateAsync({
        userId,
        amount,
        payoutDate,
        ...(method ? { method } : {}),
        ...(reference ? { reference } : {}),
      });
      toast({ title: 'Payout recorded', variant: 'success' });
      onClose();
    } catch (error) {
      toastError(error, 'Could not record the payout');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payout</DialogTitle>
          <DialogDescription>
            Money you have actually transferred to a partner. This reduces what they are still owed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="payout-partner">Partner</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id="payout-partner">
                <SelectValue placeholder="Choose a partner" />
              </SelectTrigger>
              <SelectContent>
                {(members ?? [])
                  .filter((m) => m.status === 'ACTIVE')
                  .map((member) => (
                    <SelectItem key={member.user.id} value={member.user.id}>
                      {member.user.fullName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="payout-amount">Amount</Label>
              <MoneyInput id="payout-amount" currency={currency} value={amount} onChange={setAmount} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-date">Date paid</Label>
              <Input
                id="payout-date"
                type="date"
                value={payoutDate}
                onChange={(event) => setPayoutDate(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="payout-method">Method</Label>
              <Input
                id="payout-method"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                placeholder="Bank transfer"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-reference">Reference</Label>
              <Input
                id="payout-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="UTR number"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={createPayout.isPending}
            disabled={!userId || !amount || Number(amount) <= 0}
          >
            Record payout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
