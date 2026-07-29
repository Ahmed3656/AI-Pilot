# Repository guidance

## Layout and runtime

- `apps/api` is the NestJS API, `apps/mobile` is the Expo client, and `services/ai-service` is the FastAPI browser-agent service.
- `infra/phase1` contains the canonical local stack and operational checks; `docs` contains contracts and source-of-truth documents.
- Use Node.js 22+ with npm 10+ and Python 3.12+. Run `npm run doctor` after setup if the runtime is uncertain.

## Validation

- Use focused checks while changing a component: `npm run test:api`, `npm run test:mobile`, `npm run test:ai`, `npm run test:contract`, or `npm run test:infra` as appropriate.
- Before handoff, run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` (or explain a blocked check precisely).
- Do not weaken a gate to make it pass; diagnose and correct the failure.

## Migration and authority

- Preserve legacy shopping behavior and keep it isolated while the autonomous-testing platform is introduced beside it. Do not reuse shopping concepts with misleading new meanings.
- Source-of-truth precedence is: the autonomous-testing source of truth for the pivot, the MonetizePilot document for that separate direction, existing DealPilot contracts for the implemented MVP until replaced by a versioned testing contract, then implementation over aspirational prose.
- Do not edit either pivot source-of-truth document without explicit authorization. Never represent planned behavior as implemented.

## Safety and review

- Automated tests use fixtures, mocks, and authorized local targets only; never test live targets or trigger irreversible external actions.
- Keep API keys, tokens, credentials, cookies, payment data, private screenshots, and viewer URLs out of code, logs, events, fixtures, and documentation. Preserve private-network, authentication, tenant, and scoped-token boundaries.
- Review changes for contract compatibility, migrations and recovery, authorization/tenant isolation, secret redaction, and the focused tests that prove the behavior. Preserve unrelated worktree changes.

## Comments

- Write short human comments only for non-obvious invariants, concurrency, security, recovery, compatibility, or deliberate tradeoffs.
- Never narrate obvious code or leave speculative TODO prose.
