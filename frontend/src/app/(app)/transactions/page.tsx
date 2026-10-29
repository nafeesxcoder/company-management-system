'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Download, Search, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
import { EmptyState, ErrorState, NoResults, PageHeading, Pagination, TableSkeleton } from '@/components/states';
import { useAuth } from '@/features/auth/auth-context';
import {
  useAssignProject,
  useCreateRefund,
  useProjects,
  useTransactions,
} from '@/services/queries';
import { useToast } from '@/hooks/use-toast';
import { apiDownload } from '@/lib/api-client';
import { formatDate, humanize } from '@/lib/utils';
import type { Transaction, TransactionStatus } from '@/types/api';

const STATUS_LABELS: Record<TransactionStatus, { label: string; variant: 'default' | 'gain' | 'loss' | 'pending' | 'outline' }> = {
  SUCCEEDED: { label: 'Received', variant: 'gain' },
  PENDING: { label: 'Awaiting', variant: 'pending' },
  FAILED: { label: 'Failed', variant: 'outline' },
  CANCELED: { label: 'Canceled', variant: 'outline' },
  REFUNDED: { label: 'Refunded', variant: 'loss' },
  PARTIALLY_REFUNDED: { label: 'Part refunded', variant: 'loss' },
  DISPUTED: { label: 'Disputed', variant: 'loss' },
};

