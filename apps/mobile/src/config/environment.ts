import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { resolveApiOrigin } from './api-origin';

type AppExtra = { apiUrl?: string; authRequired?: boolean };

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

const apiOrigin = resolveApiOrigin(extra.apiUrl, {
  isDevelopment: __DEV__,
  platform: Platform.OS,
  developmentHostUri: Constants.expoConfig?.hostUri,
  browserHostname:
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.hostname
      : undefined,
});

export const environment = {
  apiOrigin,
  apiBaseUrl: `${apiOrigin}/api/v1`,
  authRequired: extra.authRequired ?? true,
  isDevelopment: __DEV__,
} as const;
