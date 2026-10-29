'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type UseQueryOptions,
} from '@tanstack/react-query';
import {
  apiDelete,
  apiGet,
  apiGetPaginated,
  apiPatch,
  apiPost,
  apiPut,
  type Paginated,
} from '@/lib/api-client';
import type {
  AuditLogEntry,
  Company,
  Dashboard,
  DatePreset,
  Expense,
  ExpenseCategory,
  Member,
  Payout,
  ProductMapping,
  ProfitLossReport,
  ProfitShareStatement,
  Project,
  ProjectFinancials,
  ProviderAccount,
  Refund,
  Transaction,
  UserProfile,
  WebhookEvent,
} from '@/types/api';

/**
 * Query keys.
 *
 * Every key that depends on company-scoped data starts with its resource name,
 * so invalidating one resource after a mutation is precise. The whole cache is
 * cleared on company switch, so the company id is not repeated in each key.
 */
export const queryKeys = {
  profile: ['profile'] as const,
  company: ['company'] as const,
  dashboard: (params: unknown) => ['dashboard', params] as const,
  projects: (params: unknown) => ['projects', params] as const,
  project: (id: string, params?: unknown) => ['project', id, params] as const,
  transactions: (params: unknown) => ['transactions', params] as const,
  transaction: (id: string) => ['transaction', id] as const,
  refunds: (params: unknown) => ['refunds', params] as const,
  expenses: (params: unknown) => ['expenses', params] as const,
  expenseCategories: ['expense-categories'] as const,
  profitLoss: (params: unknown) => ['profit-loss', params] as const,
  profitSharing: (params: unknown) => ['profit-sharing', params] as const,
  profitShareConfig: ['profit-share-config'] as const,
  payouts: (params: unknown) => ['payouts', params] as const,
  providers: ['providers'] as const,
  providerMappings: (id: string) => ['provider-mappings', id] as const,
  webhookEvents: (params: unknown) => ['webhook-events', params] as const,
  members: ['members'] as const,
  auditLogs: (params: unknown) => ['audit-logs', params] as const,
};

export interface DateRangeParams extends Record<string, unknown> {
  preset?: DatePreset;
  from?: string;
  to?: string;
  projectId?: string;
}

export interface ListParams extends Record<string, unknown> {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** Strips undefined/empty values so query strings stay clean and cache keys stable. */
function cleanParams<T extends Record<string, unknown>>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}

// --- Profile & company ------------------------------------------------------

export function useProfile(options?: Partial<UseQueryOptions<UserProfile>>) {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => apiGet<UserProfile>('/auth/me'),
    ...options,
  });
}

export function useCompany() {
  return useQuery({
    queryKey: queryKeys.company,
    queryFn: () => apiGet<Company>('/companies/current'),
  });
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Company>) => apiPatch<Company>('/companies/current', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.company }),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { fullName?: string; timezone?: string; locale?: string }) =>
      apiPatch<UserProfile>('/auth/me', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.profile }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      apiPost<{ message: string }>('/auth/change-password', input),
  });
}

// --- Dashboard & reports ----------------------------------------------------

export function useDashboard(params: DateRangeParams) {
  return useQuery({
    queryKey: queryKeys.dashboard(params),
    queryFn: () => apiGet<Dashboard>('/dashboard', { params: cleanParams(params) }),
    placeholderData: keepPreviousData,
  });
}

export function useProfitLoss(params: DateRangeParams) {
  return useQuery({
    queryKey: queryKeys.profitLoss(params),
    queryFn: () => apiGet<ProfitLossReport>('/reports/profit-loss', { params: cleanParams(params) }),
    placeholderData: keepPreviousData,
  });
}

// --- Projects ---------------------------------------------------------------

export function useProjects(params: ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.projects(params),
    queryFn: () => apiGetPaginated<Project>('/projects', { params: cleanParams(params) }),
    placeholderData: keepPreviousData,
  });
}

export function useProject(id: string, params: DateRangeParams = {}) {
  return useQuery({
    queryKey: queryKeys.project(id, params),
    queryFn: () =>
      apiGet<{ project: Project; financials: ProjectFinancials }>(`/projects/${id}`, {
        params: cleanParams(params),
      }),
    enabled: Boolean(id),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Project>) => apiPost<Project>('/projects', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Project>) => apiPatch<Project>(`/projects/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['project', id] });
    },
  });
}

export function useArchiveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<Project>(`/projects/${id}/archive`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useRestoreProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<Project>(`/projects/${id}/restore`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/projects/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

// --- Transactions & refunds -------------------------------------------------

export function useTransactions(params: ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.transactions(params),
    queryFn: () => apiGetPaginated<Transaction>('/transactions', { params: cleanParams(params) }),
    placeholderData: keepPreviousData,
  });
}

export function useTransaction(id: string) {
  return useQuery({
    queryKey: queryKeys.transaction(id),
    queryFn: () => apiGet<Transaction>(`/transactions/${id}`),
    enabled: Boolean(id),
  });
}

/** Invalidates everything a money change could affect. */
function invalidateFinancials(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ['dashboard', 'transactions', 'transaction', 'refunds', 'projects', 'project', 'profit-loss', 'profit-sharing']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => apiPost<Transaction>('/transactions', input),
    onSuccess: () => invalidateFinancials(queryClient),
  });
}

export function useUpdateTransaction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => apiPatch<Transaction>(`/transactions/${id}`, input),
    onSuccess: () => invalidateFinancials(queryClient),
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/transactions/${id}`),
    onSuccess: () => invalidateFinancials(queryClient),
  });
}

