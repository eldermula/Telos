# 11 — AI Prompt Library — Telos

> These are reusable prompts for the multi-AI workflow defined in `MASTER_PROJECT_BLUEPRINT.md` Section 8 (ChatGPT plans, Cursor/Windsurf implement, Claude reviews, Gemini second-opinions). Every prompt here starts the same way — pointing the tool at the docs — so no session starts from a blank context.

---

## 1. The Standard Context-Loading Preamble

Prepend this to **any** prompt, for **any** tool, before asking it to touch the codebase:

```
Before doing anything else, read these files in order:
1. MASTER_PROJECT_BLUEPRINT.md
2. docs/10_AI_Rules.md
3. Any doc under docs/ relevant to the task below (ask me if unsure which).

Do not deviate from what these documents establish — especially:
- The frontend must never call the trading engine, Bot, MT5, or broker directly.
- Telos is non-custodial: never build deposit/withdrawal/fund-custody functionality.
- Approved stack only (Node/Express/PostgreSQL/Redis backend, React/TS/Vite frontend).
- Explain what you're about to do before making changes. Wait for approval on
  anything structural (new files, new dependencies, schema changes).

Task:
[specific task here]
```

## 2. Scaffolding a New Backend Endpoint (Cursor / Windsurf)

```
[Standard preamble — Section 1]

Also read: docs/06_API_Specification.md (the exact endpoint contract) and
docs/05_Database_Design.md (the tables it reads/writes).

Implement [METHOD] [/path] exactly as specified in 06_API_Specification.md
Section [X]. Match field names to the database schema exactly — do not invent
parallel naming. If anything in the spec is ambiguous or marked "open item,"
stop and ask rather than guessing.

Do not implement any endpoint not explicitly listed in 06_API_Specification.md.
```

## 3. Building a Frontend Component/Screen (Cursor / Windsurf)

```
[Standard preamble — Section 1]

Also read: docs/07_UI_UX_Guide.md (design tokens, component patterns) and
docs/06_API_Specification.md (the endpoint(s) this screen calls).

Build [screen/component name] per docs/07_UI_UX_Guide.md Section [X]. Use the
design tokens exactly as defined (colors, type scale, spacing) — do not
introduce new colors, fonts, or spacing values. Use Recharts for any charts
and Lucide for any icons, per Section 5/9 of that doc — no other charting or
icon library.

This screen calls [endpoint(s)] from 06_API_Specification.md — match the
response shape exactly.
```

## 4. Implementing a Bot Architecture Module (Cursor / Windsurf)

```
[Standard preamble — Section 1]

Also read: docs/08_Bot_Architecture.md in full — this task touches the
deterministic risk engine and/or its surrounding modules.

Implement [Module name / Phase name] exactly as specified in
08_Bot_Architecture.md Section [X]. This is deterministic logic — do not let
an AI model "interpret" or approximate the math. If a formula's inputs aren't
available yet, stop and ask rather than substituting a placeholder value that
could silently affect risk calculations.

Reminder: APIRS has absolute veto power (Section 9) — no other module's
output may bypass or override its final_applied_position_risk decision.
```

## 5. Code Review Prompt (Claude — reviewer role)

```
[Standard preamble — Section 1]

I'm about to accept changes from [Cursor/Windsurf] for [feature/task]. Review
the diff/code below against:
- docs/08_Bot_Architecture.md, if this touches risk/trading logic
- docs/06_API_Specification.md, if this touches an endpoint
- docs/09_Security.md, if this touches auth, credentials, or any user data
- MASTER_PROJECT_BLUEPRINT.md Section 5/5a (frontend-never-trades,
  non-custodial) — always check this regardless of what else the change touches

Specifically flag:
1. Any violation of the non-custodial rule or the frontend-trading boundary
2. Any deviation from the API contract or database schema
3. Any place a "cheapest/fast/reliable" tradeoff was made silently rather than
   flagged
4. Anything that looks like it works but wouldn't survive the self-hosted
   deployment constraints (04_System_Architecture.md Section 8 — modest
   hardware, hotspot connectivity, single point of failure)

[paste code/diff here]
```

## 6. Bug Fix Prompt (any implementation tool)

```
[Standard preamble — Section 1]

Bug: [description of what's happening vs. what should happen]
Relevant doc section(s): [e.g. 08_Bot_Architecture.md Section 6, Phase 5]

Fix only what's needed to resolve this bug. Do not refactor unrelated code
in the same file (AI Rules Section 9 — don't modify unrelated files/logic).
If the fix requires deviating from the documented spec, stop and explain why
before changing the code — the doc might be wrong, but that's a documentation
decision, not a silent code-level judgment call.
```

## 7. Database Schema Change Prompt

```
[Standard preamble — Section 1]

Also read: docs/05_Database_Design.md in full.

Proposed schema change: [description]
Reason: [why — e.g. "06_API_Specification.md Section X needs a column that
doesn't exist yet"]

Write the migration only — do not touch application code in the same pass.
After the migration, docs/05_Database_Design.md needs a corresponding update
(I'll handle that, or ask me to draft it).
```

## 8. Resolving an Open Item / Proposing a Decision (ChatGPT — planning role)

```
I'm working through open items in Telos's docs (see docs/*.md "Open Items"
sections). Here's the one I want to resolve:

Doc: [e.g. 08_Bot_Architecture.md]
Open item: [paste the exact open item text]
Relevant context: [anything not already in the docs]

Propose a resolution, but:
- Flag it clearly as proposed/pending confirmation, not a settled decision
- Weigh it against the standing project priorities: cheapest option, fast,
  reliable (see MASTER_PROJECT_BLUEPRINT.md)
- Note any other doc section this change would ripple into, so nothing gets
  updated in isolation
```

## 9. Updating Docs After a Decision Is Made

```
Decision made: [what was decided]
Doc(s) affected: [list]

Update the "Open Items" section(s) to reflect this as settled, and update any
other section of the same doc(s) that referenced this as open or undecided.
Do not silently touch unrelated sections. If this decision conflicts with
something already stated elsewhere in the docs (rather than just resolving an
open item), flag the conflict explicitly rather than picking one silently —
per AI Rules Section 9's "explain before applying" rule.
```

## 10. Cursor Project-Structure Prompt (reference — already used once)

Kept here for reuse if the structure ever needs to be re-scaffolded or extended (e.g. adding a new top-level folder later):

```
You are a senior software architect.

We are building Telos — a professional AI-powered SaaS platform combining
automated trading, business automation, analytics, and workflow management.

Before doing anything else, read MASTER_PROJECT_BLUEPRINT.md in the project
root. It is the source of truth for architecture, tech stack, and
non-negotiable rules (especially: frontend must never call the trading
engine/broker directly, and the platform is non-custodial — no deposit/
withdrawal handling for user funds).

[Specific structural change requested]

Explain what you will create before making changes.
Wait for my approval before applying changes.
```

## 11. Notes on Using These Prompts

- **Always fill in the bracketed sections** — an unfilled template is worse than no prompt, since a tool will happily proceed on vague instructions.
- **The preamble (Section 1) is not optional** for any task that touches code, even a "small" one — the AI Rules exist because small unreviewed changes are exactly how architecture drift happens.
- **If a tool proposes something that contradicts a doc**, don't just accept it — ask it to reconcile against the doc explicitly (Section 9's prompt), so the resolution gets recorded rather than silently overwritten.