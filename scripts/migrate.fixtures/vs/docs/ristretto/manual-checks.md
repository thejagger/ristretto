# Manual checks

Checks whose subject this repo gives no path to from a machine — a judgment only a
person can make. Everything else in this flight is asserted by the gate. Tick a box
only after actually running the check.

## pw-frontend-templates

- [ ] Open `http://localhost:8080/` and step through `/`, `/unsere-schule/` and `/termine/` at a 375px and a 1280px viewport, side by side with the design. Note any spacing or type-scale drift.
      proves: [human] Rendered pages are a faithful visual match to the Claude Design artboards at 375px and 1280px — spacing rhythm, type scale and weight, and card proportion read as the same design rather than an approximation.

## wp-content-migration

- [x] **proves** · [auto] The importer loads `2607199db1.sql` into a separate `wp_`-prefixed schema in the dev MySQL, runs against a migrated content model, and exits 0 · settled everything except `exit 0` itself · put the real `wp-content/uploads/` tree on disk and repeat the run. **SETTLED 2026-09-04**: the run exited 0.

## gone-feature

- [ ] Check the thing by hand.
