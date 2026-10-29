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
import { AuthShell, FormError, passwordRules } from '@/features/auth/auth-shell';
import { useAuth } from '@/features/auth/auth-context';
import { apiPost, ApiRequestError } from '@/lib/api-client';

const schema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Enter your full name')
      .max(160, 'That name is too long'),
    password: z
      .string()
      .min(passwordRules.min, `Password must be at least ${passwordRules.min} characters`)
      .max(128, 'Password must be at most 128 characters')
      .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter')
      .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter')
      .refine((v) => /[0-9]/.test(v), 'Password must contain a digit'),
    confirmPassword: z.string().min(1, 'Re-enter the password'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match',
  });

type FormValues = z.infer<typeof schema>;

/**
 * Where an invited partner lands.
 *
 * This is the only route by which a second account joins the company — there is
 * no public sign-up. Accepting returns a full session (access token in the body,
 * refresh token as an HttpOnly cookie), so the user goes straight to the
 * dashboard rather than being bounced to the sign-in page to type the password
 * they just chose.
 */
export default function AcceptInvitePage() {
  return (
    <React.Suspense fallback={<AuthShell title="Join your company">{null}</AuthShell>}>
      <AcceptInviteForm />
    </React.Suspense>
  );
}

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { refreshSession } = useAuth();

  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    if (!token) return;
    setFormError(null);
    try {
      await apiPost('/auth/accept-invite', {
        token,
        fullName: values.fullName,
        password: values.password,
      });

      // The invite response already set the refresh cookie. Rebuilding the
      // session through the normal path keeps one code path for "how a session
      // starts" instead of two.
      await refreshSession();
      router.replace('/dashboard');
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError
          ? error.message
          : 'Could not accept the invitation. Ask for a fresh invite link.',
      );
    }
  }

  if (!token) {
    return (
      <AuthShell
        title="That invitation link is incomplete"
        description="The link is missing its token. Ask the company owner to send a new one — invites expire after 72 hours."
        footer={
          <Link href="/login" className="underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        }
      >
        {null}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Join your company"
      description="Set a password to activate your partner account."
      footer={
        <>
          Already set up?{' '}
          <Link href="/login" className="underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormError message={formError} />

        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            type="text"
            autoComplete="name"
            autoFocus
            aria-invalid={Boolean(errors.fullName)}
            aria-describedby={errors.fullName ? 'fullName-error' : undefined}
            {...register('fullName')}
          />
          {errors.fullName ? (
            <p id="fullName-error" className="text-xs text-[hsl(var(--loss))]">
              {errors.fullName.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'password-error' : 'password-hint'}
            {...register('password')}
          />
          {errors.password ? (
            <p id="password-error" className="text-xs text-[hsl(var(--loss))]">
              {errors.password.message}
            </p>
          ) : (
            <p id="password-hint" className="text-xs text-muted-foreground">
              {passwordRules.hint}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
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
          Activate my account
        </Button>
      </form>
    </AuthShell>
  );
}
