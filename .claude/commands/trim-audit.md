---
description: Audit the current repo (esp. a Pi/Claude extension) for what it's in charge of and what can be trimmed, then write AUDIT.md to the repo root.
argument-hint: "[focus area or 'aggressive' | optional]"
allowed-tools: Read, Glob, Grep, Bash, Write, Agent
---

You are performing a **trim audit** of the repository at the current working
directory. The goal: produce a faithful inventory of everything this codebase
is in charge of, then identify what can be simplified, removed, or merged —
so the owner can slim it down without losing what's load-bearing.

Optional focus / mode from the user: **$ARGUMENTS**
- If empty: do a balanced, full audit.
- If it names an area (e.g. "providers", "rendering"): go deep there, keep the rest brief.
- If it includes "aggressive": bias toward recommending removal; treat decorative,
  duplicated, or rarely-used code as trim candidates by default.

## How to run it

1. **Orient.** Identify what this repo is: read README / package manifest /
   entry point, and list the source files with sizes (e.g.
   `wc -l` over the source tree) so you know where the weight is.

2. **Explore in a subagent.** Delegate the breadth-first scan to an `Explore`
   (or `general-purpose`) subagent so the main context stays clean. Ask it to
   map: the entry point and what it registers/hooks, every distinct
   responsibility area, external dependencies (CLIs, files, network, env vars),
   and any feature that is decorative, duplicated, dead, or behind a niche
   condition. Have it return findings only — not file dumps.

3. **Verify before recommending.** Do not call something dead or duplicated
   without checking its references (Grep). A trim recommendation that breaks a
   load-bearing path is worse than no recommendation.

## What to produce

Write `AUDIT.md` to the **repo root** (the current working directory) with this
structure. Overwrite any existing AUDIT.md.

```
# <repo name> — Trim Audit

_Audited: <date> · commit <short-sha> · branch <branch>_

## Summary
2–4 sentences: what this thing is, how heavy it is (total source lines / file
count), and the headline trim opportunity.

## Responsibility inventory
A numbered list of every distinct thing the codebase is in charge of. For each:
what it does, the key file(s) with line refs, and external dependencies.

## Trim candidates
A table: | Candidate | Approx. lines saved | Risk | Notes |
Ordered by best value (high lines / low risk) first. "Risk" = what breaks or is
lost if removed (e.g. "cosmetic only", "loses provider X", "external dep").

## Load-bearing core
The short list of what must stay — the genuine reason this extension exists.

## Recommended next steps
Concrete, ordered actions the owner could take, smallest-risk first.
```

Keep estimates honest (ranges are fine). Flag anything you were unsure about
rather than asserting it. After writing the file, print a short summary to the
chat and confirm the path you wrote.

## After writing

Do **not** commit, push, or open a PR unless the user explicitly asks. The
deliverable is AUDIT.md on disk; leave it for the user to review.
