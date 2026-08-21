# What is in here

Three of these documents are hand-written and describe intent. The other
fifty-four are session artifacts: a spec and a plan are written before each
piece of work and are not revised afterwards, so they record what was believed
at the time rather than what is true now.

Telling those apart was the problem this file exists to solve. Nothing here is
read by the app, by CI, or by `CLAUDE.md`; the documents that are load-bearing
for working in this codebase are `README.md`, `CLAUDE.md`, and `AGENTS.md` at
the repo root.

## Hand-written, still describes intent

| Document | What it is | How current |
| --- | --- | --- |
| [`ROADMAP.md`](ROADMAP.md) | SOC L3 / DFIR upgrades, framed for daily triage and incident work. Carries the standing constraints: free sources only, relation data as a readable document rather than a graph. | The constraints hold. Individual items may be done; check the issue tracker before starting one. |
| [`analyst-review.md`](analyst-review.md) | A working analyst's review of the whole tool, 42 findings across six themes, dated 2026-06-13. The source of the A/B/C/D/E/F item numbering that several specs cite. | Themes A and B are largely addressed. Read an item's premise against the code before acting on it: B3 in particular was measured in 2026-08 and found to be scoped wrong. |
| [`hash-card-issues.md`](hash-card-issues.md) | Findings specific to the file-hash result card. | Spot-check before relying on it. |

## Session artifacts

`superpowers/specs/` (30) and `superpowers/plans/` (24), one pair per piece of
work, named by the date the work started.

They are kept because a spec records *why* a decision was made, and that
reasoning outlives the code it produced. They are not maintained: a spec written
in June describes June's code, and several of them describe behaviour that has
since been replaced. Treat a date older than the file you are reading as a
warning.

The `brainstorming` and `writing-plans` skills write here by convention, so the
path is not free to move.

## Finding the reasoning behind a decision

`git log -p --follow <file>` on the source is usually faster than reading a
spec, because commit messages in this repo carry the reasoning and are written
against the code as it actually landed. Reach for a spec when you want the
options that were rejected, which is the one thing commits do not record.
