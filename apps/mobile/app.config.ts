import { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'DealPilot Egypt',
  slug: 'ai-pilot',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'ai-pilot',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  plugins: ['expo-router', 'expo-secure-store'],
  experiments: { typedRoutes: true },
  web: { output: 'static' },
  ios: {
    supportsTablet: true,
    infoPlist: {
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: { edgeToEdgeEnabled: true },
  extra: {
    apiUrl:
      process.env.EXPO_PUBLIC_API_URL ??
      (process.env.NODE_ENV === 'production'
        ? (() => {
            throw new Error('EXPO_PUBLIC_API_URL is required in production');
          })()
        : 'http://localhost:8080'),
    authRequired: process.env.EXPO_PUBLIC_AUTH_REQUIRED !== 'false',
  },
});
