'use client';

import * as React from 'react';

/**
 * The frame shared by every unauthenticated page (sign in, password reset,
 * invitation). Keeping it in one place means the four public pages cannot
 * drift apart visually, and the wordmark is defined once.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <span className="flex items-baseline gap-1.5">
            <span className="font-figure text-2xl font-semibold tracking-tight">Ledger</span>
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
          </span>
          <h1 className="mt-6 font-figure text-xl font-semibold">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>

        {children}

        {footer ? <div className="mt-6 text-xs text-muted-foreground">{footer}</div> : null}
      </div>
    </main>
  );
}

/** A form-level error, styled consistently across the public pages. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-[hsl(var(--loss))]"
    >
      {message}
    </div>
  );
}

/** A success / confirmation panel. */
export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-md border border-[hsl(var(--profit))]/30 bg-[hsl(var(--profit))]/5 px-3 py-2 text-sm"
    >
      {children}
    </div>
  );
}

/**
 * Password rules, mirrored from the API's `passwordSchema`.
 *
 * Duplicated deliberately: the client copy exists to give immediate feedback,
 * the server copy is the one that decides. If they ever disagree the server
 * wins and its message is surfaced on the field.
 */
export const passwordRules = {
  min: 12,
  test: (value: string) =>
    value.length >= 12 &&
    value.length <= 128 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value),
  hint: 'At least 12 characters, with an uppercase letter, a lowercase letter and a digit.',
};
