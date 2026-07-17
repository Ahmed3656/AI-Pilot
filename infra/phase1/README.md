# DealPilot Phase 1 infrastructure

This directory is a self-contained Phase 1 deployment. It runs the existing NestJS API and FastAPI service with PostgreSQL, one Selenium standalone Chromium session, Selenium's built-in noVNC server, a Caddy gateway, and an optional remotely-managed Cloudflare Tunnel.

Only Caddy binds a host port, and it binds to loopback. PostgreSQL, NestJS, FastAPI, WebDriver, direct noVNC, and cloudflared metrics are reachable only on Docker networks. The browser has 2 GB shared memory and no host filesystem mount.

## Prerequisites and configuration

- Docker Engine 26.1.4 or later and Docker Compose 2.34 or later are recommended.
- Copy `infra/phase1/.env.example` to `infra/phase1/.env` and replace every `change-me` value with a long random value.
- Keep `infra/phase1/.env` out of source control. The repository's existing ignore rules already ignore it.
- Run commands from the repository root.

Validate the model before starting anything:

```powershell
docker compose -f infra/phase1/docker-compose.yml config
```

Use the explicit environment file after creating it:

```powershell
docker compose --env-file infra/phase1/.env -f infra/phase1/docker-compose.yml config
```

## Profiles and lifecycle

Local-only starts Caddy on `127.0.0.1:8080` by default:

```powershell
docker compose --env-file infra/phase1/.env -f infra/phase1/docker-compose.yml --profile local-only up -d --build
infra/phase1/Test-Phase1Health.ps1 -Profile local-only
infra/phase1/Invoke-Phase1Smoke.ps1 -Profile local-only
```

Stop it without deleting PostgreSQL data:

```powershell
docker compose --env-file infra/phase1/.env -f infra/phase1/docker-compose.yml --profile local-only down
```

The `cloud-tunnel` profile starts the same gateway plus cloudflared:

```powershell
docker compose --env-file infra/phase1/.env -f infra/phase1/docker-compose.yml --profile cloud-tunnel up -d --build
infra/phase1/Test-Phase1Health.ps1 -Profile cloud-tunnel
infra/phase1/Invoke-Phase1Smoke.ps1 -Profile cloud-tunnel
```

The smoke test only checks health, routing, port isolation, and viewer rejection. It does not create a WebDriver session or visit a merchant.

## Ports and routes

| Component | Container port | Host/public exposure |
| --- | ---: | --- |
| Caddy gateway | 8080 | `127.0.0.1:${DEALPILOT_GATEWAY_PORT:-8080}` locally; Cloudflare hostname in tunnel mode |
| NestJS API | 3000 | Internal only |
| FastAPI AI service | 8000 | Internal only |
| PostgreSQL | 5432 | Internal only |
| Selenium WebDriver | 4444 | Internal only |
| Selenium noVNC | 7900 | Internal only; available through authenticated `/viewer/*` |
| cloudflared metrics | 2000 | Internal only |

Caddy exposes these routes on the single origin:

- `/api/*` proxies to NestJS without rewriting the path.
- `/api/v1/shopping/ws` and its subpaths explicitly proxy WebSocket upgrades to NestJS. Caddy also supports WebSocket upgrades on the general `/api/*` proxy.
- `/viewer/*` first makes a forward-auth request to NestJS at `/internal/v1/viewer/authorize`, then strips `/viewer` and proxies to noVNC.
- `/health`, `/health/live`, and `/health/ready` proxy to the existing NestJS health controller.
- `/_gateway/health` reports only Caddy process health.
- Every other path returns 404. In particular, FastAPI, WebDriver, direct noVNC, and the viewer authorization endpoint are not public routes.

The WebDriver URL for containers is `http://browser:4444/wd/hub`. The noVNC upstream is `http://browser:7900`. The screen and Chromium window are both configured as 1280x800, and the AI integration must preserve that size when creating or reusing a session. Phase 1 allows exactly one active Selenium session. Browser extension loading is disabled, VNC is view-only, and access control lives at Caddy rather than in noVNC.

## NestJS and FastAPI integration contracts

The current repository does not yet implement the shopping socket or viewer authorization handler. Until the authorization handler exists, Caddy forwards the authorization subrequest to NestJS and NestJS returns 404, so viewer access remains fail-closed.

