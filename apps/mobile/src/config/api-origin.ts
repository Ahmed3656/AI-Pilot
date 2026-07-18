export interface ApiOriginOptions {
  isDevelopment: boolean;
  platform: string;
  developmentHostUri?: string;
  browserHostname?: string;
}

export function resolveApiOrigin(
  value: string | undefined,
  options: ApiOriginOptions,
): string {
  const fallback = options.isDevelopment ? 'http://localhost:8080' : '';
  const candidate = (value ?? fallback).trim().replace(/\/$/, '');
  if (!candidate) throw new Error('EXPO_PUBLIC_API_URL is required');

  const parsed = new URL(candidate);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('EXPO_PUBLIC_API_URL must be an origin without a path');
  }

  if (options.isDevelopment) {
    if (options.platform === 'web') {
      // Keep the API/viewer on the same host as the page. Viewer authorization
      // uses an HttpOnly SameSite cookie, which browsers withhold when an Expo
      // page opened on localhost embeds a viewer configured with a LAN IP (or
      // the reverse). Ports may differ without making the cookie cross-site.
      const browserHostname = localDevelopmentHostname(options.browserHostname);
      if (browserHostname && isLocalDevelopmentHostname(parsed.hostname)) {
        parsed.hostname = browserHostname;
      }
    } else if (isLoopback(parsed.hostname)) {
      const developmentHostname = lanHostname(options.developmentHostUri);
      if (developmentHostname) parsed.hostname = developmentHostname;
    }
  }

  return parsed.origin;
}

export function isLocalDevelopmentOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      isLocalDevelopmentHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function lanHostname(hostUri: string | undefined): string | null {
  if (!hostUri) return null;
  let hostname: string;
  try {
    hostname = new URL(hostUri.includes('://') ? hostUri : `http://${hostUri}`)
      .hostname;
  } catch {
    return null;
  }
  return isPrivateIpv4(hostname) || isLocalIpv6(hostname) ? hostname : null;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function localDevelopmentHostname(hostname: string | undefined): string | null {
  const normalized = hostname?.trim();
  return normalized && isLocalDevelopmentHostname(normalized)
    ? normalized
    : null;
}

function isLocalDevelopmentHostname(hostname: string): boolean {
  return (
    isLoopback(hostname) || isPrivateIpv4(hostname) || isLocalIpv6(hostname)
  );
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== hostname.split('.')[index],
    )
  )
    return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isLocalIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized.startsWith('fc') || normalized.startsWith('fd');
}
