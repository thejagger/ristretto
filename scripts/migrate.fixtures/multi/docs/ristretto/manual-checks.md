# Manual Checks

Things ristretto had no way to reach.

## DKP-97

- [ ] **proves** · the `[human]` criterion "NGS screen documentation exists … de-AT strings
      reconciled" · the NGS knowledge base — no credentials in this repo ·
      1. Run the `create-ngs-doc` skill and paste the result into a new NGS
         article "Massenmanipulationen von Sendungen".
      2. Reconcile the shipped strings in `public/i18n/de-AT.json` against the CSV.
      _criterion:_ "The NGS screen documentation exists" · _test:_ `ships the de-AT wording (MC-1)` (skipped)

## DKP-100

- [x] **proves** · the `[human]` criterion "A signed-in approver sees the Freigabe button only
      with API level 6" · portal sign-in needs interactive oauth · sign in and look.
      checked 2026-10-13 by the owner
- [x] Ran the redirect script on the dev DB.

_All checks run and confirmed passing by the user on 2026-10-13._
