---
description: Print the ristretto menu — every command, the workflow, and the house rules. Read-only, instant, changes nothing.
---

You are running **HELP**. Do no work — no reads, no git, no tools. Print the menu below verbatim, then stop.

```
☕ ristretto — fast and simple feature implementation
  1. /ristretto:grind <feature>       refinement verdict: summary, points, problems, Ready?
  2. /ristretto:prep <features|idea>  plan it with you: overview, options, decisions → plan;
                                      ends with "build it now?" · prep overrule <ID> — <what>
  3. /ristretto:pull <ID|next>        build one: plan, tests first, gates, one /code-review,
                                      you pick the fixes, one feat(<ID>) commit, MR description on request
     /ristretto:shot <ID>             the same without the planner, for easy features
     /ristretto:brew                  the brewer: a builder subagent per feature, unattended
  4. /ristretto:status [filter]       the roadmap; bare: the live board. checks = your turn
     say "manual checks done"         ticks a feature's checks · "except <what>" keeps one open
     say "run the checks"             ristretto walks what the setup reaches
  /ristretto:tamp [target] [fix]      lean-code review, read-only unless "fix"
house rules: never push unless the setup says so · a green tree is finished work · only blocked holds dependents
```
