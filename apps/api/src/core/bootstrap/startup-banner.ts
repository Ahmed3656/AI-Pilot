export interface StartupBannerOptions {
  environment: string;
  port: number;
}

export function formatStartupBanner(options: StartupBannerOptions): string {
  const { environment, port } = options;
  return `
\u001b[37m
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║ 🚀 AI Pilot API Server Started                            ║
║                                                           ║
║  Environment: ${environment.padEnd(43)} ║
║  Port:        ${String(port).padEnd(43)} ║
║  URL:         http://localhost:${port}/api/v1${' '.repeat(15)} ║
║  Health:      http://localhost:${port}/health${' '.repeat(15)} ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
\u001b[0m`;
}
