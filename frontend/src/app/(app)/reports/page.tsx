'use client';

import * as React from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Figure, LedgerRow } from '@/components/money';
import { DateRangePicker, type DateRangeValue } from '@/components/date-range-picker';
import { ErrorState, LoadingBlock, PageHeading } from '@/components/states';
import { useAuth } from '@/features/auth/auth-context';
import { useProfitLoss } from '@/services/queries';
import { useToast } from '@/hooks/use-toast';
import { apiDownload } from '@/lib/api-client';
import { formatDate, formatPercent } from '@/lib/utils';

/**
 * Profit and loss.
 *
 * The report ends with the definitions the figures were computed from, so the
 * numbers can be audited rather than taken on trust — which matters when two
 * partners are dividing the result.
 */
export default function ReportsPage() {
  const { activeCompany } = useAuth();
  const { toast, toastError } = useToast();
  const currency = activeCompany?.baseCurrency ?? 'INR';

  const [range, setRange] = React.useState<DateRangeValue>({ preset: 'thisYear' });
  const { data, isLoading, isError, error, refetch } = useProfitLoss(range);

  const query = new URLSearchParams(
    Object.entries(range).filter(([, v]) => typeof v === 'string') as [string, string][],
  ).toString();

  async function download(kind: 'transactions' | 'expenses') {
    try {
      await apiDownload(`/reports/export/${kind}?${query}`, `${kind}.csv`);
      toast({ title: 'Export downloaded', variant: 'success' });
    } catch (err) {
      toastError(err, 'Could not export');
    }
  }

  return (
    <>
      <PageHeading
        title="Profit and loss"
        description={data ? `${data.range.label} · ${currency}` : undefined}
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Button variant="outline" size="sm" onClick={() => void download('transactions')}>
              <Download />
              Income CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => void download('expenses')}>
              <Download />
              Expenses CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} className="no-print">
              <Printer />
              Print
            </Button>
          </>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <LoadingBlock label="Preparing the report" />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {formatDate(data.range.from)} to {formatDate(data.range.to)}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-10 gap-y-0 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Revenue</p>
                <LedgerRow label="Gross revenue" amount={data.revenue.grossRevenue} currency={currency} />
                <LedgerRow label="Less refunds" amount={data.revenue.refunds} currency={currency} tone="muted" />
                <LedgerRow label="Net revenue" amount={data.revenue.netRevenue} currency={currency} emphasis />
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Costs</p>
                <LedgerRow
                  label="Payment processing fees"
                  amount={data.costs.processingFees}
                  currency={currency}
                  tone="muted"
                />
                <LedgerRow
                  label="Expenses counted toward profit"
                  amount={data.costs.eligibleExpenses}
                  currency={currency}
                  tone="muted"
                />
                <LedgerRow
                  label="Total expenses recorded"
                  amount={data.costs.totalExpensesRecorded}
                  currency={currency}
                  hint="including those excluded from profit"
                  tone="muted"
                />
              </div>

              <div className="md:col-span-2">
                <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 border-t-2 border-foreground/20 pt-4">
                  <span className="font-medium">Net profit</span>
                  <span className="flex items-baseline gap-3">
                    {data.result.profitMargin ? (
                      <span className="text-sm text-muted-foreground">
                        {formatPercent(data.result.profitMargin)} margin
                      </span>
                    ) : null}
                    <Figure amount={data.result.netProfit} currency={currency} size="lg" tone="signed" />
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Expenses by category</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data.costs.byCategory.length === 0 ? (
                  <p className="p-5 text-sm text-muted-foreground">No expenses in this period.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Recorded</TableHead>
                        <TableHead className="text-right">In profit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.costs.byCategory.map((row) => (
                        <TableRow key={row.categoryId}>
                          <TableCell className="text-sm">{row.name}</TableCell>
                          <TableCell className="text-right">
                            <Figure amount={row.total} currency={currency} size="sm" />
                          </TableCell>
                          <TableCell className="text-right">
                            <Figure amount={row.countedTowardProfit} currency={currency} size="sm" tone="muted" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Outstanding</CardTitle>
              </CardHeader>
              <CardContent>
                <LedgerRow
                  label="Money owed to us"
                  amount={data.outstanding.pendingPayments}
                  currency={currency}
                  hint="not counted as revenue"
                />
                <LedgerRow
                  label="Bills we have not paid"
                  amount={data.outstanding.unpaidExpenses}
                  currency={currency}
                />
                <LedgerRow label="Disputed" amount={data.outstanding.disputedAmount} currency={currency} />
              </CardContent>
            </Card>
          </div>

          {data.dataQuality.note ? (
            <div className="rounded-md border border-[hsl(var(--pending))]/30 bg-[hsl(var(--pending))]/5 p-3 text-sm">
              {data.dataQuality.note}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>How these figures are calculated</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.entries(data.definitions).map(([key, definition]) => (
                <div key={key} className="grid gap-1 sm:grid-cols-[180px_1fr]">
                  <span className="font-medium">{labelFor(key)}</span>
                  <span className="text-muted-foreground">{definition}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function labelFor(key: string): string {
  const labels: Record<string, string> = {
    netRevenue: 'Net revenue',
    processingFees: 'Processing fees',
    eligibleExpenses: 'Eligible expenses',
    netProfit: 'Net profit',
    receivedStatuses: 'What counts as received',
  };
  return labels[key] ?? key;
}
