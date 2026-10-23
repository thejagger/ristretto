# wp-content-migration — WordPress content into ProcessWire

## Spec
- Source: idea
- Flight: vs-ruprechtshofen
- Goal: The old WordPress content lands in ProcessWire.

## Contract
- Acceptance:
  - [auto] The importer loads `2607199db1.sql` into a separate `wp_`-prefixed schema in the dev MySQL, runs against a migrated content model, and exits 0
- Decisions:
  - A missing upload fails the run.
- Manual-Checks: —
- Blockers: —

## Evidence
- 1: `tests/WpImportPagesTest.php`

status: done
