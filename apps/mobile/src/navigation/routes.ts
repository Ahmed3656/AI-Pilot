export const routes = {
  home: '/',
  profile: '/profile',
  settings: '/settings',
} as const;

// Expo Router owns the navigation tree; this map keeps non-component callers type-safe.
