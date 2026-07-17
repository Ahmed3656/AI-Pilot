import Constants from 'expo-constants';

type AppExtra = { apiUrl?: string };

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

export const environment = {
  apiUrl: extra.apiUrl ?? 'http://localhost:3000',
} as const;
