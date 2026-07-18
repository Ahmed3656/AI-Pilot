import { create, InternalAxiosRequestConfig, isAxiosError } from 'axios';
import { environment } from '@/config/environment';
import { STORAGE_KEYS } from '@/constants/storage';
import { storage } from '@/storage/storage';
import { AuthSession } from '@/types/auth';

type SessionListener = (session: AuthSession | null) => void;
type RetryableRequest = InternalAxiosRequestConfig & {
  _authRetried?: boolean;
};

const sessionListeners = new Set<SessionListener>();
let refreshInFlight: Promise<AuthSession> | null = null;

export class AuthenticationSessionExpiredError extends Error {
  constructor() {
    super('AUTH_SESSION_EXPIRED');
    this.name = 'AuthenticationSessionExpiredError';
  }
}

export const apiClient = create({
  baseURL: environment.apiBaseUrl,
  timeout: 10_000,
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

apiClient.interceptors.request.use(async (request) => {
  const token = await storage.get(STORAGE_KEYS.accessToken);
  if (token) request.headers.Authorization = `Bearer ${token}`;
  return request;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!isAxiosError(error) || error.response?.status !== 401 || !error.config)
      throw error;
    const request = error.config as RetryableRequest;
    if (request._authRetried || isAuthenticationRequest(request.url))
      throw error;
    request._authRetried = true;
    try {
      const session = await refreshAuthentication();
      request.headers.Authorization = `Bearer ${session.accessToken}`;
      return await apiClient.request(request);
    } catch {
      await clearStoredSession();
      notifySession(null);
      throw new AuthenticationSessionExpiredError();
    }
  },
);

export function subscribeToAuthenticationSession(
  listener: SessionListener,
): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function refreshAuthentication(): Promise<AuthSession> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function performRefresh(): Promise<AuthSession> {
  const refreshToken = await storage.get(STORAGE_KEYS.refreshToken);
  if (!refreshToken) throw new AuthenticationSessionExpiredError();
  const { data } = await apiClient.post<AuthSession>('/auth/refresh', {
    refreshToken,
  });
  await Promise.all([
    storage.set(STORAGE_KEYS.accessToken, data.accessToken),
    storage.set(STORAGE_KEYS.refreshToken, data.refreshToken),
    storage.set(STORAGE_KEYS.authUser, JSON.stringify(data.user)),
  ]);
  notifySession(data);
  return data;
}

async function clearStoredSession(): Promise<void> {
  await Promise.all([
    storage.remove(STORAGE_KEYS.accessToken),
    storage.remove(STORAGE_KEYS.refreshToken),
    storage.remove(STORAGE_KEYS.authUser),
  ]);
}

function notifySession(session: AuthSession | null): void {
  for (const listener of sessionListeners) listener(session);
}

function isAuthenticationRequest(url: string | undefined): boolean {
  const path = url?.split('?', 1)[0] ?? '';
  return ['/auth/login', '/auth/register', '/auth/refresh'].some((candidate) =>
    path.endsWith(candidate),
  );
}
