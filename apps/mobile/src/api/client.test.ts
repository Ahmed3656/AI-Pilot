import {
  AxiosError,
  AxiosHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { STORAGE_KEYS } from '@/constants/storage';
import { storage } from '@/storage/storage';
import { AuthSession } from '@/types/auth';
import {
  apiClient,
  AuthenticationSessionExpiredError,
  subscribeToAuthenticationSession,
} from './client';

jest.mock('@/storage/storage', () => ({
  storage: {
    get: jest.fn(),
    set: jest.fn(() => Promise.resolve()),
    remove: jest.fn(() => Promise.resolve()),
  },
}));

const get = storage.get as jest.MockedFunction<typeof storage.get>;
const set = storage.set as jest.MockedFunction<typeof storage.set>;
const remove = storage.remove as jest.MockedFunction<typeof storage.remove>;
const stored = new Map<string, string>();

const refreshedSession = {
  accessToken: 'access-new',
  refreshToken: 'refresh-new',
  user: { id: 'user-1', email: 'demo@example.test' },
};

describe('API authentication refresh coordination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stored.clear();
    stored.set(STORAGE_KEYS.accessToken, 'access-old');
    stored.set(STORAGE_KEYS.refreshToken, 'refresh-old');
    get.mockImplementation((key) => Promise.resolve(stored.get(key) ?? null));
    set.mockImplementation((key, value) => {
      stored.set(key, value);
      return Promise.resolve();
    });
    remove.mockImplementation((key) => {
      stored.delete(key);
      return Promise.resolve();
    });
  });

  it('refreshes one expired session and retries concurrent protected requests', async () => {
    let refreshCalls = 0;
    const observedSessions: (AuthSession | null)[] = [];
    const unsubscribe = subscribeToAuthenticationSession((session) =>
      observedSessions.push(session),
    );
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/refresh') {
        refreshCalls += 1;
        return response(config, 200, refreshedSession);
      }
      if (config.headers.Authorization === 'Bearer access-old') {
        throw unauthorized(config);
      }
      expect(config.headers.Authorization).toBe('Bearer access-new');
      return response(config, 200, { ok: true });
    };

    await expect(
      Promise.all([
        apiClient.get('/shopping/runs/run-1'),
        apiClient.get('/shopping/runs/run-2'),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ data: { ok: true } }),
      expect.objectContaining({ data: { ok: true } }),
    ]);

    expect(refreshCalls).toBe(1);
    expect(set).toHaveBeenCalledWith(
      STORAGE_KEYS.accessToken,
      refreshedSession.accessToken,
    );
    expect(observedSessions).toEqual([refreshedSession]);
    unsubscribe();
  });

  it('clears an unrecoverable session instead of reporting a connection failure', async () => {
    stored.delete(STORAGE_KEYS.refreshToken);
    apiClient.defaults.adapter = async (config) => {
      throw unauthorized(config);
    };

    await expect(apiClient.get('/shopping/runs/run-1')).rejects.toBeInstanceOf(
      AuthenticationSessionExpiredError,
    );
    expect(remove).toHaveBeenCalledTimes(3);
  });
});

function response<T>(
  config: InternalAxiosRequestConfig,
  status: number,
  data: T,
): AxiosResponse<T> {
  return {
    config,
    data,
    headers: new AxiosHeaders(),
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
  };
}

function unauthorized(config: InternalAxiosRequestConfig): AxiosError {
  return new AxiosError(
    'Unauthorized',
    'ERR_BAD_REQUEST',
    config,
    undefined,
    response(config, 401, {
      error: { code: 'UNAUTHENTICATED' },
    }),
  );
}
