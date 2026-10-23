# api-favicon — Die API trägt sisis eigene Kachel im Browser-Tab

## Spec
- Source: idea
- Flight: —
- Goal: The API's pages carry sisi's own tile.

## Contract
- Acceptance:
  - [auto] `GET /favicon.ico` returns the committed ICO byte for byte.
- Decisions:
  - Cache for a day.
- Manual-Checks: —

## Evidence
- 1: tests/test_favicon.py::test_ico_bytes
- would-escalate: none.
- Planner decisions (build plan, 2026-10-16), unchanged:
  - decision taken: which bare client proves "no session, no bearer"? → the existing `unauth_client` fixture (`tests/conftest.py:782`).
  - decision taken: `dependencies = ["resvg-py"]` unpinned? → pinned `resvg-py==0.5.0`. The criterion "same SVG → same bytes" must hold.
- Review history: one round, notes only.

status: done
