import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

/**
 * The single HTTP client for the whole app.
 *
 * Token handling, in short:
 *   - The ACCESS token lives in memory only. Putting it in localStorage would
 *     make it readable by any injected script.
 *   - The REFRESH token is an HttpOnly cookie set by the API, so JavaScript
 *     here never touches it. `withCredentials` is what sends it back.
 *   - On a 401 the client refreshes ONCE and replays the original request.
 *     Concurrent 401s share one refresh — otherwise ten parallel requests
 *     would fire ten rotations and the token-reuse detector would (correctly)
 *     kill the session.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.requestId;
  }

  /** Field-level messages from the API's validation errors, for react-hook-form. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as { field?: string; message?: string }[])
        .filter((d) => d.field && d.message)
        .map((d) => [d.field!, d.message!]),
    );
  }
}

let accessToken: string | null = null;
let activeCompanyId: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setActiveCompanyId(companyId: string | null): void {
  activeCompanyId = companyId;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // carries the HttpOnly refresh cookie
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  if (activeCompanyId) {
    config.headers.set('X-Company-Id', activeCompanyId);
  }
  return config;
});

/** Shared in-flight refresh, so parallel 401s trigger exactly one rotation. */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  refreshPromise ??= axios
    .post<{ data: { accessToken: string } }>(
      `${API_BASE_URL}/auth/refresh`,
      { client: 'web' },
      { withCredentials: true },
    )
    .then((response) => {
      const token = response.data.data.accessToken;
      setAccessToken(token);
      return token;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

interface RetryableConfig extends AxiosRequestConfig {
  _retried?: boolean;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: ApiError }>) => {
    const original = error.config as RetryableConfig | undefined;
    const status = error.response?.status;
    const payload = error.response?.data?.error;

    const isAuthEndpoint = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');

    if (status === 401 && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      try {
        await refreshAccessToken();
        return apiClient(original);
      } catch {
        setAccessToken(null);
        onSessionExpired?.();
        throw new ApiRequestError(401, {
          code: 'TOKEN_EXPIRED',
          message: 'Your session has ended. Sign in again to continue.',
        });
      }
    }

    if (payload) throw new ApiRequestError(status ?? 500, payload);

    if (error.code === 'ECONNABORTED') {
      throw new ApiRequestError(408, {
        code: 'TIMEOUT',
        message: 'The request took too long. Check your connection and try again.',
      });
    }

    if (!error.response) {
      throw new ApiRequestError(0, {
        code: 'NETWORK_ERROR',
        message: 'Could not reach the server. Check your connection and try again.',
      });
    }

    throw new ApiRequestError(status ?? 500, {
      code: 'UNKNOWN',
      message: error.message || 'Something went wrong.',
    });
  },
);

/** Envelope-aware helpers: the API always wraps payloads in `data`. */
export interface Paginated<T> {
  items: T[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await apiClient.get<{ data: T }>(url, config);
  return response.data.data;
}

export async function apiGetPaginated<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<Paginated<T>> {
  const response = await apiClient.get<{ data: T[]; meta: Paginated<T>['meta'] }>(url, config);
  return { items: response.data.data, meta: response.data.meta };
}

export async function apiPost<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await apiClient.post<{ data: T }>(url, body, config);
  return response.data?.data;
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const response = await apiClient.patch<{ data: T }>(url, body);
  return response.data.data;
}

export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  const response = await apiClient.put<{ data: T }>(url, body);
  return response.data.data;
}

export async function apiDelete(url: string): Promise<void> {
  await apiClient.delete(url);
}

/** Downloads a CSV export, preserving the filename the API suggests. */
export async function apiDownload(url: string, fallbackName: string): Promise<void> {
  const response = await apiClient.get(url, { responseType: 'blob' });

  const disposition = response.headers['content-disposition'] as string | undefined;
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? fallbackName;

  const blobUrl = URL.createObjectURL(response.data as Blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

export { API_BASE_URL };
