# api-intake-creates-lnw — Jedes LNW-Dokument wird sofort ein LNW

## Spec
- Source: idea — split from sisi/web `web-eingang-in-lnw`
- Repo: sisi/api
- Flight: backoffice-ready
- Goal: Every LNW document that arrives becomes an LNW as soon as Sisi has read it.

## Contract
- Acceptance:
  - [auto] A read document becomes an LNW, case by case.
    - No mail, no notification.
  - [human] After deploying to the dev stack, the backend's start converts hpc's handed-over and failed items: `GET /api/v1/intake/items` lists no `extracted` or `failed` item, and each converted document is an LNW in the LNW-Liste with „offene Probleme“ (Manual-Checks).
- Provides:
  - jedes LNW-Dokument wird sofort ein LNW
- Manual-Checks:
  - After the deploy to the dev stack: count, then compare.
- Blockers: —

## Approach
- Depends: api-lnw-incomplete

status: planned
