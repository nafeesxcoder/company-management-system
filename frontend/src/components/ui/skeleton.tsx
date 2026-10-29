import { cn } from '@/lib/utils';

/** Loading placeholder. Sized to the content it replaces so nothing jumps. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-secondary', className)} {...props} />;
}
