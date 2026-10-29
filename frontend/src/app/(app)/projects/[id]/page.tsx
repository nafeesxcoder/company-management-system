'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Figure, LedgerRow } from '@/components/money';
import { DateRangePicker, type DateRangeValue } from '@/components/date-range-picker';
import { ErrorState, LoadingBlock, PageHeading } from '@/components/states';
import { useAuth } from '@/features/auth/auth-context';
import { useProject, useTransactions, useExpenses } from '@/services/queries';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, humanize } from '@/lib/utils';

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { activeCompany } = useAuth();
  const currency = activeCompany?.baseCurrency ?? 'INR';

  const [range, setRange] = React.useState<DateRangeValue>({ preset: 'thisYear' });
  const { data, isLoading, isError, error, refetch } = useProject(projectId, range);

  const { data: transactions } = useTransactions({ projectId, pageSize: 10 });
  const { data: expenses } = useExpenses({ projectId, pageSize: 10 });

  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <LoadingBlock label="Loading project" />;

  const { project, financials } = data;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link href="/projects">
          <ArrowLeft />
          All projects
        </Link>
      </Button>

      <PageHeading
        title={project.name}
        description={project.description ?? undefined}
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge variant="outline">{project.code}</Badge>
        <Badge variant={project.status === 'ACTIVE' ? 'gain' : 'default'}>{humanize(project.status)}</Badge>
        <Badge variant="outline">{humanize(project.type)}</Badge>
        <Badge variant="outline">{humanize(project.revenueModel)}</Badge>
        {project.projectUrl ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={project.projectUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink />
              Visit site
            </a>
          </Button>
        ) : null}
        {project.repositoryUrl ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={project.repositoryUrl} target="_blank" rel="noreferrer noopener">
              <GitBranch />
              Repository
            </a>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Money</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3">
              <Figure amount={financials.netProfit} currency={currency} size="lg" tone="signed" />
              <span className="text-sm text-muted-foreground">net profit this period</span>
            </div>

            <LedgerRow label="Gross revenue" amount={financials.grossRevenue} currency={currency} />
            <LedgerRow label="Refunds" amount={financials.totalRefunds} currency={currency} tone="muted" />
            <LedgerRow label="Net revenue" amount={financials.netRevenue} currency={currency} />
            <LedgerRow label="Processing fees" amount={financials.processingFees} currency={currency} tone="muted" />
            <LedgerRow label="Expenses" amount={financials.eligibleExpenses} currency={currency} tone="muted" />
            <LedgerRow
              label="Net profit"
              amount={financials.netProfit}
              currency={currency}
              tone="signed"
              emphasis
            />

            {financials.unconvertedRecords > 0 ? (
              <p className="mt-3 text-xs text-[hsl(var(--pending))]">
                {financials.unconvertedRecords} record(s) excluded — no exchange rate recorded.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>At a glance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Detail label="Awaiting payment">
              <Figure amount={financials.pendingPayments} currency={currency} size="sm" />
            </Detail>
            <Detail label="Payments recorded">{financials.transactionCount}</Detail>
            <Detail label="Expenses recorded">{financials.expenseCount}</Detail>
            <Detail label="Currency">{project.currency}</Detail>
            <Detail label="Launched">{formatDate(project.launchDate)}</Detail>
            <Detail label="Registered">{formatDate(project.createdAt)}</Detail>
            {project.createdBy ? <Detail label="Added by">{project.createdBy.fullName}</Detail> : null}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent payments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!transactions || transactions.items.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.items.map((txn) => (
                    <TableRow key={txn.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(txn.occurredAt)}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {txn.description ?? humanize(txn.type)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Figure amount={txn.netAmount} currency={txn.currency} size="sm" />
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
            <CardTitle>Recent expenses</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!expenses || expenses.items.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No expenses recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.items.map((expense) => (
                    <TableRow key={expense.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(expense.expenseDate)}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">{expense.vendor}</TableCell>
                      <TableCell className="text-right">
                        <Figure amount={expense.totalAmount} currency={expense.currency} size="sm" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
