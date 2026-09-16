# Aevo Store Operations Platform

Phase 0 foundation for a multi-tenant store operations platform. POS, catalog,
kiosk, KDS, queue, payment providers, LINE and Odoo remain later phases; the
foundation already provides the shared tenant/auth/event boundaries they need.

## Architecture

```text
Cloudflare Worker
├── Astro static assets (/, /login, /staff)
└── Elysia API (/health, /ready, /api/*)
       │
       └── Supabase Auth + PostgreSQL (RLS enabled)
```

```text
apps/
  worker/              Single Worker entrypoint and API/static routing
  api/                  Elysia routes, auth boundary, request IDs and errors
  web/                  Astro public entry, login and authenticated staff shell
packages/
  auth/                Supabase Auth adapter and permission checks
  config/              Fail-fast environment validation
  contracts/           Shared API/domain types
  db/                  Supabase client, tenant repositories and seed command
supabase/
  migrations/          PostgreSQL schema, role matrix and RLS policies
```

The Worker is a modular monolith: the browser talks to same-origin `/api/*`
routes, while the server-only Supabase secret key stays inside the Worker.
Supabase Auth owns password/JWT/refresh-token handling. Membership and role
data are read from PostgreSQL on every request, so disabling a membership takes
effect without waiting for a custom session cache.

## Requirements

- Bun 1.2.21+
- A Supabase project
- Node.js/npm only for the pinned Supabase and Wrangler CLIs

## Supabase project setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **Project Settings → API**, copy the project URL and the server-only
   **Secret key**. The legacy `service_role` key is also accepted.
3. Apply the migration. With the Supabase CLI:

   ```bash
   npx --yes supabase@2.117.0 login
   npx --yes supabase@2.117.0 link --project-ref <project-ref>
   npx --yes supabase@2.117.0 db push
   ```

   Or paste `supabase/migrations/20260916083047_foundation.sql` into the
   Supabase SQL Editor and run it once.

The migration creates the organization → optional brand → store model,
Supabase-user profiles, memberships, roles/permissions, explicit store access,
domain/outbox events, idempotency keys and audit logs. RLS is enabled on every
public application table. `private.is_org_member` and
`private.has_org_permission` are non-exposed `SECURITY DEFINER` helpers with a
fixed search path; no browser key can bypass tenant policies.

## Create the first admin/owner

The seed command uses the Supabase Admin Auth API and must run as a one-off
server-side command. Never put its secret or password in `apps/web`, an Astro
`PUBLIC_*` variable, or source control.

```bash
cp .env.example .env
# edit SUPABASE_URL, SUPABASE_SECRET_KEY and the SEED_* values
bun install
bun run db:seed
```

`SEED_INITIAL_ROLE=OWNER` is the default. Set it to `ADMIN` when the first
account should not be the owner. Running the seed again is idempotent for the
same email/organization/store and updates that Auth user's password.

## Local development

```bash
cp .env.example .env
bun install
bun run db:seed
bun run dev:api
```

In another terminal run the Astro site:

```bash
PUBLIC_API_URL=http://localhost:3001 bun run dev:web
```