NestJS must add `GET /internal/v1/viewer/authorize` with this contract:

- Accept the original `Authorization` header or a secure viewer-session cookie. Caddy supplies `X-Forwarded-Method` and `X-Forwarded-Uri` for the original viewer request.
- Verify `X-DealPilot-Viewer-Auth` against `VIEWER_AUTH_SHARED_SECRET` using a timing-safe comparison.
- Return 2xx only for a live, unexpired viewer grant that is authorized for the current user and browser session. Return 401 for missing/expired credentials and 403 for a valid user who does not own the session.
- Optionally return `X-DealPilot-Viewer-Session`; Caddy copies it for downstream request processing but removes credentials before proxying to noVNC.
- Never redirect an unauthorized request and never treat a network or dependency error as authorization success.
- Implement the shopping WebSocket endpoint at `/api/v1/shopping/ws`, authenticate it during the upgrade, enforce user/session ownership, and handle reconnect and token expiry.

NestJS can reach FastAPI at `http://ai-service:8000`, and FastAPI receives `AI_NEST_API_INTERNAL_URL`, `AI_SELENIUM_REMOTE_URL`, and `AI_INTERNAL_SERVICE_TOKEN`. The existing FastAPI settings ignore these extra values today; its future browser orchestration must declare them, authenticate internal calls, create at most one remote session, request a 1280x800 window, and always quit the session on completion or cancellation.

## Physical phone through Cloudflare Tunnel

Create a remotely-managed Cloudflare Tunnel and configure exactly one public hostname, for example `dealpilot-phase1.example.com`. Its only ingress service must be:

```text
http://gateway:8080
```

Copy only the tunnel token into `CLOUDFLARE_TUNNEL_TOKEN` in `infra/phase1/.env`. Compose passes it as `TUNNEL_TOKEN`, so it is not placed in the cloudflared command line. Cloudflare terminates HTTPS and WSS; Caddy receives HTTP on the private Docker network. Do not add public hostnames or ingress rules for API, FastAPI, Selenium, noVNC, or PostgreSQL.

Set the Expo client value to the origin, with no trailing path:

```dotenv
EXPO_PUBLIC_API_URL=https://dealpilot-phase1.example.com
```

The current Expo config reads this value at bundle/start time. Reload the app after changing it. It is public configuration, not a secret. Use `https://` API URLs and derive shopping sockets from the same host with `wss://`; do not configure a second socket or viewer origin. For browser-based noVNC access, prefer a short-lived, `Secure`, `HttpOnly`, same-origin cookie because browser WebSockets cannot reliably attach an arbitrary bearer header. Never put viewer credentials in the viewer URL or query string.

## Token rotation and tunnel shutdown

- Viewer grants should be single-session, short-lived (five minutes or less), revocable, and rotated whenever ownership changes, the WebView reconnects after expiry, or the browser session ends.
- Rotate `JWT_SECRET`, `INTERNAL_SERVICE_TOKEN`, or `VIEWER_AUTH_SHARED_SECRET` by updating the secret store/environment and recreating both dependent services. Rotating JWT signing material should support an overlap/key-ID period if uninterrupted sessions are required.
- Rotate a Cloudflare Tunnel token in the Cloudflare dashboard, replace `CLOUDFLARE_TUNNEL_TOKEN`, then run:

```powershell
docker compose --env-file infra/phase1/.env -f infra/phase1/docker-compose.yml --profile cloud-tunnel up -d --force-recreate cloudflared
```

- Immediately revoke the old tunnel token after the replacement connector is healthy.
- For a temporary shutdown, stop the connector:

```powershell
docker compose --env-file infra/phase1/.env -f infra/phase1/docker-compose.yml --profile cloud-tunnel stop cloudflared
```

- For an incident or permanent shutdown, stop cloudflared, disable/delete the public hostname route, and revoke the connector token in Cloudflare. Stopping a container alone does not revoke a copied token.

## Safe diagnostics

```powershell
docker compose --env-file infra/phase1/.env -f infra/phase1/docker-compose.yml --profile local-only ps
docker compose --env-file infra/phase1/.env -f infra/phase1/docker-compose.yml --profile local-only logs --tail 100 gateway api ai-service browser
```

Do not publish or temporarily map ports 3000, 8000, 4444, 7900, or 5432 for troubleshooting. Use `docker compose exec` from inside the stack instead.
