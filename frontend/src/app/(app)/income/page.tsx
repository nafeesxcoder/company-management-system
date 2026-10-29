'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MoneyInput } from '@/components/money-input';
import { PageHeading, ReadOnlyNotice } from '@/components/states';
import { useAuth } from '@/features/auth/auth-context';
import { useCreateTransaction, useProjects } from '@/services/queries';
import { useToast } from '@/hooks/use-toast';
import { ApiRequestError } from '@/lib/api-client';
import { todayInTimezone } from '@/lib/utils';

const TRANSACTION_TYPES = [
  { value: 'MANUAL_ENTRY', label: 'Manual entry' },
  { value: 'ONE_TIME_PAYMENT', label: 'One-time customer payment' },
  { value: 'SUBSCRIPTION_RENEWAL', label: 'Subscription renewal' },
  { value: 'IN_APP_PURCHASE', label: 'In-app purchase' },
  { value: 'MILESTONE_PAYMENT', label: 'Client milestone' },
  { value: 'ADVERTISING_PAYOUT', label: 'Advertising payout' },
  { value: 'OTHER', label: 'Other' },
];

const PROVIDERS = [
  { value: 'MANUAL_BANK', label: 'Bank transfer' },
  { value: 'STRIPE', label: 'Stripe' },
  { value: 'RAZORPAY', label: 'Razorpay' },
  { value: 'GOOGLE_PLAY', label: 'Google Play' },
  { value: 'OTHER', label: 'Other' },
];

const STATUSES = [
  { value: 'SUCCEEDED', label: 'Received' },
  { value: 'PENDING', label: 'Awaiting payment' },
  { value: 'FAILED', label: 'Failed' },
];

const schema = z
  .object({
    projectId: z.string().uuid('Choose which project this income belongs to'),
    grossAmount: z
      .string()
      .min(1, 'Enter the amount received')
      .regex(/^\d+(\.\d{1,4})?$/, 'Enter a valid amount')
      .refine((v) => Number(v) > 0, 'Amount must be more than zero'),
    feeAmount: z.string().regex(/^\d*(\.\d{1,4})?$/, 'Enter a valid fee').optional(),
    currency: z.string().length(3),
    exchangeRateToBase: z.string().optional(),
    type: z.string(),
    status: z.string(),
    provider: z.string(),
    occurredAt: z.string().min(1, 'Choose the date this was paid'),
    customerReference: z.string().max(191).optional(),
    externalTransactionId: z.string().max(191).optional(),
    description: z.string().max(500).optional(),
  })
  .refine((v) => !v.feeAmount || Number(v.feeAmount) <= Number(v.grossAmount), {
    message: 'The fee cannot be more than the amount received',
    path: ['feeAmount'],
  });

type FormValues = z.infer<typeof schema>;

/**
 * Record income by hand.
 *
 * This is the path for projects with no payment gateway, for bank transfers
 * and for client milestones. Everything else arrives through a verified
 * webhook and appears in Transactions without anyone typing it.
 */
