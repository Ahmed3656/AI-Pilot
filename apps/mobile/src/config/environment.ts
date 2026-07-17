import Constants from 'expo-constants';

type AppExtra = { apiUrl?: string; authRequired?: boolean };

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

function normalizeOrigin(value: string | undefined): string {
  const fallback = __DEV__ ? 'http://localhost:8080' : '';
  const candidate = (value ?? fallback).trim().replace(/\/$/, '');
  if (!candidate) {
    throw new Error('EXPO_PUBLIC_API_URL is required');
  }
  const parsed = new URL(candidate);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('EXPO_PUBLIC_API_URL must be an origin without a path');
  }
  return parsed.origin;
}

const apiOrigin = normalizeOrigin(extra.apiUrl);

export const environment = {
  apiOrigin,
  apiBaseUrl: `${apiOrigin}/api/v1`,
  authRequired: extra.authRequired ?? true,
} as const;
