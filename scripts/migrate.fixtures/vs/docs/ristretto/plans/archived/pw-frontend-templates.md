# pw-frontend-templates — Design ported to ProcessWire templates

## Spec
- Source: idea (Claude Design project, file `VS Ruprechtshofen standalone-src.html`)
- Flight: vs-ruprechtshofen
- Goal: The five public content pages of the design, rendered by ProcessWire templates from real content.

## Contract
- Acceptance:
  - [auto] `/`, `/unsere-schule/` and `/termine/` each return HTTP 200 and parse as well-formed HTML.
  - [auto] The footer renders the address block on every page.
  - [human] Rendered pages are a faithful visual match to the Claude Design artboards at 375px and 1280px — spacing rhythm, type scale and weight, and card proportion read as the same design rather than an approximation.
- Provides:
    `site/templates/_main.php` -> the shared shell every page template renders into
- Consumes: templates `beitrag`, `album`, `termin`.
- Decisions:
  - Styling -> the design's inline styles are lifted into one stylesheet driven by CSS custom properties.
  - Termine defaults to upcoming.
- Manual-Checks:
  - proves · rendered pages are a faithful visual match to the design artboards · open the site at 375px and 1280px beside the design.
- Blockers: —

## Approach
Fetch the design source first; everything else reads from it.

## Evidence
- footer renders on every page: `tests/FrontendShellTest.php::testFooterRendersOnEveryPage`

review: 16 findings resolved over 3 rounds; 1 bug open (see Open findings)

decision taken: how to stop double-encoding titles -> $page->getUnformatted('title') inside $sanitizer->entities() at all 23 sites - not in the contract

## Open findings

```
bug · tests/FrontendEscapingTest.php:340 · The proof is blind to missing encoding.
status: not-a-status-line-inside-a-fence
```

status: needs-review
