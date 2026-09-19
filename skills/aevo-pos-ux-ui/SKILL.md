---
name: aevo-pos-ux-ui
description: Design, review, and implement UX/UI changes for this Aevo POS project across Astro Staff, Catalog, POS, Orders, and QR ordering surfaces while preserving Thai-first retail workflows, store isolation, and existing offline/order behavior.
metadata:
  short-description: Aevo POS UX/UI implementation guide
---

# Aevo POS UX/UI

Use this skill for any interface redesign, UI bug fix, responsive layout work,
loading-state improvement, or usability review in this repository.

## Product direction

Treat Aevo as a Thai-first touch-oriented retail operations workspace.

- Primary users are cashiers, branch managers, staff, and store owners.
- Optimize for fast scanning, low cognitive load, reliable touch targets, and
  clear operational state.
- Use the existing visual direction: deep green brand actions, soft neutral
  canvas, white surfaces, quiet borders, restrained shadows, and semantic
  success/warning/danger states.
- Keep Thai copy primary. Use English only for familiar operational labels such
  as POS, SKU, QR, Kiosk, Draft, and Sold out.
- Prefer product evidence and real data hierarchy over decorative dashboard
  elements or invented metrics.
- Reuse the existing `StaffIcon` system; do not add a remote icon dependency.

## Repository constraints

- The web app is Astro with TypeScript and page-local browser scripts, not
  React/Next.js. Preserve the existing static Cloudflare Worker architecture.
- Reuse `StaffShell`, `StaffIcon`, `staff-ui.ts`, `global.css`, `api.ts`, and
  existing contracts before introducing new primitives or dependencies.
- Preserve authentication, RBAC, tenant isolation, store selection, API
  contracts, offline outbox behavior, idempotency keys, modifier pricing, and
  order lifecycle rules.
- Do not expose raw database, SQL, or internal error messages. Map errors to
  actionable Thai recovery copy.

## Critical Astro styling rule

Dynamic elements created with `innerHTML`, `createElement`, or
`replaceChildren` do not receive Astro's scoped CSS attribute. If page CSS must
style dynamic rows, cards, buttons, skeletons, dialogs, or empty states, use
`<style is:global>` or move the reusable rules into `global.css`. Do not fix
this by adding one-off inline styles to generated markup.

Before finishing a UI change, inspect the generated CSS and confirm dynamic
selectors such as `.order-row`, `.product-row`, and `.pos-product-card` are not
restricted by `[data-astro-cid-*]` unless the generated elements explicitly
receive that attribute.

## Shared interaction rules

- Staff pages use the shared topbar, store context, desktop sidebar, mobile
  drawer, and mobile bottom navigation.
- Keep the active store in the URL and session storage, but treat the server as
  the source of truth for authorization.
- Use 44px or larger touch targets for primary controls.
- Use buttons for actions and links for navigation. Keep headings, labels, and
  status semantics accessible without relying on color alone.
- Product lists should support loading, cached/stale, fresh, empty, error,
  success, disabled, and destructive-confirmation states.
- Orders and catalog rows must remain readable under long Thai labels, missing
  category/media, narrow widths, and large result sets.
- On mobile, recomcompose the workflow: use horizontal category controls,
  stacked toolbars, readable rows/cards, and a bottom-sheet cart for POS.

## Web design layout & element standards (Best Web Design Practices)

Apply modern, clean, and consistent web design layout principles across all operational pages:

### 1. Topbar & Header Alignment
- **Normalized Height & Rhythm:** Keep the staff topbar at a crisp, consistent height (`64px`).
- **Zero Label Wrapping:** Buttons with text labels (such as `#shift-btn` or `.staff-preview-trigger-btn`) must never wrap text vertically into multiple lines or overflow boundaries. Always specify `white-space: nowrap; display: inline-flex; align-items: center;` and allow auto-width with proper horizontal padding (`padding: 0 12px;`).
- **Normalized Control Heights:** All interactive topbar controls, status capsules, user pills, and buttons must share an identical visual height (`38px`), matching corner radius (`var(--radius-sm)`), and vertical baseline alignment (`align-items: center`).
- **Semantic Grouping & Spacing:**
  - Left: Store selector and desktop sidebar collapse toggle.
  - Middle/Right Working Zone: Page-specific operational actions (Shift, Held Orders, Filters).
  - Divider: A quiet vertical separator (`.staff-topbar-divider`) cleanly demarcating page actions from global utilities.
  - Far Right Utilities: Preview Studio launcher, connection status pill, user capsule, and danger-highlighted logout.

