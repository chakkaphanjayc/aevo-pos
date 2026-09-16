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
  db/                  MongoDB driver, migrations, seed and tenant-scoped repositories
```

The application begins as a modular monolith. MongoDB Atlas is the production
database; tenant scope is represented by `organizationId`, and store access is
authorized server-side from the authenticated membership. UUID strings are used
as document `_id` values so API contracts remain stable while MongoDB indexes
enforce tenant-safe uniqueness.

## Requirements

- Bun 1.2.21+
- MongoDB Atlas, or MongoDB 8 through Docker Compose

## Local setup

```bash
cp .env.example .env
docker compose up -d mongodb
bun install
bun run db:migrate
bun run db:seed
bun run dev:api
```

In a second terminal:

```bash
PUBLIC_API_URL=http://localhost:3001 bun run dev:web
```

Open `http://localhost:4321`. Change `SEED_OWNER_PASSWORD` before running the
seed; it must have at least 12 characters. The seed creates the initial user
with `SEED_INITIAL_ROLE=OWNER` by default; use `SEED_INITIAL_ROLE=ADMIN` when
the account should be an Admin instead.

After seeding, sign in at `/login` with `SEED_OWNER_EMAIL` and
`SEED_OWNER_PASSWORD`. The login session is an HttpOnly cookie; the browser
never receives the MongoDB URI or the password hash. Use the logout button to
revoke the current session.

To run the database integration test locally, start the second MongoDB service:

```bash
docker compose up -d mongodb-test
bun run test:integration
```

## MongoDB Atlas

Create a database user and an Atlas cluster, add the API host to the cluster
network access list, then set `MONGODB_URI` to the Atlas SRV connection string:

```dotenv
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DATABASE=aevo
```

Replace `<password>` with the database user's URL-encoded password. For
example, `@` becomes `%40`. The Atlas URI belongs in the API host's server-side
environment, not in the Astro app or any `PUBLIC_*` variable.

The API connects with the official MongoDB Node.js driver, keeps a bounded
connection pool, and fails fast if the cluster cannot be selected. Keep the URI
in server-side environment variables only; never expose it through Astro
`PUBLIC_*` variables.

## Cloudflare deployment

The web app is an Astro static site. The repository-level `wrangler.jsonc`
uploads the generated `apps/web/dist` directory as a Workers Static Assets
deployment. Keeping this config at the repository root is intentional: it
allows Cloudflare's root-level deploy command to resolve the monorepo project.

For a Cloudflare Workers build, keep the build command as:

```bash
bun run build
```

The existing deploy command works with this config:

```bash
npx wrangler deploy
```

For a pinned, reproducible command, use:

```bash
npx --yes wrangler@4.132.0 deploy --config wrangler.jsonc
```

The repository also exposes the same deployment as:

```bash
bun run deploy:web
```

The Astro site is static and does not contain the Bun API process. Deploy the
Elysia API separately on a Bun-compatible host and set `PUBLIC_API_URL` to that
API origin when building the web app.

When deploying this repository through Cloudflare Workers, configure
`PUBLIC_API_URL` under the Worker build environment for both Preview and
Production, then redeploy. It must point to the public Elysia API URL; setting
it as a runtime secret does not rewrite an already-built Astro bundle. Keep
`MONGODB_URI`, `MONGODB_DATABASE`, `WEB_ORIGIN`, `SEED_OWNER_EMAIL`,
`SEED_OWNER_PASSWORD`, and `SEED_INITIAL_ROLE` on the API host or in a one-off
server-side seed command. Do not put them in `wrangler.jsonc` or `PUBLIC_*`.

## Environment

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB or MongoDB Atlas connection URI; required |
| `MONGODB_DATABASE` | Database name, defaults to `aevo` |
| `WEB_ORIGIN` | Exact browser origin allowed to make credentialed API requests |
| `API_HOST` / `API_PORT` | API listener, defaults to `0.0.0.0:3001` |
| `SESSION_COOKIE_NAME` | HttpOnly session cookie name |
| `SESSION_COOKIE_SAME_SITE` | `lax`, `strict`, or `none`; use `none` only with HTTPS and a cross-site web/API deployment |
| `SESSION_TTL_HOURS` | Session lifetime, defaults to 168 hours |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error` |
| `PUBLIC_API_URL` | API origin embedded into the Astro frontend |
| `TEST_MONGODB_URI` / `TEST_MONGODB_DATABASE` | Integration-test MongoDB target |
| `SEED_*` | Initial user, role, organization and store values; `SEED_INITIAL_ROLE` supports `OWNER` or `ADMIN` (default `OWNER`) |

## Database foundation

`bun run db:migrate` applies the versioned MongoDB foundation migration. It
creates collections and indexes for:

- Organization → optional Brand → Store
- User → Membership → Role → Permission codes
- Explicit non-owner membership-to-store access
- Opaque, hashed, revocable sessions with TTL cleanup
- Domain events and outbox events
- Tenant-scoped idempotency keys
- Audit logs

The migration runner records a checksum in `schema_migrations` and fails if an
already-applied migration is changed. Relational identity fields are modeled as
document fields, while JSON-like payloads are reserved for immutable event,
provider and audit metadata.

## Verification

```bash
bun run typecheck
bun test
bun run build
```

`bun test` runs unit tests everywhere and runs the MongoDB tenant-isolation test
when `TEST_MONGODB_URI` is set. CI starts MongoDB, applies migrations,
type-checks, runs all tests, and builds both applications.

## Security decisions

- Passwords use Bun Argon2id.
- Raw session tokens are only sent in HttpOnly, SameSite cookies; only hashes are persisted.
- Production cookies are marked Secure.
- The requested organization header is treated only as a selector and must match an active membership.
- Store reads include the principal's organization and explicit store authorization.
- Login has a basic per-process rate limiter. Replace it with a shared limiter before horizontally scaling the API.
- Structured logger excludes password/token/secret/cookie fields.
- MongoDB Atlas credentials stay server-side and should be managed with deployment secret storage.

## Known Phase 0 limitations

- No self-service registration, password reset, MFA, or passkeys.
- No UI for switching between multiple organization memberships yet.
- The in-memory login limiter is instance-local.
- Device identity, WebSocket rooms, offline cache, domain-specific orders, catalog and integrations belong to later phases.
- The current staff cards prove authorized store retrieval but remain disabled until the first operational workspace is implemented.
- MongoDB transactions are exposed by the database adapter for later order/outbox commands; the Phase 0 seed is idempotent and also works against a standalone local MongoDB container.

## Recommended Phase 1 order

1. Categories, products and variants with organization-scoped SKU constraints.
2. Modifier groups/modifiers and variant-independent menu composition.
3. Menus and menu items with store/channel availability.
4. Store sold-out overrides and effective-availability queries.
5. Catalog administration UI and audit events.
6. Coffee-shop acceptance fixture covering size, temperature, milk and extras.
