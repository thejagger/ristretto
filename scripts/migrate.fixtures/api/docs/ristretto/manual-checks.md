# Manual Checks

Things ristretto had no way to reach. Do one, tick its box, then re-run
the pull to verify what was waiting on it. Never production.

## mail-classify-eval

- [x] **proves** · on the real set (the 15 LNW mails in `../platform/docs/emails/lnw/`) the eval meets the pass mark: 0 LNW missed · the real mails are personal data that no build may open · run `uv run python -m scripts.mail_classify_eval` in this repo and record the result

## api-intake-creates-lnw

- [ ] **proves** · After deploying to the dev stack, the backend's start converts hpc's handed-over and failed items: `GET /api/v1/intake/items` lists no `extracted` or `failed` item, and each converted document is an LNW in the LNW-Liste with „offene Probleme" · hpc's real Eingang lives only in the dev stack's database · deploy (`docker compose up -d --build api` in ../platform), then compare the counts
