# DealPilot architecture

## Runtime boundaries

DealPilot runs as one public edge and five private workloads:

| Component                          | Responsibility                                                                                                         | Network exposure                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Expo mobile (`apps/mobile`)        | Authentication, run commands, reports, event reconnect/deduplication, and remote-browser handoff UI                    | Calls the Caddy origin only                                 |
| Caddy gateway                      | `/api/v1`, event WebSocket, viewer authorization, and noVNC proxy                                                      | Host loopback `127.0.0.1:8080`; optional Cloudflare profile |
| NestJS API (`apps/api`)            | Canonical public contract, auth, run state machine, idempotency, approvals, leases, history, reports, and secret vault | Private `control-plane` and `data-plane`                    |
| PostgreSQL                         | Durable accounts, run/control state, events, evidence metadata, offers, and reports                                    | Private `data-plane`                                        |
| FastAPI AI (`services/ai-service`) | OpenRouter orchestration, safety enforcement, canonical internal commands/events, and per-run browser lifecycle        | Private `control-plane` and `agent-egress`                  |
| Selenium Chromium/noVNC            | The single browser session used by both AI and human handoff                                                           | Private `control-plane` and `agent-egress`                  |

The one-shot `migrate` workload runs every time the stack starts. The API does not start until all TypeORM migrations succeed, and API readiness checks for the required shopping tables.

## Canonical request and event flow

```text
Expo -> Caddy -> NestJS API -> FastAPI AI -> Selenium/merchant
                    ^                |
                    +-- events ------+
                    |
                    +-> PostgreSQL -> REST history/report

Expo <- Caddy <- API WebSocket replay + live events
Expo -> Caddy -> API viewer authorization -> same Selenium noVNC session
```

1. Mobile sends authenticated requests to the origin plus `/api/v1`; it never calls AI, PostgreSQL, WebDriver, or noVNC directly.
2. The API persists the run ID, calls `POST /internal/v1/runs` using `X-Internal-Token`, and changes public state only after an AI command is accepted.
3. AI opens one Selenium session, requests explicit domain/address/seat-hold approvals when required, and posts exact event envelopes to `POST /internal/v1/ai-events`.
4. The API validates event state and references, materializes the report records, appends the durable event, and then publishes it to the WebSocket stream.
5. A reconnecting mobile client supplies its last processed event ID, deduplicates by ID, and can fall back to REST event history and run polling.
6. A view or control viewer token is issued by POST and sent only in an authorization header/cookie. Caddy privately authorizes it before proxying the same noVNC session; the token is never placed in a URL.

The live AI adapter calls OpenRouter's stateless Responses endpoint with `openai/gpt-5.2`. It uses standard function tools for Selenium actions and incremental discoveries, resubmits the complete prior response/tool history on every model turn, and includes the latest redacted screenshot. The installed `openai` Python package is only the OpenAI-compatible protocol client; live requests use the fixed `https://openrouter.ai/api/v1` base URL.

## Ownership and failure rules

- The API is authoritative for public state, approvals, leases, report persistence, and idempotency.
- The AI service is authoritative for its in-memory execution/browser lifecycle. `ready_for_handoff` keeps the browser alive; terminal state or absolute TTL closes it.
- API state is not advanced when an internal AI command rejects or times out.
- Economic evidence is complete before the transition to `ready_for_handoff`; the final report is immutable afterward.
- Merchant attempts can fail independently. Failed attempts and incomplete offers remain visible in the final report rather than disappearing.
- One browser session and one controller are allowed. Claim pauses AI before the lease becomes active; release resumes AI against the same WebDriver session and cookies.

## Security boundaries

- Caddy is the only published container port. Internal routes return `404` at the edge.
- Public users use JWT access/refresh sessions. Service calls use a separate internal token. Viewer JWTs use a third independent secret and short TTL.
- Address plaintext exists only in the API process-memory vault and is resolved one semantic field at a time for the active approved merchant.
- Logs redact configured secrets, bearer/query tokens, viewer URLs, address fields, and screenshot/base64 data.
- The AI browser safety layer rejects unapproved domains, login/payment fields, final actions, unsafe redirects, and unsupported computer actions.
- The deterministic adapter is enabled only with `AI_ENVIRONMENT=test`; it is visibly labeled and is blocked from the cloud-tunnel profile.

## Source boundaries

- Feature DTOs, entities, controllers, services, and repositories stay inside their owning API/mobile feature modules.
- `docs/mvp-contract.md` and `docs/contracts/mvp-contract.openapi.json` define the shared external/internal wire vocabulary.
- `infra/phase1/docker-compose.yml` is the canonical runtime. The root Compose file only includes it.
- `services/ai-service/pyproject.toml` declares Python dependency ranges; hash-pinned production/development lock files are generated artifacts committed beside it.
