'use client';

import * as React from 'react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { ApiRequestError } from '@/lib/api-client';

type ToastVariant = 'default' | 'success' | 'destructive';

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (item: { title: string; description?: string; variant?: ToastVariant }) => void;
  /** Turns any thrown error into a readable message, never a raw stack. */
  toastError: (error: unknown, fallbackTitle?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastContextProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const toast = React.useCallback(
    ({ title, description, variant = 'default' }: { title: string; description?: string; variant?: ToastVariant }) => {
      const id = Math.random().toString(36).slice(2);
      setItems((current) => [...current, { id, title, description, variant }]);
    },
    [],
  );

  const toastError = React.useCallback(
    (error: unknown, fallbackTitle = 'Something went wrong') => {
      if (error instanceof ApiRequestError) {
        // Field-level validation errors belong on the form, not in a toast.
        const fieldMessages = Object.values(error.fieldErrors);
        toast({
          title: error.message || fallbackTitle,
          description: fieldMessages.length > 0 ? fieldMessages.join(' ') : undefined,
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: fallbackTitle,
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
    [toast],
  );

  const dismiss = React.useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = React.useMemo(() => ({ toast, toastError }), [toast, toastError]);

  return (
    <ToastContext.Provider value={value}>
      <ToastProvider duration={5000}>
        {children}
        {items.map((item) => (
          <Toast
            key={item.id}
            variant={item.variant}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
          >
            <div className="grid gap-1">
              <ToastTitle>{item.title}</ToastTitle>
              {item.description ? <ToastDescription>{item.description}</ToastDescription> : null}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastContextProvider');
  return context;
}
