# AI Pilot

Production-minded foundation for a computer-use assistant. This repository intentionally contains no automation, agents, prompts, workflows, OCR, vision processing, or domain features.

The API includes a lightweight observability layer inspired by the proven Blooms Egypt setup: correlated structured logs, request/controller/provider timings, slow-operation warnings, database query fingerprints, and N+1 detection. Thresholds are configurable through environment variables, and sensitive fields are redacted.

## Repository layout

```text
apps/
  api/                 NestJS backend
  mobile/              Expo React Native app
services/
  ai-service/          FastAPI AI-service shell
docs/                  Architecture decisions
```

## Prerequisites

- Node.js 22+
- npm 10+
- Python 3.12+
- Docker Desktop (optional)

## Install

```bash
npm run setup
```

This installs Node dependencies, creates the repository-local Python environment, installs the AI service, and runs environment diagnostics. The repository includes `.nvmrc` and `.node-version` files targeting Node 22.

To refresh only the Python environment after moving the repository:

```bash
npm run setup:ai
```

## Run locally

Start the API (database integration is disabled unless `DATABASE_ENABLED=true`):

```bash
npm run dev:api
```

Start the mobile app in another terminal:

```bash
npm run dev:mobile
```

Start the AI service in another terminal:

```bash
npm run dev:ai
```

Or start API, mobile, and AI together with coordinated shutdown:

```bash
npm run dev
```

Endpoints:

- API health: `http://localhost:3000/health`, `/health/live`, `/health/ready`
- API documentation: `http://localhost:3000/docs`
- AI health: `http://localhost:8000/health`, `/health/live`, `/health/ready`

## Verify

```bash
npm run check
```

`check` runs formatting verification, linting, TypeScript checks, API and AI tests, and builds. Useful focused commands include:

| Command                     | Purpose                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `npm run doctor`            | Check Node, npm, Docker, Python, and installed dependencies    |
| `npm run dev:mobile:clear`  | Start Expo with a cleared Metro cache                          |
| `npm run dev:mobile:web`    | Start the Expo web target                                      |
| `npm run dev:api:debug`     | Start the API in watch/debug mode                              |
| `npm run build:all`         | Build the API and AI service and export the mobile web app     |
| `npm run test:api:watch`    | Run API tests in watch mode                                    |
| `npm run test:api:coverage` | Generate API test coverage                                     |
| `npm run lint:fix`          | Apply safe lint fixes across all services                      |
| `npm run format`            | Format TypeScript, JavaScript, JSON, Markdown, and Python      |
| `npm run health:check`      | Check running API and AI health endpoints                      |
| `npm run clean`             | Remove generated build, coverage, Expo, and Python cache files |
| `npm run mobile:doctor`     | Run Expo dependency and configuration diagnostics              |

Database migration helpers use the `db:migration:*` prefix. Docker lifecycle helpers use `docker:build`, `docker:up`, `docker:down`, `docker:logs`, and `docker:ps`.

## Docker

```bash
npm run docker:up
```

The Compose stack starts PostgreSQL, the API, and the AI service. The mobile app remains a local Expo development process.

## Extension rules

- Put feature-specific code inside its owning module or feature package.
- Keep `shared` and provider contracts business-neutral.
- Generate reviewed migrations; never enable schema synchronization in shared environments.
- Replace TODO placeholders only when implementing the corresponding feature packet.
