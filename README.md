# Aevo Store Operations Platform

Phase 2 of a multi-tenant store operations platform. The React + Vite POS
console and Elysia API use Supabase Auth/PostgreSQL for the
tenant boundary, catalog and unified Order aggregate.

## Architecture

```text
Cloudflare Worker
├── React + Vite POS console (/, /auth/callback)
└── Elysia API (/health, /ready, /api/*)
       │
       └── Supabase Auth + PostgreSQL (RLS enabled)
```

```text
apps/
  worker/              Single Worker entrypoint and API/static routing
  api/                  Elysia routes, auth boundary, request IDs and errors
  pos-modern/           React + Vite operational console and SSO callback
packages/
  auth/                Supabase Auth adapter and permission checks
  config/              Fail-fast environment validation
  contracts/           Shared API/domain types
  db/                  Supabase client, tenant repositories and seed command
  ordering/            Pure order lifecycle and integer-unit pricing rules
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

   If using the SQL Editor instead, run every file in
   `supabase/migrations/` in filename order. Running only the foundation file
   leaves Store Core tables such as orders, cash sessions and devices missing.

The migration creates the organization → optional brand → store model,
Supabase-user profiles, memberships, roles/permissions, explicit store access,
domain/outbox events, idempotency keys and audit logs. RLS is enabled on every
public application table. `private.is_org_member` and
`private.has_org_permission` are non-exposed `SECURITY DEFINER` helpers with a
fixed search path; no browser key can bypass tenant policies.

If this project was migrated before Devices was added, run `bun run db:migrate`
again. The follow-up migrations `20260917210000_devices.sql` and
`20260917220000_permission_backfill.sql` create the device tables and repair
`devices.manage` for existing Owner, Admin and Branch Manager roles. After
deploying the web app, reload the Staff page once so the permission context is
refreshed.

The queue migration includes an expression-index fix required by PostgreSQL;
apply the migrations after pulling the latest code. If the API returns
`SCHEMA_NOT_READY`, the database migration history is incomplete rather than
the store being empty.

## Catalog (Phase 1)

After applying both migrations, an authorized staff member can open
`/staff/catalog` from the selected store workspace. The catalog foundation
provides organization-scoped categories, products, variants, menus,
modifier groups and store/channel availability (including Sold out state).
Prices are stored as integer minor units, so `65.00 THB` is sent to the API as
`6500`. The API protects every catalog write with `catalog.manage` and an
explicit store-access check.

The catalog migration is
`supabase/migrations/20260916120000_catalog.sql`. The follow-up
`supabase/migrations/20260916150000_phase1_hardening.sql` is safe to apply to
projects that already have the first catalog migration; it adds the missing
tenant-safe store key and prevents duplicate no-variant menu items. The
`supabase/migrations/20260916152000_atomic_availability.sql` adds the atomic
availability PATCH RPC. If the project was already migrated before this phase
was added, apply all three follow-up files once through the SQL Editor or run
`bun run db:migrate` after linking the project.

## Unified orders (Phase 2)

All ordering channels use one `orders` aggregate; there are no separate POS,
QR or kiosk order tables. The migration
`supabase/migrations/20260916160000_order_engine.sql` creates tenant-safe
orders, immutable item/modifier snapshots, payments, refunds, per-store order
numbers, and RLS-protected domain/outbox records. Creation, payment and
status transitions are atomic Postgres RPCs with idempotency keys.

The authenticated API exposes:

```text
GET  /api/orders?storeId=<uuid>&status=<status>
GET  /api/orders/<orderId>?storeId=<uuid>
POST /api/orders                         (Idempotency-Key required)
POST /api/orders/<orderId>/transition    (Idempotency-Key required)
POST /api/orders/<orderId>/payments      (Idempotency-Key required)
```

The staff Orders workspace is available at `/staff/orders`. POS checkout,
queue numbering and preparation stations build on this aggregate in later
phases.

## Customer Magic Link, Kiosk and queue display

Each active store already has a stable customer link based on its store code:

```text
https://<web-origin>/order/<store-code>
https://<web-origin>/order/<store-code>/table/<table-number>
https://<web-origin>/kiosk/<store-code>
https://<web-origin>/queue/<store-code>
```

Open `/staff/preview` after selecting a store to copy a link or show its QR
code. The customer link is public and only exposes the store's available QR
catalog. Kiosk orders currently use the cash-at-counter flow; PromptPay is
kept disabled until a real payment provider and webhook are configured.

After a customer submits a QR/Kiosk order, staff can open `/staff/orders`,
select the order and use `รับเงินสดที่เคาน์เตอร์`. The same order then moves
through payment, confirmation, receipt and queue/KDS processing.

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

For the full ecosystem use `../LOCAL_DEVELOPMENT.md` from the parent
directory. The root launcher runs POS on `http://localhost:4332` with its API
on `http://localhost:3003`, allowing Hub and Play to run at the same time.

