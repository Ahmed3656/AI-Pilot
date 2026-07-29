# DealPilot Egypt MVP infrastructure

`infra/phase1/docker-compose.yml` is the single canonical runtime stack. The root `docker-compose.yml` only includes this file, so root and infrastructure commands cannot drift into different deployments.

The stack runs PostgreSQL, a one-shot database migration gate, the NestJS API, the FastAPI AI service, one Selenium standalone Chromium session with noVNC, Caddy, and an optional Cloudflare Tunnel connector. Egypt is fixed to market `EG`, currency `EGP`, timezone `Africa/Cairo`, and locales `ar-EG`/`en-EG`.

## Prerequisites

- Node.js 22 or newer and npm 10 or newer.
- Docker Engine with Docker Compose 2.24 or newer.
- An OpenRouter API key stored only in ignored `infra/phase1/.env`. A direct Gemini fallback additionally needs `AI_GEMINI_API_KEY` in the same ignored file. Never commit either key or paste it into logs, screenshots, reports, or viewer URLs.

Run commands from the repository root. On the first lifecycle command, the runtime creates ignored `infra/phase1/.env` configuration with independent random PostgreSQL, JWT, internal, and viewer-token secrets. It never generates an OpenRouter key.

Generate the file, edit it, and start:

```bash
npm run mvp:config
# In infra/phase1/.env set AI_OPENROUTER_API_KEY=sk-or-v1-your-key
npm run mvp:start
```

`mvp:start` validates the configuration without printing interpolated values, builds the images, starts the local profile, waits for the migration gate and health checks, and verifies service-to-service authentication. `AI_OPENROUTER_API_KEY` is mounted as a Compose secret granted only to `ai-service`; its entrypoint exports the value only inside that service process.

## Root lifecycle commands

