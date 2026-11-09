# web-order-title

## Spec
- Source: idea (orders review with backoffice 2026-10-27; first asked as „Projektcode statt Nummer“)
- Goal: Wherever Office shows an order, its title (Bezeichnung) stands next to its number.
- Why: backoffice knows orders by their description, never by hpc's number · noticed by: orders review with backoffice 2026-10-27

## Contract
- Acceptance:
  - [auto] Bestellungen has a column „Bezeichnung“ with the order's title; a long title is cut to one line with the full text on hover. Component test (bestellungen-table).
  - [auto] On the LNW page (orders table), in the LNW-Liste, Fehlende LNW / „Manuell zu planen“, Abgrenzung and the start page's missing lists, an order shows its number and below it its title in muted text; an order without title shows the number alone. One component test per screen family, using the api's `OrderRef.title`.
  - [auto] Typecheck green after regenerating the client from the api commit that lands api-order-title.
  - [auto] The office e2e suite stays green against the dev stack with api-order-title deployed (searches by number keep working).
- Provides: one shared `OrderLabel` component (number + muted title line, hover for the full title) used by every screen above.
- Consumes: from api-order-title (C:\work\sisi\api): `OrderRef { id, label, title: string | null }` on LNW detail/list, missing/manual plan, Abgrenzung, dashboard — checked against its Provides: matches.
- Decisions:
  - Research: research/web-order-project-code.md (researched as the project-code input; the user then ruled the code out).
  - No project code anywhere; the number stays the order's name (user 2026-10-27).
  - Title next to the number everywhere in Office (user 2026-10-27).
  - Look -> number first, title as a second muted line, one line, truncated, full text in a tooltip; in Bestellungen a separate column „Bezeichnung“ after „Nummer“.
  - Order picker -> unchanged; it already shows the title as second line.
  - Shared component -> one `OrderLabel` in apps/office/components, never a per-screen copy.
  - Order -> build after web-lnw-orders-table (same order cell) and after api-order-title is deployed.
- Units:
  - `OrderLabel` component + test.
  - Use it on LNW page orders table, LNW-Liste, Fehlende LNW / Manuell zu planen, Abgrenzung, start page.
  - Bestellungen column „Bezeichnung“.
  - Regenerate client; adjust tests.
- Blockers: —

## Approach
- Regenerate the client first; the typecheck shows every place an order ref changed type; replace each plain label rendering by `OrderLabel`.
- Likely touchpoints: apps/office/components/order-label.tsx (new), apps/office/app/(dashboard)/{bestellungen/bestellungen-table,lnw/lnw-table,lnw/fehlend/missing-table,lnw/abgrenzung/abgrenzung-view,_start/missing-lists,lnw/[id]/lnw-orders-field}.tsx, packages/api-client/v1.ts, tests.
- Depends: web-lnw-orders-table (cross-repo: after api-order-title in C:\work\sisi\api is done)
- Parallel-with: —
