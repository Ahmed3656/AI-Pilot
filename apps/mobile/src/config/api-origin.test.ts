import { resolveApiOrigin } from './api-origin';

describe('mobile API origin resolution', () => {
  it('uses the Expo LAN host for a native development app configured with localhost', () => {
    expect(
      resolveApiOrigin('http://localhost:8080', {
        isDevelopment: true,
        platform: 'ios',
        developmentHostUri: '192.168.1.9:8081',
      }),
    ).toBe('http://192.168.1.9:8080');
  });

  it('keeps localhost for web development', () => {
    expect(
      resolveApiOrigin('http://localhost:8080', {
        isDevelopment: true,
        platform: 'web',
        developmentHostUri: '192.168.1.9:8081',
      }),
    ).toBe('http://localhost:8080');
  });

  it('uses the page host for web development so viewer cookies remain same-site', () => {
    expect(
      resolveApiOrigin('http://192.168.1.9:8080', {
        isDevelopment: true,
        platform: 'web',
        developmentHostUri: '192.168.1.9:8081',
        browserHostname: 'localhost',
      }),
    ).toBe('http://localhost:8080');

    expect(
      resolveApiOrigin('http://localhost:8080', {
        isDevelopment: true,
        platform: 'web',
        developmentHostUri: '192.168.1.9:8081',
        browserHostname: '192.168.1.9',
      }),
    ).toBe('http://192.168.1.9:8080');
  });

  it('does not replace a public development API with the page host', () => {
    expect(
      resolveApiOrigin('https://api.dealpilot.example', {
        isDevelopment: true,
        platform: 'web',
        browserHostname: 'localhost',
      }),
    ).toBe('https://api.dealpilot.example');
  });

  it('does not rewrite production origins or Expo tunnel hosts', () => {
    expect(
      resolveApiOrigin('https://dealpilot.example.com', {
        isDevelopment: false,
        platform: 'ios',
        developmentHostUri: '192.168.1.9:8081',
        browserHostname: 'localhost',
      }),
    ).toBe('https://dealpilot.example.com');
    expect(
      resolveApiOrigin('http://localhost:8080', {
        isDevelopment: true,
        platform: 'ios',
        developmentHostUri: 'example.exp.direct',
      }),
    ).toBe('http://localhost:8080');
  });

  it('rejects a configured URL containing an API path', () => {
    expect(() =>
      resolveApiOrigin('https://dealpilot.example.com/api/v1', {
        isDevelopment: false,
        platform: 'ios',
      }),
    ).toThrow('EXPO_PUBLIC_API_URL must be an origin without a path');
  });
});
