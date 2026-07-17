import { create } from 'axios';
import { environment } from '@/config/environment';
import { STORAGE_KEYS } from '@/constants/storage';
import { storage } from '@/storage/storage';

export const apiClient = create({
  baseURL: environment.apiBaseUrl,
  timeout: 10_000,
  headers: { Accept: 'application/json' },
});

apiClient.interceptors.request.use(async (request) => {
  const token = await storage.get(STORAGE_KEYS.accessToken);
  if (token) request.headers.Authorization = `Bearer ${token}`;
  return request;
});

// TODO(api): add refresh-token coordination and typed error mapping with the auth feature.
