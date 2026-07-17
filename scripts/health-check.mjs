const services = [
  ['API', process.env.API_URL ?? 'http://localhost:3000'],
  ['AI', process.env.AI_URL ?? 'http://localhost:8000'],
];

let failed = false;
for (const [name, baseUrl] of services) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.json();
    if (!response.ok || body.status !== 'ok')
      throw new Error(`status=${response.status}`);
    console.log(`PASS  ${name}: ${baseUrl}/health`);
  } catch (error) {
    failed = true;
    console.error(
      `FAIL  ${name}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

if (failed) process.exit(1);
