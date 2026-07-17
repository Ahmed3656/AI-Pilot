# DealPilot Egypt MVP

DealPilot is an Egypt-only shopping assistant for retail, food, and cinema comparisons. It uses the fixed `EG` market, `EGP`, `Africa/Cairo`, and the `ar-EG`/`en-EG` locales. It can compare approved merchants, test public coupons, and prepare a reversible cart or booking state. It cannot submit an order, confirm a booking, enter payment data, or perform another irreversible action.

## What is running

The repository is an integrated application, not a set of placeholders:

- `apps/mobile` is the Expo client. It registers or signs in users, calls the canonical `/api/v1` API, reconnects to run events, displays reports, and embeds the authorized noVNC handoff.
- `apps/api` is the NestJS control plane. It owns authentication, state transitions, approvals, leases, event history, report persistence, PostgreSQL migrations, and all public routes.
- `services/ai-service` is the private FastAPI worker. It drives one remote Selenium Chromium session, calls OpenRouter in live mode, applies browser safety checks, and reports canonical events back to the API.
- `infra/phase1` contains the Compose runtime. Caddy is the only published service; PostgreSQL, API, AI, Selenium, and noVNC stay on private networks.

The full service and data-flow description is in [docs/architecture.md](docs/architecture.md). The frozen wire contract is [docs/mvp-contract.md](docs/mvp-contract.md).

## Fast client-demo start

Docker Engine/Compose 2.24+ and Node.js 22+/npm 10+ are required. From the repository root:

```bash
npm ci
npm run demo
```

`npm run demo` deletes only the local demo database volume, builds the complete stack, runs migrations, starts a clearly marked deterministic test adapter, exercises API -> AI -> real Selenium -> API, creates a demo account and completed report, and leaves every service running. The terminal prints the local demo credentials and report run ID. The adapter uses simulated merchant data and is never presented as a live OpenRouter/merchant result.

In a second terminal, start only the Expo frontend:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8080 EXPO_PUBLIC_AUTH_REQUIRED=true npm run start
```

The root `npm run start` intentionally starts only Expo; the backend remains in Docker. See [docs/phase1-demo.md](docs/phase1-demo.md) for exact live-mode, phone, demonstration, troubleshooting, and shutdown commands.

## Live OpenRouter mode

Generate the ignored runtime file, then put your OpenRouter key in `infra/phase1/.env`:

```bash
npm run mvp:config
# Edit infra/phase1/.env:
# AI_OPENROUTER_API_KEY=sk-or-v1-your-key
# AI_MODEL=openai/gpt-5.2
npm run mvp:start
npm run mvp:smoke
```

By default only `http://localhost:8080` is published. For a physical phone on a trusted LAN, set `DEALPILOT_GATEWAY_BIND=0.0.0.0`, set both public/mobile origins to the computer's LAN address, and restart the stack. The lifecycle command creates `infra/phase1/.env` with independent random local secrets; Git ignores this file. Compose mounts the OpenRouter key from that file as a secret granted only to the AI container. The live adapter uses OpenRouter's stateless Responses API through the OpenAI-compatible Python client and sends full conversation/tool history on each turn.

## Verification and lifecycle

Run the complete repository gate using the pinned Node 22 and Python 3.12 Docker environments:

```bash
npm run check:docker
```

Useful runtime commands are:

| Command              | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `npm run mvp:config` | Validate Compose without printing interpolated secrets           |
| `npm run mvp:build`  | Build the production API and AI images                           |
| `npm run mvp:start`  | Build, migrate, start, wait, and verify service-to-service auth  |
| `npm run mvp:health` | Check containers, schema, API <-> AI auth, Selenium, and gateway |
| `npm run mvp:smoke`  | Check canonical routes, private ports, and log privacy           |
| `npm run mvp:logs`   | Follow redacted application logs                                 |
| `npm run mvp:stop`   | Stop containers while preserving PostgreSQL data                 |
| `npm run mvp:clean`  | Stop containers and delete the local PostgreSQL volume           |

## Dependency lock files

`package-lock.json`, `services/ai-service/requirements.lock.txt`, and `services/ai-service/requirements-dev.lock.txt` are generated lock files and should be committed to GitHub.

- `requirements.lock.txt` pins the AI service's production dependency graph used by its Docker image.
- `requirements-dev.lock.txt` pins that same graph plus `pytest`, `pytest-asyncio`, `ruff`, and their transitive development dependencies.
- The many `sha256` lines are package-file integrity hashes. They let `pip --require-hashes` reject an unexpected or modified artifact; they are deliberately verbose, not corrupted data.

Edit dependency ranges in `services/ai-service/pyproject.toml`, regenerate the locks, and commit the source and generated changes together. Do not hand-edit the lock files. `npm run locks:check` verifies that the JavaScript workspaces and both Python locks are structurally synchronized.

Never commit runtime `.env` files, API keys, bearer/viewer tokens, addresses, cookies, private screenshots, or generated demo state.