### 2. Desktop Sidebar Collapse / Screen Real Estate
- Cashier and operator screens (such as POS) need maximum horizontal real estate for products and carts.
- Provide a desktop sidebar collapse toggle (`.staff-sidebar-toggle`) that transitions the 224px sidebar into a compact 68px icon rail.
- Persist cashier preference in local storage (`aevo.staff.sidebar_collapsed`).

### 3. POS Three-Zone Ergonomics
- **Zone 1: Category Rail (`.pos-categories`):**
  - Use high-contrast active state (`background: var(--brand); color: #fff;`) with subtle elevation to clearly show which category is being browsed.
  - Maintain 44px touch height per category button.
- **Zone 2: Product Surface (`.pos-products-area`):**
  - Product cards must have clear typographic hierarchy: thumbnail/initials, product title (clamped to 2 lines), and prominent bold price in brand green (`var(--brand)`).
  - Tactile feedback: Subtle elevation on hover (`translateY(-2px)`) and scale feedback on click/touch (`scale(0.98)`).
- **Zone 3: Cart / Checkout Panel (`.pos-cart`):**
  - Header: Clear item count pill and danger-hover clear action.
  - Fulfillment: Segmented pill container (`background: var(--canvas); padding: 4px;`) with smooth toggle between "ซื้อกลับ" and "ทานที่ร้าน".
  - Checkout CTA (`#pay-btn`): Generous 50px height, deep brand green, bold white text with high WCAG contrast, subtle green glow/shadow, and an uncluttered secondary hold button.
  - Disabled states must retain legible text (`opacity: 0.5`) rather than disappearing into the background.

## Loading and data strategy

Optimize perceived and actual latency without weakening authorization.

- Fetch independent requests in parallel with `Promise.all` or
  `Promise.allSettled` where partial rendering is useful.
- Use existing IndexedDB/session caches for already-authorized catalog and order
  data. Show cached data immediately, then revalidate in the background.
- Cache only non-secret display data; never cache tokens or use cached data as an
  authorization decision.
- Keep a request version or store id guard so a slow response from the previous
  store cannot overwrite the newly selected store.
- Do not await cache writes on the critical rendering path.
- Never leave a skeleton visible after a terminal error. Render a useful empty
  or retry state and keep valid user input intact.
- Show a subtle refresh/sync indication when stale data is visible, and avoid
  replacing a usable surface with a blank loading screen during refresh.

## Surface-specific guidance

### Catalog

Products are the default task. Keep tabs for Products, Categories, Menus,
Modifier groups, and Availability. Use a searchable/filterable table on wide
screens and cards or horizontally scrollable data on narrow screens. Product
editing belongs in a drawer; destructive archive actions require confirmation.
Only expose mutations supported by the API. Do not fake variant editing when
the backend cannot update variants.

### POS

Keep the three-zone hierarchy: category rail, product surface, current order.
Product cards must be touchable, show price/variant/sold-out state, and support
search. Preserve cart math, modifiers, cash payment, held orders, offline
outbox, and idempotent order submission. On small screens, make the cart a
bottom sheet while keeping the product menu usable.

### Orders

Use a readable operational queue with order number, channel/time, item count,
total, status, and a clear detail action. Preserve status semantics and show
search/filter loading, empty, error, and detail-dialog states.

### Workspace and store selection

Make the next operational action obvious: POS first, then Orders and Catalog.
Store context must be visible and switching stores must update links, data, and
URL state together.

## Implementation workflow

1. Inspect the target route, dynamic render functions, shared shell, tokens, API
   contract, and existing dirty-worktree changes before editing.
2. Identify the smallest system-level cause. Prefer a shared CSS, loading, or
   shell correction over page-specific patches.
3. Implement semantic markup and state behavior in the existing Astro patterns.
4. Test dynamic CSS scope, long content, narrow layout, stale cache, retry, and
   store switching. Do not claim visual verification without rendering it.
5. Run the relevant checks before handoff:

   - `bun run typecheck`
   - `bun test`
   - `bun run --filter @aevo/web build`
   - `git diff --check`

   When a dev server is available, smoke-test `/staff/`, `/staff/workspace/`,
   `/staff/catalog/`, `/staff/pos/`, and `/staff/orders/`. If browser automation
   is unavailable, state that limitation separately from automated results.

## Handoff requirements

Report the changed files, the observed root cause, loading/cache behavior,
responsive behavior, API impact, checks run, visual verification evidence, and
remaining limitations. Mention when a fix was informed by this skill's
Astro-dynamic-CSS or stale-while-revalidate rules.
