# Aevo Store Operations Platform

Phase 0 foundation for a multi-tenant store operations platform. This repository intentionally does not implement POS, catalog, kiosk, KDS, queue, payment providers, LINE, or Odoo yet.

## Architecture

```text
apps/
  api/                 Elysia HTTP API, auth endpoints, request IDs and error handling
  web/                 Astro public entry, login and authenticated staff shell
packages/
  auth/                Session, password and permission services
  config/              Fail-fast environment validation
  contracts/           Shared API/domain types
  db/                  Bun SQL client, migrations, seed and tenant-scoped repositories
```

The application begins as a modular monolith. PostgreSQL is shared across tenants; tenant scope is represented by `organization_id`, and store access is authorized server-side from the authenticated membership. Composite foreign keys prevent cross-tenant store references in tenant-owned join/event tables.

## Requirements

- Bun 1.2.21+
- PostgreSQL 17 (or Docker Compose)

## Local setup

```bash
cp .env.example .env
docker compose up -d postgres
bun install
bun run db:migrate
bun run db:seed
bun run dev:api
```

In a second terminal:

```bash
PUBLIC_API_URL=http://localhost:3001 bun run dev:web
```

Open `http://localhost:4321`. Change `SEED_OWNER_PASSWORD` before running the seed; it must have at least 12 characters.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL; required |
| `WEB_ORIGIN` | Exact browser origin allowed to make credentialed API requests |
| `API_HOST` / `API_PORT` | API listener, defaults to `0.0.0.0:3001` |
| `SESSION_COOKIE_NAME` | HttpOnly session cookie name |
| `SESSION_TTL_HOURS` | Session lifetime, defaults to 168 hours |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error` |
| `PUBLIC_API_URL` | API origin embedded into the Astro frontend |
| `SEED_*` | Initial local owner, organization and store values |

## Database foundation

- Organization → optional Brand → Store
- User → Membership → Role → Permission
- Explicit non-owner membership-to-store access
- Opaque, hashed, revocable sessions
- Domain events and transactional outbox tables
- Tenant-scoped idempotency keys
- Audit log foundation

The schema uses relational columns for identity and tenant boundaries. JSONB is limited to immutable event/audit metadata and stored idempotent responses.

## Verification

```bash
bun run typecheck
bun test
bun run build
```

For the PostgreSQL tenant-isolation test:

```bash
docker compose up -d postgres-test
bun run test:integration
```

CI starts PostgreSQL, applies migrations, type-checks, runs all tests, and builds both applications.

## Security decisions

- Passwords use Bun Argon2id.
- Raw session tokens are only sent in HttpOnly, SameSite cookies; only hashes are persisted.
- Production cookies are marked Secure.
- The requested organization header is treated only as a selector and must match an active membership.
- Store reads include the principal's organization and explicit store authorization.
- Login has a basic per-process rate limiter. Replace it with a shared limiter before horizontally scaling the API.
- Structured logger excludes password/token/secret/cookie fields.

## Known Phase 0 limitations

- No self-service registration, password reset, MFA, or passkeys.
- No UI for switching between multiple organization memberships yet.
- The in-memory login limiter is instance-local.
- Device identity, WebSocket rooms, offline cache, domain-specific orders, catalog and integrations belong to later phases.
- The current staff cards prove authorized store retrieval but remain disabled until the first operational workspace is implemented.

## Recommended Phase 1 order

1. Categories, products and variants with organization-scoped SKU constraints.
2. Modifier groups/modifiers and variant-independent menu composition.
3. Menus and menu items with store/channel availability.
4. Store sold-out overrides and effective-availability queries.
5. Catalog administration UI and audit events.
6. Coffee-shop acceptance fixture covering size, temperature, milk and extras.
