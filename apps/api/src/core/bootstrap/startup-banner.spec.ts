import { formatStartupBanner } from './startup-banner';

describe('formatStartupBanner', () => {
  it('reports the AI Pilot endpoints and runtime state', () => {
    const banner = formatStartupBanner({
      environment: 'test',
      port: 3456,
    });

    expect(banner).toContain('🚀 AI Pilot API Server Started');
    expect(banner).toContain('http://localhost:3456/api/v1');
    expect(banner).toContain('http://localhost:3456/health');
    expect(banner).toContain('Environment: test');
    expect(banner).toContain('Port:        3456');
  });
});
