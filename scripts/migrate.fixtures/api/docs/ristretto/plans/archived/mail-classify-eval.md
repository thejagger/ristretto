# mail-classify-eval — Der Klassifikator wird an echten Mails gemessen

## Spec
- Source: idea
- Flight: mail
- Goal: Measure the classifier on real mails.

## Contract
- Acceptance:
  - [auto] The eval prints one line per mail and a summary.
  - [human] On the real set (the 15 LNW mails Bettina forwarded on 2026-10-09 in `docs/emails/lnw/`), the result meets the pass mark: **0 LNW missed**.
- Manual-Checks:
  - the real set, by hand.
- Blockers: —

## Evidence
- 1: tests/test_eval.py
- decision taken: a correction key whose value is no object is no change - not in the contract

status: done
