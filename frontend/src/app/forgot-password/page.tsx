'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell, FormError, FormNotice } from '@/features/auth/auth-shell';
import { apiPost, ApiRequestError } from '@/lib/api-client';

const schema = z.object({
  email: z.string().min(1, 'Enter your email address').email('Enter a valid email address'),
});

type FormValues = z.infer<typeof schema>;

/**
 * The API answers identically whether or not the address has an account, so
 * this page shows the same confirmation either way. Outside production the API
 * also returns the reset link itself (email delivery is not wired up yet) —
 * when it does, we show it, because silently dropping it would leave the
 * developer with no way to continue the flow.
 */
interface ForgotPasswordResponse {
  message: string;
  /** Present only when NODE_ENV !== 'production' on the API. */
  devResetToken?: string;
}

export default function ForgotPasswordPage() {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<ForgotPasswordResponse | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      const result = await apiPost<ForgotPasswordResponse>('/auth/forgot-password', {
        email: values.email,
      });
      setSent(result ?? { message: 'If an account exists for that address, a reset link has been sent.' });
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError
          ? error.message
          : 'Could not send the reset link. Check your connection and try again.',
      );
    }
  }

  if (sent) {
    const devLink = sent.devResetToken
      ? `/reset-password?token=${encodeURIComponent(sent.devResetToken)}`
      : null;

    return (
      <AuthShell
        title="Check your email"
        description="If an account exists for that address, a reset link is on its way."
        footer={
          <Link href="/login" className="underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="space-y-4">
          <FormNotice>
            The link expires in one hour and can be used once. Resetting a password signs that
            account out everywhere.
          </FormNotice>

          {devLink ? (
            <div className="space-y-2 rounded-md border border-dashed border-border px-3 py-3">
              <p className="text-xs font-medium">Development mode</p>
              <p className="text-xs text-muted-foreground">
                Email delivery is not configured, so the API returned the link directly. This does
                not happen in production.
              </p>
              <Link
                href={devLink}
                className="block break-all font-mono text-xs text-primary underline-offset-2 hover:underline"
              >
                {devLink}
              </Link>
            </div>
          ) : null}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="We'll send a one-time link to the address on your account."
      footer={
        <Link href="/login" className="underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormError message={formError} />

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          {errors.email ? (
            <p id="email-error" className="text-xs text-[hsl(var(--loss))]">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
