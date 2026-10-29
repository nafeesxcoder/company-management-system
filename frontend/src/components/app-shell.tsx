'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ArrowLeftRight,
  Building2,
  ChevronDown,
  FileText,
  LayoutGrid,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Plug,
  Receipt,
  ScrollText,
  Settings,
  Split,
  Sun,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, initials } from '@/lib/utils';

/**
 * App shell: a narrow fixed rail on desktop, a slide-over on mobile.
 *
 * Navigation is grouped by the question each section answers rather than by
 * database table — "what came in", "what went out", "what's ours".
 */

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Money',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutGrid },
      { href: '/income', label: 'Income', icon: TrendingUp },
      { href: '/expenses', label: 'Expenses', icon: Receipt },
      { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Work',
    items: [
      { href: '/projects', label: 'Projects', icon: Building2 },
      { href: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Partners',
    items: [
      { href: '/profit-sharing', label: 'Profit split', icon: Split },
      { href: '/team', label: 'Team', icon: Users },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/integrations', label: 'Payments', icon: Plug, adminOnly: true },
      { href: '/audit-logs', label: 'Activity', icon: ScrollText, adminOnly: true },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, status, activeCompany, memberships, switchCompany, logout, canAdminister } = useAuth();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  if (status === 'unauthenticated' || !user) return null;

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || canAdminister),
  })).filter((group) => group.items.length > 0);

  const rail = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5" aria-label="Main">
      <div className="px-2">
        <Link href="/dashboard" className="flex items-baseline gap-1.5">
          <span className="font-figure text-xl font-semibold tracking-tight">Ledger</span>
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
        </Link>
        {activeCompany ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{activeCompany.companyName}</p>
        ) : null}
      </div>

      {visibleGroups.map((group) => (
        <div key={group.label}>
          <p className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="mt-auto px-1">
        <UserMenu
          name={user.fullName}
          email={user.email}
          companyName={activeCompany?.companyName ?? ''}
          role={activeCompany?.role ?? ''}
          memberships={memberships}
          onSwitchCompany={switchCompany}
          onLogout={() => void logout()}
        />
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <Menu />
        </Button>
        <span className="font-figure text-lg font-semibold">Ledger</span>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-border bg-card">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-3"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X />
            </Button>
            {rail}
          </div>
        </div>
      ) : null}

      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-border bg-card lg:block">
        {rail}
      </aside>

      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}

function UserMenu({
  name,
  email,
  companyName,
  role,
  memberships,
  onSwitchCompany,
  onLogout,
}: {
  name: string;
  email: string;
  companyName: string;
  role: string;
  memberships: { companyId: string; companyName: string; role: string }[];
  onSwitchCompany: (id: string) => void;
  onLogout: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
            {initials(name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{name}</span>
            <span className="block truncate text-xs capitalize text-muted-foreground">
              {role.toLowerCase()}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {memberships.length > 1 ? (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Company</DropdownMenuLabel>
            {memberships.map((m) => (
              <DropdownMenuItem key={m.companyId} onSelect={() => onSwitchCompany(m.companyId)}>
                <Building2 />
                <span className="truncate">{m.companyName}</span>
                {m.companyName === companyName ? (
                  <span className="ml-auto text-xs text-primary">Current</span>
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}

        {mounted ? (
          <DropdownMenuItem onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun /> : <Moon />}
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