```bash
cp .env.example .env
bun install
bun run db:seed
bun run dev:api
```

Open [http://localhost:4332](http://localhost:4332), then use the Hub SSO flow.

For temporary UI/API testing without a user or Supabase credentials, run:

```bash
AEVO_TEST_MODE=1 bun run dev
```

This serves a synthetic POS workspace entirely in memory and resets its data
when the process restarts. It is disabled in production and is marked with a
visible test-mode banner.
For a same-origin Worker preview, put the values below in
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
| `AEVO_ACCOUNTS_API_URL` | Optional Aevo Accounts origin for the app-scoped handoff |
| `AEVO_ACCOUNTS_EXCHANGE_SECRET` | Encrypted Worker secret used only for server-to-server code exchange |
| `SESSION_COOKIE_NAME` | Optional; default `aevo_session` |
| `SESSION_COOKIE_SAME_SITE` | Optional; use `lax` for same-origin Worker UI |
| `LOG_LEVEL` | Optional: `info`, `warn`, `error` or `debug` |

Do not set `SUPABASE_SECRET_KEY` or `AEVO_ACCOUNTS_EXCHANGE_SECRET` as public
variables, do not commit either secret to `wrangler.jsonc`, and do not expose
them to the browser. Leave `AEVO_ACCOUNTS_API_URL` empty to keep the reversible
Hub handoff during local migration. The frontend uses a relative `/api` URL in
production; `PUBLIC_API_URL` is only needed when running the Astro site
separately during local development.

For a connected environment, store the exchange secret with Wrangler rather
than in `vars`:

```bash
wrangler secret put AEVO_ACCOUNTS_EXCHANGE_SECRET --env preview
```

The first user is still created by the one-off `bun run db:seed` command above;
the Worker deliberately has no public setup endpoint.

If the deployed login shows `Request failed (500)` or Cloudflare error 1101,
check `/health` and `/ready`. `/health` is a liveness check; `/ready` and
`/api/*` require all three Worker values below. `WEB_ORIGIN` must include the
scheme (for example `https://aevo-pos.example.workers.dev`), and the old
`MONGODB_URI`/`MONGODB_DATABASE` variables are not used by this Supabase build.

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

## Known limitations

- No self-service registration, password reset, MFA or passkeys UI.
- No organization switcher UI when a user belongs to multiple organizations.
- The login limiter is instance-local.
- Device identity, WebSocket rooms, offline POS, queue, preparation/KDS and
  external integrations belong to later phases.
- The Orders workspace is read-only for now; POS checkout UI is Phase 3.

## Recommended next implementation order

1. Categories, products and variants with organization-scoped SKU constraints.
2. Modifier groups/modifiers and flexible menu composition.
3. Menus/menu items with store and channel availability.
4. Sold-out overrides and effective-availability queries.
5. Catalog administration UI and audit events.
6. Coffee-shop acceptance fixture covering size, temperature, milk and extras.
7. POS cart and cash checkout using `POST /api/orders` plus payment RPC.
8. Queue tickets and preparation tasks consuming the outbox events.
