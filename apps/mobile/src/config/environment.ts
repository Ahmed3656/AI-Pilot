import Constants from 'expo-constants';

type AppExtra = { apiUrl?: string; authRequired?: boolean };

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

export const environment = {
  apiUrl: extra.apiUrl ?? 'http://localhost:3000',
  authRequired: extra.authRequired ?? false,
} as const;
