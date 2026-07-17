# Phase 1 demo runbook

All commands below run from the repository root. The backend, database, AI service, browser, migrations, and gateway run in Docker. `npm run start` is reserved for the Expo frontend and is intentionally not part of the backend start command.

## Setup

Required software:

- Docker Engine/Desktop with Compose 2.24 or newer
- Node.js 22 or newer and npm 10 or newer

Install the JavaScript workspace exactly from `package-lock.json` and validate Docker:

```bash
npm ci
docker compose version
npm run mvp:config
```

Optional full pre-demo repository gate (Node 22 and Python 3.12 both run in Docker):

```bash
npm run check:docker
```

## Start a deterministic client demo

This is the simplest copy-paste command. It deletes only the local Phase 1 database volume, builds all production services, runs migrations, enables the clearly marked deterministic test adapter, proves the complete integration flow, seeds a demo account/completed report, and leaves the stack running:

```bash
npm run demo
```

The command prints:

- demo email and password;
- the seeded completed report run ID;
- a confirmation that integration smoke passed and Docker remains running.

The deterministic adapter still uses the real API, PostgreSQL, AI process, Selenium Grid, Chromium screenshot, Caddy, WebSocket, and noVNC path. Only the OpenRouter/merchant result is simulated. Say this explicitly during a client demo; it is not a live merchant result.

Check the running services at any time:

```bash
npm run mvp:health
npm run mvp:smoke
npm run docker:ps
```

## Start the mobile frontend

In a separate terminal at the repository root:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8080 EXPO_PUBLIC_AUTH_REQUIRED=true npm run start
```

The root command starts Expo only. It does not start a second API or AI process.

For Expo Web, press `w`. For a simulator on the same machine, use its host-loopback mapping if `localhost` is not forwarded. A physical phone cannot reach a gateway bound to host loopback; use the HTTPS tunnel profile described below and set `EXPO_PUBLIC_API_URL` to that HTTPS origin.

Sign in with the credentials printed by `npm run demo`. The seeded report run ID is also written to ignored `infra/phase1/.demo-state.json`. The completed seed leaves the single browser slot free, so the mobile app can create a fresh run and exercise approval, comparison, WebSocket updates, handoff, and report screens.

## Demonstration sequence

1. Sign in or register through the mobile UI. Authentication calls `/api/v1/auth/*` through Caddy.
2. Create a retail request. Show that the app receives a canonical run ID and a domain approval request.
3. Approve only the desired Egypt merchant subset. Do not approve lookalike or unrelated domains.
4. Watch the timeline update over the WebSocket. Background/foreground the client once to demonstrate cursor replay and deduplication.
5. Open the report. Point out any incomplete offer and partial merchant failure rather than hiding it.
6. Claim control. Confirm the noVNC view becomes interactive only after the API lease is active.
7. Release control. Confirm the run returns to `ready_for_handoff` and the same browser session resumes.
8. Complete or cancel the run. Never submit a purchase, booking, order, payment, login, or OTP as part of the demo.

The automated seed already asserts the same-browser session ID before claim and after release, command-failure rollback, partial/incomplete report retention, live WebSocket plus reconnect history, canonical routing, and absence of known secrets/private fields in recent service logs.

## Start real OpenRouter/merchant mode

Do not run `npm run demo`; that command intentionally selects the test adapter. Create the ignored runtime file, then add the key to `infra/phase1/.env` without quotes:

```bash
npm run mvp:config
# Edit infra/phase1/.env and set:
# AI_OPENROUTER_API_KEY=sk-or-v1-your-key
# AI_MODEL=openai/gpt-5.2
npm run mvp:start
npm run mvp:smoke
```

PowerShell uses the same ignored file:

```powershell
npm run mvp:start
npm run mvp:smoke
```

Then start Expo in a second terminal with the mobile command above. Live mode does not pre-seed a fake merchant report; create or register the user through the app and run a read-only comparison. Stop before login, payment, order placement, booking confirmation, or another irreversible action.

## Physical-phone HTTPS profile

Configure a remotely managed Cloudflare Tunnel whose only upstream is `http://gateway:8080`, then run:

```bash
export DEALPILOT_PROFILE=cloud-tunnel
export DEALPILOT_PUBLIC_ORIGIN=https://dealpilot.example.com
export CLOUDFLARE_TUNNEL_TOKEN='<runtime tunnel token>'
npm run mvp:start
EXPO_PUBLIC_API_URL=https://dealpilot.example.com EXPO_PUBLIC_AUTH_REQUIRED=true npm run start
```

Set `AI_OPENROUTER_API_KEY` in `infra/phase1/.env` before starting this profile too. The selected `openai/gpt-5.2` model supports the vision/tool loop; its name identifies the model on OpenRouter, not a direct OpenAI credential.

The deterministic test adapter is deliberately blocked from the public tunnel profile. The phone uses the one HTTPS origin for HTTP, WebSocket, and viewer traffic.

## Troubleshooting

Show health and container state:

```bash
npm run mvp:health
npm run docker:ps
```

Follow redacted logs:

```bash
npm run mvp:logs
```

Re-run migrations and restart while preserving the database:

```bash
npm run mvp:migrate
npm run mvp:start
```

Recreate a deterministic demo from an empty local database:

```bash
npm run demo
```

If port 8080 is already in use, set `DEALPILOT_GATEWAY_PORT` and the matching public/mobile origin before starting. If the AI reports one-browser busy, complete/cancel the active run or recreate the deterministic demo. Do not publish PostgreSQL, API, AI, WebDriver, or noVNC ports as a workaround.

## Shutdown

Stop containers while preserving seeded PostgreSQL data:

```bash
npm run mvp:stop
```

Stop containers and delete the local Phase 1 database volume:

```bash
npm run mvp:clean
```

`mvp:clean` does not delete repository files. Runtime `.env`, demo state, API keys, tokens, addresses, cookies, and screenshots must not be committed.
