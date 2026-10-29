'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, Clock, FolderOpen, RefreshCw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DataQualityNotice, Figure, LedgerEquation, LedgerRow } from '@/components/money';
import { DateRangePicker, type DateRangeValue } from '@/components/date-range-picker';
import { EmptyState, ErrorState, LoadingBlock, PageHeading } from '@/components/states';
import { useDashboard } from '@/services/queries';
import { useAuth } from '@/features/auth/auth-context';
import { formatMoney, formatMonthKey, humanize, moneyToNumber } from '@/lib/utils';

/**
 * The overview.
 *
 * Leads with the P&L as an equation, because that is what it is: the one
 * question both partners open the app to answer, with its working shown.
 * Every figure here comes from the API; nothing is recomputed in the browser.
 */
export default function DashboardPage() {
  const { activeCompany, user } = useAuth();
  const [range, setRange] = React.useState<DateRangeValue>({ preset: 'thisMonth' });

  const currency = activeCompany?.baseCurrency ?? 'INR';
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboard(range);

  const firstName = user?.fullName.split(' ')[0] ?? '';

  return (
    <>
      <PageHeading
        title={firstName ? `Overview` : 'Overview'}
        description={data ? `${data.range.label} · figures in ${currency}` : undefined}
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void refetch()}
              aria-label="Refresh figures"
            >
              <RefreshCw className={isFetching ? 'animate-spin' : undefined} />
            </Button>
          </>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <LoadingBlock label="Loading figures" />
      ) : (
        <div className="space-y-6">
          <DataQualityNotice
            unconvertedRecords={data.dataQuality.unconvertedRecords}
            needingReview={data.dataQuality.transactionsNeedingReview}
          />

          {/* Hero: the equation */}
          <section className="rounded-lg border border-border bg-card p-6">
            <LedgerEquation
              currency={data.summary.currency}
              grossRevenue={data.summary.grossRevenue}
              refunds={data.summary.totalRefunds}
              netRevenue={data.summary.netRevenue}
              processingFees={data.summary.processingFees}
              expenses={data.summary.eligibleExpenses}
              netProfit={data.summary.netProfit}
            />

            <div className="mt-6 grid gap-x-8 gap-y-1 border-t border-border pt-4 sm:grid-cols-3">
              <LedgerRow
                label="Awaiting payment"
                amount={data.summary.pendingPayments}
                currency={currency}
                hint="not counted as revenue"
                tone="muted"
              />
              <LedgerRow
                label="Unpaid expenses"
                amount={data.summary.unpaidExpenses}
                currency={currency}
                tone="muted"
              />
              <LedgerRow
                label="Disputed"
                amount={data.summary.disputedAmount}
                currency={currency}
                tone="muted"
              />
            </div>
          </section>

          {/* Counts */}
          <section className="grid gap-3 sm:grid-cols-3">
            <CountTile
              icon={FolderOpen}
              label="Active projects"
              value={`${data.counts.activeProjects}`}
              sub={`${data.counts.totalProjects} total`}
              href="/projects"
            />
            <CountTile
              icon={RefreshCw}
              label="Active subscriptions"
              value={`${data.counts.activeSubscriptions}`}
              sub="recurring revenue"
              href="/transactions?type=SUBSCRIPTION_RENEWAL"
            />
            <CountTile
              icon={Clock}
              label="Needs attention"
              value={`${data.counts.transactionsNeedingReview}`}
              sub="payments to assign"
              href="/transactions?reviewStatus=NEEDS_REVIEW"
              urgent={data.counts.transactionsNeedingReview > 0}
            />
          </section>

          {/* Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Profit and loss over time</CardTitle>
            </CardHeader>
            <CardContent>
              {data.monthlyTrend.length === 0 ? (
                <EmptyState
                  title="No activity in this range"
                  description="Record income or an expense, or widen the date range."
                />
              ) : (
                <TrendChart data={data.monthlyTrend} currency={currency} />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Revenue by project */}
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Revenue by project</CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/projects">
                    All projects <ArrowUpRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {data.revenueByProject.length === 0 ? (
                  <EmptyState
                    title="No revenue yet"
                    description="Record your first payment, or connect a payment provider to bring income in automatically."
                    action={
                      <Button size="sm" asChild>
                        <Link href="/income">Record income</Link>
                      </Button>
                    }
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead className="text-right">Net revenue</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.revenueByProject.slice(0, 8).map((row) => (
                        <TableRow key={row.projectId ?? row.code}>
                          <TableCell>
                            {row.projectId ? (
                              <Link
                                href={`/projects/${row.projectId}`}
                                className="underline-offset-2 hover:underline"
                              >
                                {row.name}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">{row.name}</span>
                            )}
                            <span className="ml-2 text-xs text-muted-foreground">{row.code}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Figure amount={row.netRevenue} currency={currency} size="sm" />
                          </TableCell>
                          <TableCell className="text-right">
                            <Figure amount={row.netProfit} currency={currency} size="sm" tone="signed" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Expenses by category */}
            <Card>
              <CardHeader>
                <CardTitle>Where the money went</CardTitle>
              </CardHeader>
              <CardContent>
                {data.expensesByCategory.length === 0 ? (
                  <EmptyState
                    title="No expenses recorded"
                    description="Add hosting, domains, advertising and other costs to see profit rather than just revenue."
                    action={
                      <Button size="sm" asChild>
                        <Link href="/expenses">Add an expense</Link>
                      </Button>
                    }
                  />
                ) : (
                  <ExpenseBreakdown data={data.expensesByCategory} currency={currency} />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Provider mix */}
          {data.revenueByProvider.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Revenue by payment provider</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Fees</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.revenueByProvider.map((row) => (
                      <TableRow key={row.provider}>
                        <TableCell>
                          <Badge variant="outline">{humanize(row.provider)}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Figure amount={row.grossRevenue} currency={currency} size="sm" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Figure amount={row.processingFees} currency={currency} size="sm" tone="muted" />
                        </TableCell>
                        <TableCell className="text-right tabular text-sm">{row.transactionCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}

function CountTile({
  icon: Icon,
  label,
  value,
  sub,
  href,
  urgent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  href: string;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary/40"
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${urgent ? 'text-[hsl(var(--pending))]' : 'text-muted-foreground'}`}
      />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="flex items-baseline gap-2">
          <span className={`figure text-lg ${urgent ? 'text-[hsl(var(--pending))]' : ''}`}>{value}</span>
          <span className="truncate text-xs text-muted-foreground">{sub}</span>
        </p>
      </div>
    </Link>
  );
}

function TrendChart({
  data,
  currency,
}: {
  data: { month: string; netRevenue: string; expenses: string; netProfit: string }[];
  currency: string;
}) {
  // Money strings become numbers only here, at the chart boundary.
  const chartData = data.map((point) => ({
    month: formatMonthKey(point.month),
    'Net revenue': moneyToNumber(point.netRevenue),
    Expenses: moneyToNumber(point.expenses),
    'Net profit': moneyToNumber(point.netProfit),
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            width={70}
            tickFormatter={(value: number) => formatMoney(String(value), currency, { compact: true })}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              fontSize: 13,
            }}
            formatter={(value: number) => formatMoney(String(value), currency)}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="Net revenue"
            stroke="hsl(var(--gain))"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="Expenses"
            stroke="hsl(var(--loss))"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="Net profit"
            stroke="hsl(var(--foreground))"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ExpenseBreakdown({
  data,
  currency,
}: {
  data: { categoryId: string; name: string; color: string | null; total: string; count: number }[];
  currency: string;
}) {
  const palette = ['#1F6F5C', '#2E8B74', '#A33A2E', '#C2764A', '#4F6D7A', '#7C5E8C', '#8A8F4A'];

  const chartData = data.slice(0, 7).map((item, index) => ({
    name: item.name,
    value: moneyToNumber(item.total),
    fill: item.color ?? palette[index % palette.length],
  }));

  return (
    <div className="space-y-4">
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 6,
                fontSize: 13,
              }}
              formatter={(value: number) => formatMoney(String(value), currency)}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div>
        {data.slice(0, 7).map((item, index) => (
          <div key={item.categoryId} className="flex items-center gap-2 py-1.5 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: item.color ?? palette[index % palette.length] }}
              aria-hidden
            />
            <span className="flex-1 truncate">{item.name}</span>
            <Figure amount={item.total} currency={currency} size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
