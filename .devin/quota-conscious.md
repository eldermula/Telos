# Telos — Quota-Conscious Operating Mode

Currently working on a free/limited plan. Optimize for fewer, higher-value agent
actions — not fewer features or lower quality, just less waste per task.

## Before starting any task

- Read `.devin/rules/telos-project.md` first — that's persistent context so it
  never needs to be re-explained or re-discovered per session.
- If the task is genuinely simple (one-line config change, renaming a variable,
  a single obvious fix) and doesn't need multi-file reasoning: just make the
  edit directly rather than "exploring" the codebase first. Don't spend actions
  confirming things that are already stated plainly in the prompt.

## Batching

- Do the full requested task in one pass: diagnose, fix, test, commit, push, log
  to CHANGELOG — in that order, in one session — rather than stopping to ask for
  confirmation between each of those steps, unless the prompt explicitly says to
  stop and report before proceeding (safety-critical / real-order-dispatch tasks
  will say this explicitly — respect it when it's there).
- Don't re-run a check that's already been answered earlier in the same session
  unless something has actually changed since then.
- Prefer one consolidated report at the end over incremental narration of every
  intermediate step.

## Read-only / diagnostic work

- For anything purely informational (checking a config value, confirming a file
  exists, reading current DB state) — use the fastest, most direct tool call
  available (a single query, a single file read) rather than broad exploration
  of the repo.
- Don't restate large chunks of file contents back verbatim if only a specific
  value or line is actually relevant to the answer — quote just the relevant
  part.

## Model selection

- Use the lightest capable model for mechanical work: read-only diagnostics,
  simple config edits, straightforward test additions.
- Reserve the strongest/most expensive model tier for genuinely complex
  reasoning: real-order dispatch logic, risk/sizing math, anything safety-
  critical or touching the one-position constraint. Don't default to the most
  expensive model for everything — match the tool to the task.

## Avoid repeat work

- Don't re-verify something already confirmed working earlier unless the prompt
  asks for it specifically (e.g. after a restart, after a deploy).
- If a fix already has test coverage proving it works, don't manually re-walk
  through it again "just to be sure" — trust the test, move on.

## What NOT to skip, even under quota pressure

- Real-money-adjacent verification steps (live order proofs, migration reviews)
  stay separate, deliberate steps — never compress these into the same pass as
  unrelated feature work just to save a session, per the core rules file.
- Audit logging, CHANGELOG entries, and test coverage are not optional
  shortcuts to skip when quota is tight — skipping these creates more expensive
  cleanup work later than the quota they'd save now.