export function useAssignProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectId, note }: { id: string; projectId: string; note?: string }) =>
      apiPost<Transaction>(`/transactions/${id}/assign-project`, { projectId, note }),
    onSuccess: () => invalidateFinancials(queryClient),
  });
}

export function useCreateRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, ...input }: { transactionId: string } & Record<string, unknown>) =>
      apiPost<{ refund: Refund; transaction: Transaction }>(
        `/transactions/${transactionId}/refunds`,
        input,
      ),
    onSuccess: () => invalidateFinancials(queryClient),
  });
}

export function useRefunds(params: ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.refunds(params),
    queryFn: () => apiGetPaginated<Refund>('/refunds', { params: cleanParams(params) }),
    placeholderData: keepPreviousData,
  });
}

// --- Expenses ---------------------------------------------------------------

export function useExpenses(params: ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.expenses(params),
    queryFn: () => apiGetPaginated<Expense>('/expenses', { params: cleanParams(params) }),
    placeholderData: keepPreviousData,
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: queryKeys.expenseCategories,
    queryFn: () => apiGet<ExpenseCategory[]>('/expense-categories'),
    staleTime: 5 * 60 * 1000, // rarely changes
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => apiPost<Expense>('/expenses', input),
    onSuccess: () => invalidateFinancials(queryClient),
  });
}

export function useUpdateExpense(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => apiPatch<Expense>(`/expenses/${id}`, input),
    onSuccess: () => invalidateFinancials(queryClient),
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/expenses/${id}`),
    onSuccess: () => invalidateFinancials(queryClient),
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color?: string }) =>
      apiPost<ExpenseCategory>('/expense-categories', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.expenseCategories }),
  });
}

// --- Profit sharing ---------------------------------------------------------

export function useProfitSharing(params: DateRangeParams) {
  return useQuery({
    queryKey: queryKeys.profitSharing(params),
    queryFn: () => apiGet<ProfitShareStatement>('/profit-sharing', { params: cleanParams(params) }),
    placeholderData: keepPreviousData,
  });
}

export function useProfitShareConfig() {
  return useQuery({
    queryKey: queryKeys.profitShareConfig,
    queryFn: () =>
      apiGet<{ userId: string; percentage: string; user: { fullName: string; email: string } }[]>(
        '/profit-sharing/config',
      ),
  });
}

export function useSetProfitShares() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      shares: { userId: string; percentage: string }[];
      effectiveFrom: string;
      note?: string;
    }) => apiPut('/profit-sharing/config', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profit-sharing'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profitShareConfig });
    },
  });
}

export function usePayouts(params: ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.payouts(params),
    queryFn: () => apiGetPaginated<Payout>('/payouts', { params: cleanParams(params) }),
    placeholderData: keepPreviousData,
  });
}

export function useCreatePayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => apiPost<Payout>('/payouts', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payouts'] });
      void queryClient.invalidateQueries({ queryKey: ['profit-sharing'] });
    },
  });
}

export function useDeletePayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/payouts/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payouts'] });
      void queryClient.invalidateQueries({ queryKey: ['profit-sharing'] });
    },
  });
}

// --- Payment providers ------------------------------------------------------

export function useProviders() {
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => apiGet<ProviderAccount[]>('/payment-providers'),
  });
}

export function useCreateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => apiPost<ProviderAccount>('/payment-providers', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
  });
}

export function useUpdateProvider(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      apiPatch<ProviderAccount>(`/payment-providers/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
  });
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/payment-providers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
  });
}

export function useProviderMappings(providerId: string) {
  return useQuery({
    queryKey: queryKeys.providerMappings(providerId),
    queryFn: () => apiGet<ProductMapping[]>(`/payment-providers/${providerId}/mappings`),
    enabled: Boolean(providerId),
  });
}

export function useCreateMapping(providerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; externalProductId: string; label?: string }) =>
      apiPost<ProductMapping>(`/payment-providers/${providerId}/mappings`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.providerMappings(providerId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers });
    },
  });
}

export function useDeleteMapping(providerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) =>
      apiDelete(`/payment-providers/${providerId}/mappings/${mappingId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.providerMappings(providerId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers });
    },
  });
}

export function useWebhookEvents(params: ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.webhookEvents(params),
    queryFn: () =>
      apiGetPaginated<WebhookEvent>('/payment-providers/webhook-events', {
        params: cleanParams(params),
      }),
    placeholderData: keepPreviousData,
  });
}

// --- Team & audit -----------------------------------------------------------

export function useMembers() {
  return useQuery({
    queryKey: queryKeys.members,
    queryFn: () => apiGet<Member[]>('/members'),
  });
}

export function useInviteMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; fullName: string; role: string }) =>
      apiPost<{
        email: string;
        role: string;
        status: string;
        inviteUrl?: string;
        inviteToken?: string;
        deliveryNote?: string;
      }>('/members/invite', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.members }),
  });
}

export function useUpdateMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; role?: string; status?: string }) =>
      apiPatch<Member>(`/members/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.members }),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/members/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.members }),
  });
}

export function useAuditLogs(params: ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.auditLogs(params),
    queryFn: () => apiGetPaginated<AuditLogEntry>('/audit-logs', { params: cleanParams(params) }),
    placeholderData: keepPreviousData,
  });
}

export type { Paginated };
