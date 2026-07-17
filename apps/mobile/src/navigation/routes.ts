export const routes = {
  home: '/',
  profile: '/profile',
  settings: '/settings',
  address: '/address',
  run: (id: string) => `/run/${id}`,
  report: (id: string) => `/run/${id}/report`,
} as const;

// Expo Router owns the navigation tree; this map keeps non-component callers type-safe.
