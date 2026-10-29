'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  apiGet,
  apiPost,
  setAccessToken,
  setActiveCompanyId,
  setSessionExpiredHandler,
} from '@/lib/api-client';
import type {
  LoginResponse,
  MembershipRole,
  MembershipSummary,
  SessionUser,
  UserProfile,
} from '@/types/api';

/**
 * Session state.
 *
 * The access token is held in React state (memory) and nothing else. On a page
 * reload there is no token, so the app silently asks the API to refresh using
 * the HttpOnly cookie — which is why a signed-in user stays signed in across
 * reloads without the token ever being written to storage a script could read.
 */

interface AuthState {
  user: SessionUser | null;
  memberships: MembershipSummary[];
  activeCompanyId: string | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
}

interface AuthContextValue extends AuthState {
  activeCompany: MembershipSummary | null;
  role: MembershipRole | null;
  /** True for PARTNER and above — may create financial records. */
  canWrite: boolean;
  /** True for ADMIN and OWNER — may manage integrations, roles, profit split. */
  canAdminister: boolean;
  isOwner: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchCompany: (companyId: string) => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

const ROLE_RANK: Record<MembershipRole, number> = { VIEWER: 0, PARTNER: 1, ADMIN: 2, OWNER: 3 };
const ACTIVE_COMPANY_KEY = 'cms.activeCompanyId';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [state, setState] = React.useState<AuthState>({
    user: null,
    memberships: [],
    activeCompanyId: null,
    status: 'loading',
  });

  const applySession = React.useCallback((response: LoginResponse) => {
    setAccessToken(response.accessToken);

    // Prefer the company the user last worked in, if they still belong to it.
    const stored =
      typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_COMPANY_KEY) : null;
    const preferred =
      response.memberships.find((m) => m.companyId === stored) ?? response.memberships[0] ?? null;

    setActiveCompanyId(preferred?.companyId ?? null);
    setState({
      user: response.user,
      memberships: response.memberships,
      activeCompanyId: preferred?.companyId ?? null,
      status: 'authenticated',
    });
  }, []);

  const clearSession = React.useCallback(() => {
    setAccessToken(null);
    setActiveCompanyId(null);
    setState({ user: null, memberships: [], activeCompanyId: null, status: 'unauthenticated' });
    queryClient.clear();
  }, [queryClient]);

  /**
   * Restores a session from the HttpOnly refresh cookie on first load.
   * Two steps: rotate for an access token, then read the profile with it.
   */
  const refreshSession = React.useCallback(async () => {
    try {
      const refreshed = await apiPost<{ accessToken: string }>('/auth/refresh', { client: 'web' });
      setAccessToken(refreshed.accessToken);

      const me = await apiGet<UserProfile>('/auth/me');

      applySession({
        user: {
          id: me.id,
          email: me.email,
          fullName: me.fullName,
          avatarUrl: me.avatarUrl,
          timezone: me.timezone,
          locale: me.locale,
        },
        memberships: me.memberships.map((m) => ({
          companyId: m.companyId,
          companyName: m.company.name,
          role: m.role,
          baseCurrency: m.company.baseCurrency,
          timezone: m.company.timezone,
        })),
        accessToken: refreshed.accessToken,
        accessTokenExpiresIn: 900,
        tokenType: 'Bearer',
      });
    } catch {
      clearSession();
    }
  }, [applySession, clearSession]);

  React.useEffect(() => {
    setSessionExpiredHandler(() => {
      clearSession();
      router.push('/login');
    });
    return () => setSessionExpiredHandler(null);
  }, [clearSession, router]);

  React.useEffect(() => {
    void refreshSession();
    // Runs once on mount to restore a session from the cookie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = React.useCallback(
    async (email: string, password: string) => {
      const response = await apiPost<LoginResponse>('/auth/login', {
        email,
        password,
        client: 'web',
      });
      applySession(response);
    },
    [applySession],
  );

  const logout = React.useCallback(async () => {
    try {
      await apiPost('/auth/logout', {});
    } finally {
      clearSession();
      router.push('/login');
    }
  }, [clearSession, router]);

  const switchCompany = React.useCallback(
    (companyId: string) => {
      if (!state.memberships.some((m) => m.companyId === companyId)) return;
      window.localStorage.setItem(ACTIVE_COMPANY_KEY, companyId);
      setActiveCompanyId(companyId);
      setState((current) => ({ ...current, activeCompanyId: companyId }));
      // Figures are company-scoped, so nothing cached may carry over.
      queryClient.clear();
    },
    [queryClient, state.memberships],
  );

  const activeCompany =
    state.memberships.find((m) => m.companyId === state.activeCompanyId) ?? null;
  const role = activeCompany?.role ?? null;

  const value = React.useMemo<AuthContextValue>(
    () => ({
      ...state,
      activeCompany,
      role,
      canWrite: role !== null && ROLE_RANK[role] >= ROLE_RANK.PARTNER,
      canAdminister: role !== null && ROLE_RANK[role] >= ROLE_RANK.ADMIN,
      isOwner: role === 'OWNER',
      login,
      logout,
      switchCompany,
      refreshSession,
    }),
    [state, activeCompany, role, login, logout, switchCompany, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