export default function IncomePage() {
  const { activeCompany, canWrite } = useAuth();
  const { toast, toastError } = useToast();
  const baseCurrency = activeCompany?.baseCurrency ?? 'INR';
  const timezone = activeCompany?.timezone ?? 'Asia/Kolkata';

  const { data: projects } = useProjects({ pageSize: 200, status: 'ACTIVE' });
  const createTransaction = useCreateTransaction();

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      currency: baseCurrency,
      type: 'MANUAL_ENTRY',
      status: 'SUCCEEDED',
      provider: 'MANUAL_BANK',
      feeAmount: '0',
      occurredAt: todayInTimezone(timezone),
    },
  });

  const currency = watch('currency');
  const needsRate = currency !== baseCurrency;

  async function onSubmit(values: FormValues) {
    try {
      await createTransaction.mutateAsync({
        projectId: values.projectId,
        grossAmount: values.grossAmount,
        feeAmount: values.feeAmount || '0',
        currency: values.currency,
        ...(needsRate && values.exchangeRateToBase
          ? { exchangeRateToBase: values.exchangeRateToBase }
          : {}),
        type: values.type,
        status: values.status,
        provider: values.provider,
        occurredAt: new Date(`${values.occurredAt}T12:00:00`).toISOString(),
        ...(values.customerReference ? { customerReference: values.customerReference } : {}),
        ...(values.externalTransactionId
          ? { externalTransactionId: values.externalTransactionId }
          : {}),
        ...(values.description ? { description: values.description } : {}),
      });

      toast({ title: 'Income recorded', variant: 'success' });
      reset({
        currency: baseCurrency,
        type: values.type,
        status: 'SUCCEEDED',
        provider: values.provider,
        feeAmount: '0',
        occurredAt: values.occurredAt,
        projectId: values.projectId,
      });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        // Put field-level problems on the fields that caused them.
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof FormValues, { message });
        }
        if (Object.keys(error.fieldErrors).length === 0) toastError(error, 'Could not record income');
        return;
      }
      toastError(error, 'Could not record income');
    }
  }

  if (!canWrite) {
    return (
      <>
        <PageHeading title="Record income" />
        <ReadOnlyNotice action="record income" />
      </>
    );
  }

  return (
    <>
      <PageHeading
        title="Record income"
        description="For bank transfers, client milestones and any project without a payment gateway."
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Payment details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <Field label="Project" error={errors.projectId?.message} htmlFor="projectId" required>
              <Controller
                control={control}
                name="projectId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="projectId" aria-invalid={Boolean(errors.projectId)}>
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
                )}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount received" error={errors.grossAmount?.message} htmlFor="grossAmount" required>
                <Controller
                  control={control}
                  name="grossAmount"
                  render={({ field }) => (
                    <MoneyInput
                      id="grossAmount"
                      currency={currency}
                      value={field.value}
                      onChange={field.onChange}
                      aria-invalid={Boolean(errors.grossAmount)}
                    />
                  )}
                />
              </Field>

              <Field
                label="Processing fee"
                hint="deducted once, here"
                error={errors.feeAmount?.message}
                htmlFor="feeAmount"
              >
                <Controller
                  control={control}
                  name="feeAmount"
                  render={({ field }) => (
                    <MoneyInput
                      id="feeAmount"
                      currency={currency}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency" htmlFor="currency">
                <Input id="currency" maxLength={3} className="uppercase" {...register('currency')} />
              </Field>

              <Field label="Date paid" error={errors.occurredAt?.message} htmlFor="occurredAt" required>
                <Input id="occurredAt" type="date" {...register('occurredAt')} />
              </Field>
            </div>

            {needsRate ? (
              <Field
                label={`Exchange rate to ${baseCurrency}`}
                hint={`1 ${currency} = ? ${baseCurrency}`}
                error={errors.exchangeRateToBase?.message}
                htmlFor="exchangeRateToBase"
                required
              >
                <Input
                  id="exchangeRateToBase"
                  inputMode="decimal"
                  placeholder="83.25"
                  className="figure"
                  {...register('exchangeRateToBase')}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Required for a currency other than {baseCurrency}. Without a rate this payment is
                  left out of company totals rather than guessed at.
                </p>
              </Field>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Type" htmlFor="type">
                <Controller
                  control={control}
                  name="type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSACTION_TYPES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="Paid via" htmlFor="provider">
                <Controller
                  control={control}
                  name="provider"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVIDERS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="Status" htmlFor="status">
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer reference" hint="optional" htmlFor="customerReference">
                <Input id="customerReference" {...register('customerReference')} />
              </Field>

              <Field label="Provider reference" hint="optional" htmlFor="externalTransactionId">
                <Input
                  id="externalTransactionId"
                  placeholder="UTR / payment id"
                  {...register('externalTransactionId')}
                />
              </Field>
            </div>

            <Field label="Note" hint="optional" htmlFor="description">
              <Textarea id="description" rows={2} {...register('description')} />
            </Field>

            <div className="flex gap-2 pt-1">
              <Button type="submit" loading={isSubmitting}>
                <Plus />
                Record income
              </Button>
              <Button type="button" variant="ghost" onClick={() => reset()}>
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {hint ? <span className="ml-1.5 font-normal text-muted-foreground">({hint})</span> : null}
        {required ? <span className="ml-0.5 text-[hsl(var(--loss))]">*</span> : null}
      </Label>
      {children}
      {error ? <p className="text-xs text-[hsl(var(--loss))]">{error}</p> : null}
    </div>
  );
}
