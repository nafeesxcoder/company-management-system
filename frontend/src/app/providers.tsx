'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/features/auth/auth-context';
import { ToastContextProvider } from '@/hooks/use-toast';
import { ApiRequestError } from '@/lib/api-client';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              // Never retry a rejection the server meant: auth, permissions,
              // validation. Only transient failures are worth another attempt.
              if (error instanceof ApiRequestError) {
                if (error.status >= 400 && error.status < 500) return false;
              }
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <ToastContextProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastContextProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