Open [http://localhost:4321/login](http://localhost:4321/login), then use the
seed email/password. For a same-origin Worker preview, put the values below in
`.dev.vars` (do not commit that file) and run:

```bash
bun run build
npx --yes wrangler@4.132.0 dev --config wrangler.jsonc
```

## Cloudflare deployment

The root `wrangler.jsonc` intentionally targets the Worker entrypoint and
uploads `apps/web/dist` as the `ASSETS` binding. This fixes the previous
workspace-root detection error: Cloudflare now sees an actual Worker with a
single deployment for UI and API.

Build command:

```bash
bun run build
```

Deploy command:

```bash
npx --yes wrangler@4.132.0 deploy --config wrangler.jsonc
```

Set these under **Workers & Pages → Settings → Variables and Secrets** for
Preview and Production. Use **Encrypt** for the Supabase secret:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Supabase server-only Secret key (or `SUPABASE_SERVICE_ROLE_KEY`) |
| `WEB_ORIGIN` | Exact public Worker origin, e.g. `https://pos.example.com` |
| `SESSION_COOKIE_NAME` | Optional; default `aevo_session` |
| `SESSION_COOKIE_SAME_SITE` | Optional; use `lax` for same-origin Worker UI |
| `LOG_LEVEL` | Optional: `info`, `warn`, `error` or `debug` |

Do not set `SUPABASE_SECRET_KEY` as `PUBLIC_SUPABASE_*`, do not commit it to
`wrangler.jsonc`, and do not expose it to the browser. The frontend uses a
relative `/api` URL in production; `PUBLIC_API_URL` is only needed when running
the Astro site separately during local development.

The first user is still created by the one-off `bun run db:seed` command above;
the Worker deliberately has no public setup endpoint.

## Environment

See `.env.example` for a complete local template.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL; required |
| `SUPABASE_SECRET_KEY` | Server-only key; required (service-role alias accepted) |
| `WEB_ORIGIN` | Exact origin allowed for credentialed API requests; required |
| `API_HOST` / `API_PORT` | Local Bun API listener; defaults to `0.0.0.0:3001` |
| `SESSION_COOKIE_NAME` | HttpOnly cookie name; default `aevo_session` |
| `SESSION_COOKIE_SAME_SITE` | `lax`, `strict` or `none`; `none` requires production HTTPS |
| `LOG_LEVEL` | `debug`, `info`, `warn` or `error` |
| `PUBLIC_API_URL` | Optional API origin for a separately served Astro dev site |
| `SEED_*` | One-off initial Auth user, role, organization and store values |

## Verification

```bash
bun run typecheck
bun test packages apps
bun run build
npx --yes wrangler@4.132.0 deploy --dry-run --config wrangler.jsonc
```

The checked-in tests cover Supabase Auth adapter behavior, login/logout cookies,
RBAC, tenant-safe store access, request IDs, readiness/error responses and
Worker API-vs-assets routing. A live Supabase query should be run after setting
your project secrets (`bun run db:seed` performs several authenticated queries);
this repository does not contain or guess your project credentials.

## Security decisions

- Supabase Auth handles password hashing, JWT signing and refresh rotation.
- Access/refresh tokens are stored only in an HttpOnly, SameSite cookie; no
  token is placed in the Astro bundle.
- Production cookies are marked `Secure`.
- Every principal is resolved from an active Supabase user profile and active
  tenant membership; the requested organization header is only a selector.
- Store reads are constrained by organization and explicit membership-store
  access (OWNER/ADMIN are elevated by role).
- Login has a per-Worker rate limiter; use a shared limiter before scaling to
  multiple Worker instances if needed.
- Domain/outbox/idempotency/audit tables have no browser write policies.
- Structured logs exclude password, token, cookie and integration-secret data.

## Known Phase 0 limitations

- No self-service registration, password reset, MFA or passkeys UI.
- No organization switcher UI when a user belongs to multiple organizations.
- The login limiter is instance-local.
- Device identity, WebSocket rooms, offline POS, orders, catalog and external
  integrations belong to later phases.
- The staff cards prove authorized store retrieval; operational workspaces are
  intentionally placeholders until Phase 1/2.
- Transactional order/outbox commands should use a Postgres function/RPC or a
  server-side transaction when those domains are implemented; the current
  foundation only reads through PostgREST.

## Recommended Phase 1 order

1. Categories, products and variants with organization-scoped SKU constraints.
2. Modifier groups/modifiers and flexible menu composition.
3. Menus/menu items with store and channel availability.
4. Sold-out overrides and effective-availability queries.
5. Catalog administration UI and audit events.
6. Coffee-shop acceptance fixture covering size, temperature, milk and extras.
