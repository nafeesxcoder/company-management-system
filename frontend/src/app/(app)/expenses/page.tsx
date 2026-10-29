'use client';

import * as React from 'react';
import { Download, Plus, Search } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
import { useCreateExpense, useExpenseCategories, useExpenses, useProjects } from '@/services/queries';
import { useToast } from '@/hooks/use-toast';
import { ApiRequestError, apiDownload } from '@/lib/api-client';
import { formatDate, humanize, todayInTimezone } from '@/lib/utils';

const PAYMENT_STATUSES = ['PAID', 'PENDING', 'OVERDUE', 'CANCELED'] as const;

const STATUS_VARIANTS: Record<string, 'gain' | 'pending' | 'loss' | 'outline'> = {
  PAID: 'gain',
  PENDING: 'pending',
  OVERDUE: 'loss',
  CANCELED: 'outline',
};

export default function ExpensesPage() {
  const { canWrite, activeCompany } = useAuth();
  const { toast, toastError } = useToast();

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('all');
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useExpenses({
    page,
    pageSize: 25,
    search: debounced || undefined,
    categoryId: categoryId === 'all' ? undefined : categoryId,
  });
  const { data: categories } = useExpenseCategories();

  async function handleExport() {
    try {
      await apiDownload('/reports/export/expenses?preset=allTime', 'expenses.csv');
      toast({ title: 'Export downloaded', variant: 'success' });
    } catch (err) {
      toastError(err, 'Could not export');
    }
  }

  return (
    <>
      <PageHeading
        title="Expenses"
        description="Hosting, domains, advertising, contractor payments — everything that reduces profit."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void handleExport()}>
              <Download />
              Export CSV
            </Button>
            {canWrite ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus />
                Add an expense
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              className="pl-9"
              placeholder="Search vendor or note"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search expenses"
            />
          </div>

          <Select value={categoryId} onValueChange={(value) => { setCategoryId(value); setPage(1); }}>
            <SelectTrigger className="w-[200px]" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {(categories ?? []).map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <TableSkeleton columns={5} />
      ) : data && data.items.length === 0 ? (
        debounced || categoryId !== 'all' ? (
          <NoResults onClear={() => { setSearch(''); setCategoryId('all'); }} />
        ) : (
          <EmptyState
            title="No expenses recorded"
            description="Without costs, the dashboard shows revenue rather than profit. Add your hosting, domains and tools."
            action={
              canWrite ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  Add an expense
                </Button>
              ) : undefined
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
                  <TableHead>Vendor</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(expense.expenseDate)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {expense.vendor}
                      {expense.excludeFromProfit ? (
                        <Badge variant="outline" className="ml-2" title="Recorded but not counted toward profit">
                          Not in profit
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        {expense.category.color ? (
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ background: expense.category.color }}
                            aria-hidden
                          />
                        ) : null}
                        {expense.category.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {expense.project?.name ?? 'Company-wide'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[expense.paymentStatus] ?? 'default'}>
                        {humanize(expense.paymentStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Figure amount={expense.totalAmount} currency={expense.currency} size="sm" />
                    </TableCell>
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

      {createOpen ? (
        <CreateExpenseDialog
          onClose={() => setCreateOpen(false)}
          baseCurrency={activeCompany?.baseCurrency ?? 'INR'}
          timezone={activeCompany?.timezone ?? 'Asia/Kolkata'}
        />
      ) : null}
    </>
  );
}

const expenseSchema = z.object({
  categoryId: z.string().uuid('Choose a category'),
  projectId: z.string().optional(),
  vendor: z.string().min(1, 'Who was paid?').max(160),
  amount: z
    .string()
    .min(1, 'Enter the amount')
    .regex(/^\d+(\.\d{1,4})?$/, 'Enter a valid amount')
    .refine((v) => Number(v) > 0, 'Amount must be more than zero'),
  taxAmount: z.string().regex(/^\d*(\.\d{1,4})?$/, 'Enter a valid tax amount').optional(),
  currency: z.string().length(3),
  exchangeRateToBase: z.string().optional(),
  expenseDate: z.string().min(1, 'Choose the date'),
  paymentStatus: z.string(),
  excludeFromProfit: z.boolean(),
  notes: z.string().max(5000).optional(),
});

type ExpenseValues = z.infer<typeof expenseSchema>;

function CreateExpenseDialog({
  onClose,
  baseCurrency,
  timezone,
}: {
  onClose: () => void;
  baseCurrency: string;
  timezone: string;
}) {
  const { toast, toastError } = useToast();
  const createExpense = useCreateExpense();
  const { data: categories } = useExpenseCategories();
  const { data: projects } = useProjects({ pageSize: 200 });

  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      currency: baseCurrency,
      taxAmount: '0',
      paymentStatus: 'PAID',
      excludeFromProfit: false,
      expenseDate: todayInTimezone(timezone),
      projectId: 'company-wide',
    },
  });

  const currency = watch('currency');
  const needsRate = currency !== baseCurrency;

  async function onSubmit(values: ExpenseValues) {
    try {
      await createExpense.mutateAsync({
        categoryId: values.categoryId,
        ...(values.projectId && values.projectId !== 'company-wide'
          ? { projectId: values.projectId }
          : {}),
        vendor: values.vendor,
        amount: values.amount,
        taxAmount: values.taxAmount || '0',
        currency: values.currency.toUpperCase(),
        ...(needsRate && values.exchangeRateToBase
          ? { exchangeRateToBase: values.exchangeRateToBase }
          : {}),
        expenseDate: values.expenseDate,
        paymentStatus: values.paymentStatus,
        excludeFromProfit: values.excludeFromProfit,
        ...(values.notes ? { notes: values.notes } : {}),
      });
      toast({ title: 'Expense added', variant: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof ExpenseValues, { message });
        }
        if (Object.keys(error.fieldErrors).length > 0) return;
      }
      toastError(error, 'Could not add the expense');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add an expense</DialogTitle>
          <DialogDescription>
            Leave the project as company-wide for overheads that are not tied to one product.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vendor">Paid to</Label>
              <Input id="vendor" autoFocus placeholder="AWS" {...register('vendor')} />
              {errors.vendor ? (
                <p className="text-xs text-[hsl(var(--loss))]">{errors.vendor.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="categoryId">Category</Label>
              <Controller
                control={control}
                name="categoryId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="categoryId">
                      <SelectValue placeholder="Choose a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {(categories ?? []).map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.categoryId ? (
                <p className="text-xs text-[hsl(var(--loss))]">{errors.categoryId.message}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="projectId">Project</Label>
            <Controller
              control={control}
              name="projectId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="projectId">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company-wide">Company-wide overhead</SelectItem>
                    {(projects?.items ?? []).map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name} · {project.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount</Label>
              <Controller
                control={control}
                name="amount"
                render={({ field }) => (
                  <MoneyInput id="amount" currency={currency} value={field.value} onChange={field.onChange} />
                )}
              />
              {errors.amount ? (
                <p className="text-xs text-[hsl(var(--loss))]">{errors.amount.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="taxAmount">Tax</Label>
              <Controller
                control={control}
                name="taxAmount"
                render={({ field }) => (
                  <MoneyInput id="taxAmount" currency={currency} value={field.value} onChange={field.onChange} />
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" maxLength={3} className="uppercase" {...register('currency')} />
            </div>
          </div>

          {needsRate ? (
            <div className="space-y-1.5">
              <Label htmlFor="exchangeRateToBase">Exchange rate to {baseCurrency}</Label>
              <Input
                id="exchangeRateToBase"
                inputMode="decimal"
                className="figure"
                placeholder="83.25"
                {...register('exchangeRateToBase')}
              />
              <p className="text-xs text-muted-foreground">
                Required for a currency other than {baseCurrency}, otherwise this expense is left out
                of company totals.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="expenseDate">Date</Label>
              <Input id="expenseDate" type="date" {...register('expenseDate')} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paymentStatus">Status</Label>
              <Controller
                control={control}
                name="paymentStatus"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="paymentStatus">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_STATUSES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {humanize(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-md border border-border p-3">
            <Controller
              control={control}
              name="excludeFromProfit"
              render={({ field }) => (
                <Switch
                  id="excludeFromProfit"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  className="mt-0.5"
                />
              )}
            />
            <div className="space-y-0.5">
              <Label htmlFor="excludeFromProfit">Already counted elsewhere</Label>
              <p className="text-xs text-muted-foreground">
                Turn this on for a payment gateway fee. Fees are already deducted on the transaction,
                so counting them here too would understate profit.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Note (optional)</Label>
            <Textarea id="notes" rows={2} {...register('notes')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Add expense
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
