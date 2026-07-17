# Architecture

The repository contains three independently deployable foundations:

- `apps/api`: NestJS API, configuration, request context, health checks, optional PostgreSQL wiring, and auth/RBAC scaffolding.
- `apps/mobile`: Expo Router application with providers, navigation, theme, API client, React Query, storage, and placeholder screens.
- `services/ai-service`: FastAPI service with configuration, health checks, provider contracts, and empty capability boundaries.

## Dependency direction

Feature modules own their controllers, DTOs, services, repositories, and entities. Shared code must remain business-neutral and may not import a feature module. Infrastructure adapters implement stable ports; future AI agents, automation tools, and workflows belong in separate feature packets.

## Historical references

The backend conventions were studied at the RBAC-complete merge (`18ddc3c`). Later backend architecture was intentionally ignored. NxtPro was used only for reusable Expo/React Native and Python service organization; no football-specific code, prompts, models, or workflows were copied.
