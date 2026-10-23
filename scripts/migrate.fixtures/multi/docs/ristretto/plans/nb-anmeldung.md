# nb-anmeldung — Sign-up

## Contract
- Acceptance:
  - [auto] The form posts.
- Decisions:
  - Keys are TANs.
- Blockers: —

## Evidence
- 1: tests/NbTest.php

decision taken: whether to keep the duplicated auth preamble on the two endpoints that gate
children's data or extract it -> extracted to NbApi::requireKey(), with the byte-identical 403
independently re-verified after the extraction - not in the contract

- Planner decisions:
  - decision taken: which client? → the bare one, because
    the contract names no other.
  - would-escalate: a migration the contract
    does not name.
- Review history: one round.

status: blocked
