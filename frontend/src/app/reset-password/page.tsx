'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell, FormError, FormNotice, passwordRules } from '@/features/auth/auth-shell';
import { apiPost, ApiRequestError } from '@/lib/api-client';

const schema = z
  .object({
    newPassword: z
      .string()
      .min(passwordRules.min, `Password must be at least ${passwordRules.min} characters`)
      .max(128, 'Password must be at most 128 characters')
      .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter')
      .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter')
      .refine((v) => /[0-9]/.test(v), 'Password must contain a digit'),
    confirmPassword: z.string().min(1, 'Re-enter the new password'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match',
  });

type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <React.Suspense fallback={<AuthShell title="Choose a new password">{null}</AuthShell>}>
      <ResetPasswordForm />
    </React.Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [formError, setFormError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    if (!token) return;
    setFormError(null);
    try {
      await apiPost('/auth/reset-password', { token, newPassword: values.newPassword });
      setDone(true);
      // Give the confirmation a moment to be read before moving on.
      setTimeout(() => router.replace('/login'), 2500);
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError
          ? error.message
          : 'Could not reset the password. Request a new link and try again.',
      );
    }
  }

  // A link with no token is not worth a form — say so plainly.
  if (!token) {
    return (
      <AuthShell
        title="That link is incomplete"
        description="The reset link is missing its token. It may have been truncated by your email client."
        footer={
          <Link href="/login" className="underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password changed" description="You can sign in with your new password.">
        <div className="space-y-4">
          <FormNotice>
            Every other session for this account has been signed out. Taking you to sign in…
          </FormNotice>
          <Button asChild className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      description={passwordRules.hint}
      footer={
        <Link href="/login" className="underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormError message={formError} />

        <div className="space-y-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            autoFocus
            aria-invalid={Boolean(errors.newPassword)}
            aria-describedby={errors.newPassword ? 'newPassword-error' : undefined}
            {...register('newPassword')}
          />
          {errors.newPassword ? (
            <p id="newPassword-error" className="text-xs text-[hsl(var(--loss))]">
              {errors.newPassword.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
            {...register('confirmPassword')}
          />
          {errors.confirmPassword ? (
            <p id="confirmPassword-error" className="text-xs text-[hsl(var(--loss))]">
              {errors.confirmPassword.message}
            </p>
          ) : null}
        </div>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Set new password
        </Button>
      </form>
    </AuthShell>
  );
}
