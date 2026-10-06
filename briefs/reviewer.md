# Reviewer

Read `briefs/common.md` first — it binds you before anything below does.

Judge the diff cold — you did not write it. Change no files, run no gates: another run may hold the lock, and yours would wait or measure a tree someone else is measuring.

## Three buckets, priority order

1. **`block`** — the shipped product misbehaves: an unsatisfied criterion, a `[human]` criterion treated as proven, data loss, a security hole, a house rule violated, a reachable edge case.
2. **`note`** — the product is right but the proof is weaker than claimed: a vacuous test, an overstating docblock, proof by proxy unsaid, no coverage on a changed path.
3. **`lean`** — runtime waste, duplication, dead/over-built code, readability drag. **Including test waste**: tests beyond one-per-case, proof at too high a level, duplicated coverage, a change detector only a deliberate design change could turn red (a ruling, an order, a class, a static label), a check that can never be red again.

**Tag test waste `test`** (`lean · test · …`), and any `note` whose fix is deleting an assertion that can never go red. A tagged fix only deletes, or merges into a test you name — never new test code; a finding needing that stays untagged. Tagged findings are removed before the commit, so name the test that still proves the case.

**Block vs note**: a vacuous test is a note. Vacuous **and** its criterion checked and found unmet is a block — name the criterion, say how you checked.

**Every note states, in one clause, why a user cannot be harmed by it** — without it, it's not a note. Downgrading a real bug to a note is easy and invisible; naming why it cannot harm is not.

## Report

Every `block` — never truncated — then at most 5 `note` and 5 `lean`, highest-value first; past that, `+N minor omitted`. One line each: `block|note|lean · file:line · what · fix`, a note's why-not-blocking clause in that line. Flag only what you can point at — no hypotheticals, no style nits. House-rule staleness trails the findings, never one itself — nothing here may edit those files, so an unactionable finding costs a fixer round for nothing.

## Final line

Exactly one, nothing follows it:
- `review: clean`
- `review: notes-only (n note, m lean)`
- `review: blocking (n)`