export default function TransactionsPage() {
  const searchParams = useSearchParams();
  const { activeCompany, canWrite } = useAuth();
  const { toast, toastError } = useToast();
  const currency = activeCompany?.baseCurrency ?? 'INR';

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [status, setStatus] = React.useState<string>('all');
  const [reviewStatus, setReviewStatus] = React.useState<string>(
    searchParams.get('reviewStatus') ?? 'all',
  );

  const [refundTarget, setRefundTarget] = React.useState<Transaction | null>(null);
  const [assignTarget, setAssignTarget] = React.useState<Transaction | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useTransactions({
    page,
    pageSize: 25,
    search: debouncedSearch || undefined,
    status: status === 'all' ? undefined : status,
    reviewStatus: reviewStatus === 'all' ? undefined : reviewStatus,
  });

  const hasFilters = Boolean(debouncedSearch) || status !== 'all' || reviewStatus !== 'all';

  async function handleExport() {
    try {
      await apiDownload('/reports/export/transactions?preset=allTime', 'transactions.csv');
      toast({ title: 'Export downloaded', variant: 'success' });
    } catch (err) {
      toastError(err, 'Could not export');
    }
  }

  return (
    <>
      <PageHeading
        title="Transactions"
        description="Every payment recorded, whether entered by hand or received from a provider."
        actions={
          <Button variant="outline" size="sm" onClick={() => void handleExport()}>
            <Download />
            Export CSV
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              className="pl-9"
              placeholder="Search description, customer or reference"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search transactions"
            />
          </div>

          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[170px]" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, meta]) => (
                <SelectItem key={value} value={value}>
                  {meta.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={reviewStatus}
            onValueChange={(value) => {
              setReviewStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[190px]" aria-label="Filter by review state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All payments</SelectItem>
              <SelectItem value="NEEDS_REVIEW">Needs a project</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <TableSkeleton />
      ) : data && data.items.length === 0 ? (
        hasFilters ? (
          <NoResults
            onClear={() => {
              setSearch('');
              setStatus('all');
              setReviewStatus('all');
            }}
          />
        ) : (
          <EmptyState
            title="No transactions yet"
            description="Record income by hand, or connect a payment provider so payments arrive here automatically."
            action={
              <Button size="sm" asChild>
                <Link href="/income">Record income</Link>
              </Button>
            }
          />
        )
      ) : data ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  {canWrite ? <TableHead className="w-10" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((txn) => (
                  <TableRow key={txn.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(txn.occurredAt)}
                    </TableCell>
                    <TableCell>
                      {txn.project ? (
                        <Link
                          href={`/projects/${txn.project.id}`}
                          className="text-sm underline-offset-2 hover:underline"
                        >
                          {txn.project.name}
                        </Link>
                      ) : (
                        <button
                          onClick={() => setAssignTarget(txn)}
                          className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--pending))] underline-offset-2 hover:underline"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                          Assign a project
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-sm">
                      {txn.description ?? txn.customerReference ?? humanize(txn.type)}
                      {txn.source === 'AUTOMATED' ? (
                        <Badge variant="outline" className="ml-2">
                          Auto
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_LABELS[txn.status].variant}>
                        {STATUS_LABELS[txn.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Figure amount={txn.grossAmount} currency={txn.currency} size="sm" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Figure amount={txn.netAmount} currency={txn.currency} size="sm" />
                    </TableCell>
                    {canWrite ? (
                      <TableCell>
                        {Number(txn.refundableRemaining) > 0 ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setRefundTarget(txn)}
                            aria-label={`Refund ${txn.description ?? 'transaction'}`}
                            title="Record a refund"
                          >
                            <Undo2 />
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="px-4">
              <Pagination
                page={data.meta.page}
                totalPages={data.meta.totalPages}
                totalItems={data.meta.totalItems}
                onPageChange={setPage}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <RefundDialog
        transaction={refundTarget}
        onClose={() => setRefundTarget(null)}
        baseCurrency={currency}
      />
      <AssignProjectDialog transaction={assignTarget} onClose={() => setAssignTarget(null)} />
    </>
  );
}

function RefundDialog({
  transaction,
  onClose,
  baseCurrency,
}: {
  transaction: Transaction | null;
  onClose: () => void;
  baseCurrency: string;
}) {
  const { toast, toastError } = useToast();
  const createRefund = useCreateRefund();
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (transaction) {
      setAmount(transaction.refundableRemaining);
      setReason('');
    }
  }, [transaction]);

  if (!transaction) return null;

  const remaining = Number(transaction.refundableRemaining);
  const entered = Number(amount || '0');
  const tooMuch = entered > remaining;

  async function submit() {
    if (!transaction) return;
    try {
      await createRefund.mutateAsync({
        transactionId: transaction.id,
        amount,
        ...(reason ? { reason } : {}),
      });
      toast({ title: 'Refund recorded', variant: 'success' });
      onClose();
    } catch (error) {
      toastError(error, 'Could not record the refund');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a refund</DialogTitle>
          <DialogDescription>
            Up to{' '}
            <Figure amount={transaction.refundableRemaining} currency={transaction.currency} size="sm" />{' '}
            is still refundable on this payment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="refund-amount">Refund amount</Label>
            <MoneyInput
              id="refund-amount"
              currency={transaction.currency}
              value={amount}
              onChange={setAmount}
            />
            {tooMuch ? (
              <p className="text-xs text-[hsl(var(--loss))]">
                That is more than the amount still refundable.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">Reason (optional)</Label>
            <Input
              id="refund-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Customer downgraded"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={createRefund.isPending}
            disabled={!amount || entered <= 0 || tooMuch}
          >
            Record refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignProjectDialog({
  transaction,
  onClose,
}: {
  transaction: Transaction | null;
  onClose: () => void;
}) {
  const { toast, toastError } = useToast();
  const assign = useAssignProject();
  const { data: projects } = useProjects({ pageSize: 200 });
  const [projectId, setProjectId] = React.useState('');

  React.useEffect(() => {
    if (transaction) setProjectId('');
  }, [transaction]);

  if (!transaction) return null;

  async function submit() {
    if (!transaction) return;
    try {
      await assign.mutateAsync({ id: transaction.id, projectId });
      toast({ title: 'Payment assigned', variant: 'success' });
      onClose();
    } catch (error) {
      toastError(error, 'Could not assign the payment');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign this payment to a project</DialogTitle>
          <DialogDescription>
            {transaction.reviewNote ??
              'This payment arrived without enough information to match it to a project automatically.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="assign-project">Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="assign-project">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {(projects?.items ?? []).map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name} · {project.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            To stop this recurring, map the provider&apos;s product to a project under Payments.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={assign.isPending} disabled={!projectId}>
            Assign project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
