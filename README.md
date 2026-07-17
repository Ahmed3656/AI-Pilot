# DealPilot Egypt MVP

DealPilot is an Egypt-only shopping assistant for retail, food, and cinema comparisons. The fixed market is `EG`, currency is `EGP`, business timezone is `Africa/Cairo`, and supported locales are `ar-EG` and `en-EG`. Category selection may be automatic or explicitly retail, food, or cinema.

The AI may search approved Egypt merchants, compare complete totals, test public coupons, and prepare a reversible cart or booking flow. It must never submit a purchase, place an order, confirm checkout or a booking, enter payment data, or perform any final irreversible action. The user completes those steps during temporary control of the same paused browser session.

## Repository layout

```text
apps/api/             NestJS control API and PostgreSQL migrations
apps/mobile/          Expo mobile client
services/ai-service/  FastAPI/OpenAI/Selenium browser agent
infra/phase1/         Canonical Compose, Caddy, health, smoke, and deployment docs
docs/                 Frozen MVP contract and acceptance matrix
```

## Install and verify

Use Node.js 22+, npm 10+, Python 3.12+, and Docker Compose 2.24+.

```powershell
npm run setup
npm run check
```

`npm run check` runs formatting checks, API/mobile/AI lint and type checks, contract and infrastructure tests, API/AI tests, and builds.

## Start the complete MVP

Set the OpenAI key in the current process. The first command creates ignored local service configuration with random secrets; it never commits or prints their values.

```powershell
$env:AI_OPENAI_API_KEY = '<your runtime key>'
npm run mvp:start
npm run mvp:smoke
```

Only the Caddy gateway binds locally, at `http://localhost:8080` by default. PostgreSQL, API, AI, WebDriver, and noVNC stay on private Compose networks. The migration job must complete and schema-aware readiness must pass before the gateway becomes healthy.

Root lifecycle commands:

| Command               | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `npm run mvp:config`  | Validate Compose without displaying interpolated secrets |
| `npm run mvp:build`   | Build all local application images                       |
| `npm run mvp:start`   | Build, migrate, start, and wait for health               |
| `npm run mvp:stop`    | Stop while preserving the database volume                |
| `npm run mvp:logs`    | Follow redacted logs                                     |
| `npm run mvp:migrate` | Run migrations explicitly                                |
| `npm run mvp:health`  | Check schema and real internal authentication            |
| `npm run mvp:smoke`   | Check routing, isolation, and viewer view/control modes  |
| `npm run mvp:clean`   | Stop and remove the local database volume                |

`npm run mvp:clean` deletes local Phase 1 database data. See [infra/phase1/README.md](infra/phase1/README.md) for profiles, routes, viewer security, Cloudflare Tunnel setup, credential rotation, and validation details.

## Local component development

The non-container development commands remain available:

```powershell
npm run dev:api
npm run dev:ai
npm run dev:mobile
```

Useful focused checks include `npm run test:infra`, `npm run test:contract`, `npm run typecheck`, `npm run lint`, and `npm run build`. Database development helpers use the `db:migration:*` prefix; Docker helpers delegate to the canonical `mvp:*` stack.

Mocks and local HTML fixtures are allowed in automated tests, but must never be represented as a successful live merchant demonstration. Never commit API keys, tokens, addresses, private screenshots, viewer URLs, cookies, payment data, or other secrets.