| Command               | Result                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run mvp:config`  | Validate the canonical Compose model without printing secrets                                   |
| `npm run mvp:build`   | Build the API and AI images                                                                     |
| `npm run mvp:start`   | Build, migrate, start, wait for readiness, and run health checks                                |
| `npm run mvp:stop`    | Stop containers and preserve PostgreSQL data                                                    |
| `npm run mvp:logs`    | Follow logs through the token/address/viewer/screenshot redactor                                |
| `npm run mvp:migrate` | Run the one-shot migration job explicitly                                                       |
| `npm run mvp:health`  | Verify container health, schema, Selenium, and two-way internal auth                            |
| `npm run mvp:smoke`   | Exercise canonical routing, private-port isolation, and log privacy without visiting a merchant |
| `npm run mvp:clean`   | Stop the stack and delete its PostgreSQL volume                                                 |

The legacy root `docker:*` helpers delegate to these same commands. `mvp:clean` permanently removes local Phase 1 database data; it does not delete repository files or external resources.

## Startup and readiness

PostgreSQL must report healthy before `migrate` runs. The API cannot start until all TypeORM migrations complete successfully. API container readiness then checks both `/health/ready` and the required `shopping_runs` and `shopping_run_events` tables, so an open database port with an empty schema is not considered ready.

The AI container is ready only when all of these conditions hold:

- its production readiness endpoint accepts the live secret configuration;
- the OpenRouter secret file is non-empty;
- Selenium reports an available Grid;
- a correctly authenticated AI-to-API request reaches DTO validation.

The health and smoke scripts also send rejected and accepted internal-auth probes in both API-to-AI and AI-to-API directions. Correct credentials must pass the auth guard and reach request validation; incorrect credentials must return `401`.

## Exposure and networks

Only Caddy publishes a host port, bound to `${DEALPILOT_GATEWAY_BIND:-127.0.0.1}:${DEALPILOT_GATEWAY_PORT:-8080}`. PostgreSQL, the API, FastAPI, WebDriver, and direct noVNC have no host bindings. Set the bind to `0.0.0.0` only for a physical phone on a trusted private LAN, and use the computer's LAN address for both public and Expo origins.

| Network                    | Members                        | Purpose                                       |
| -------------------------- | ------------------------------ | --------------------------------------------- |
| `edge-plane`               | Caddy, optional cloudflared    | Loopback/tunnel ingress                       |
| `control-plane` (internal) | Caddy, API, AI, Selenium       | Private control and viewer traffic            |
| `data-plane` (internal)    | API, migration job, PostgreSQL | Private database traffic                      |
| `agent-egress`             | AI, Selenium                   | OpenRouter and approved Egypt merchant egress |

Selenium exposes only container ports `4444` and `7900`. It permits up to three concurrent sessions—one for each selected retail merchant—uses a 1280x800 screen and browser window, disables extensions, and keeps the VNC server interactive so a valid temporary control token can operate the retained merchant browsers. Unauthenticated access remains impossible because noVNC is reachable only through Caddy authorization.

## Canonical gateway routes

- `/api/*` proxies unchanged to the NestJS API. Public application routes use `/api/v1` only.
- WebSocket upgrades are matched only at `/api/v1/shopping/runs/:runId/events` and use the `dealpilot.events.v1` plus `bearer.<viewer-token>` subprotocols. Viewer tokens never appear in URLs.
- `/viewer/*` performs a private `POST /internal/v1/viewer/authorize` with `X-Internal-Token`. The incoming viewer bearer header or same-origin `dealpilot_viewer` cookie is validated on every HTTP/WebSocket request.
- A `view` token opens noVNC with `view_only=1`. A valid, unexpired `control` token opens the interactive client for the API-controlled handoff period.
- `/health*` proxies only API health. `/_gateway/health` reports Caddy process health.
- `/internal/*`, FastAPI, WebDriver, direct noVNC, PostgreSQL, and all other paths are not public and return `404` at Caddy.

Caddy removes viewer authorization, cookies, the internal token, and the authorized mode header before proxying to noVNC. Authorization failure or API unavailability is fail-closed; Caddy never falls through to the viewer upstream.

## Local and Cloudflare profiles

The default root commands use `local-only`. For the optional tunnel, create one remotely managed Cloudflare Tunnel whose only ingress target is `http://gateway:8080`, then set an HTTPS origin with no path and the connector token in the runtime environment:

```powershell
$env:DEALPILOT_PROFILE = 'cloud-tunnel'
$env:DEALPILOT_PUBLIC_ORIGIN = 'https://dealpilot.example.com'
$env:EXPO_PUBLIC_API_URL = 'https://dealpilot.example.com'
$env:CLOUDFLARE_TUNNEL_TOKEN = '<runtime tunnel token>'
npm run mvp:start
npm run mvp:smoke
```

The mobile URL is the origin only; the client appends `/api/v1` and derives `wss://` from the same origin. Do not create separate public hostnames for the API, AI service, Selenium, noVNC, or PostgreSQL.

To stop tunnel traffic while preserving data, run `npm run mvp:stop` with the same profile. For credential rotation, replace the runtime value and recreate the affected services. For an incident or permanent shutdown, also revoke the old tunnel connector token and remove its public hostname in Cloudflare; stopping the local connector does not revoke copied credentials.

## Safe validation

`npm run mvp:smoke` verifies health, schema and two-way service authentication, canonical and legacy route behavior, private-port isolation, and recent log privacy. It creates no application run or WebDriver session, visits no merchant, submits no purchase or booking, and performs no external destructive action.

`npm run demo` is the separate, clearly labeled deterministic integration journey. It resets the local database, uses real API/AI/Selenium/WebSocket/viewer services with simulated merchant output, seeds a completed report, and leaves the stack running. See `docs/phase1-demo.md`.

Use `npm run mvp:logs` for diagnostics. It masks configured service secrets, bearer/query tokens, address fields, viewer URLs, and screenshot/base64 data. Do not bypass the wrapper by publishing private service ports or sharing raw Docker inspection/configuration output.
