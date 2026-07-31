# 07 — UI/UX Guide — Telos

> Read `MASTER_PROJECT_BLUEPRINT.md` Section 3, `01_Project_Vision.md`, and `docs/10_AI_Rules.md` Section 5 first — this document expands their design direction into concrete tokens and component rules. It is the authoritative source `03_SRS.md` (`NFR-7`) and `02_Product_Requirements.md` point to. All recommendations here default to $0-cost / free-tier tools and licenses, per current project constraints — no paid fonts, icon packs, or UI kits.

---

## 1. Purpose & Scope

Defines the visual language (color, type, spacing, motion), component patterns, and per-module layout guidance for every screen in the PRD (Auth, Onboarding, Dashboard, Trading, AI Assistant, Portfolio, Analytics, Reports, Notifications, Settings, Admin). Anything not covered here should be derived from the tokens in Section 3, not improvised.

## 2. Design Philosophy

Telos should read as **software from an established private-banking or institutional-fintech platform** — dark, gold-accented, calm, precise (Vision Section 2). Concretely, that means:

- **Quiet by default, deliberate where it matters.** Most of the interface is dark neutral surfaces and restrained typography. Gold is a signal, not a background color — it marks the thing the user should notice (an active state, a key figure, a primary action), not every button and border.
- **Precision over decoration.** Numbers are the product here — balances, P&L, risk percentages, tiers. Alignment, tabular figures, and consistent decimal precision matter more than illustrative flourish.
- **Calm automation, not a black box.** Per the Vision's "watch it work" principle, live state (bot status, tier, decision log) should always be visible and legible, not buried — the design's job is to make automation *feel* transparent, not just *be* transparent in the API.
- **Never startup-generic.** No playful illustration, no gradient-mesh hero sections, no emoji in product chrome, no cutesy empty-state mascots (AI Rules Section 5).

## 3. Design Tokens

### 3.1 Color

| Token | Hex | Use |
|---|---|---|
| `bg-canvas` | `#0A0A0B` | App background, near-black (Blueprint Section 3) |
| `bg-surface` | `#151517` | Base card/panel surface before glass treatment |
| `bg-surface-raised` | `#1C1C1F` | Modals, popovers, elevated panels |
| `border-subtle` | `rgba(255,255,255,0.08)` | Card/divider borders |
| `glass-fill` | `rgba(255,255,255,0.04)` | Glassmorphism panel fill, paired with backdrop-blur (Section 3.4) |
| `accent-gold` | `#D4AF37` | Primary accent — required, Blueprint Section 3 |
| `accent-gold-hover` | `#E4C158` | Hover state on gold elements |
| `accent-gold-active` | `#B8952E` | Pressed/active state |
| `text-primary` | `#EDEDE6` | Warm off-white, not pure white — sits better against gold than `#FFFFFF` |
| `text-secondary` | `#9C9C94` | Secondary/muted text, captions |
| `text-disabled` | `#5C5C58` | Disabled states |
| `success` | `#4CAF7D` | Muted green — profit, connected, running |
| `danger` | `#E5484D` | Loss, error, stop/disconnect |
| `warning` | `#E0A23C` | Caution states — kept distinct from `accent-gold` (different hue, less saturated) so warnings don't visually compete with the brand accent |
| `info` | `#5B8DEF` | Neutral informational states |

**Rule:** gold is reserved for primary actions, active/selected states, and headline figures (e.g. the balance on Dashboard). It is never used as a background fill for large areas, and never used for error or destructive states — that's `danger`.

### 3.2 Typography

Three roles, per the frontend-design principle that type carries personality — avoiding an all-Inter, all-default look while staying free (Google Fonts, no license cost):

| Role | Typeface | Notes |
|---|---|---|
| Display / headings | **Fraunces** (variable) | A serif with enough contrast and weight range to feel considered and institutional rather than templated. Used for page titles, the Dashboard's headline balance figure, and section headers. Used with restraint — never body copy. |
| Body / UI text | **Public Sans** | Clean, highly legible, designed for government/financial-grade interfaces. Used for all labels, paragraphs, nav, buttons. |
| Data / numeric | **IBM Plex Mono** | Tabular figures by default — critical for balances, P&L, percentages, and the trade history table, where columns must align. Used only for numeric/data contexts, not prose. |

Type scale (rem, 16px base):

| Token | Size | Weight | Use |
|---|---|---|---|
| `display-lg` | 2.5rem | Fraunces 500 | Dashboard headline balance |
| `display-sm` | 1.75rem | Fraunces 500 | Page titles |
| `heading` | 1.25rem | Public Sans 600 | Card/section headers |
| `body` | 1rem | Public Sans 400 | Default body text |
| `caption` | 0.8125rem | Public Sans 400 | Secondary labels, timestamps |
| `data-lg` | 1.5rem | IBM Plex Mono 500, tabular-nums | Key figures (balance, tier) |
| `data-base` | 0.9375rem | IBM Plex Mono 400, tabular-nums | Table cells, inline figures |

### 3.3 Spacing & Layout Grid

- Base unit: `4px`. Component padding/margins in multiples of `4px` (8, 12, 16, 24, 32, 48).
- "Generous spacing" (Blueprint Section 3) means card internal padding defaults to `24px` minimum, not `12px` — density is earned only in data-heavy tables (trade history), not in summary cards.
- Desktop content max-width: `1440px`, centered, with a persistent left sidebar (`260px`) for primary nav (per Section 4.7).
- 12-column grid at desktop breakpoints for Dashboard/Analytics widget layout.

### 3.4 Elevation & Glassmorphism

The glassmorphism direction (Blueprint Section 3) is implemented consistently, not per-component improvisation:

```css
.glass-panel {
  background: var(--glass-fill);          /* rgba(255,255,255,0.04) */
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-subtle); /* rgba(255,255,255,0.08) */
  border-radius: 16px;
}
```

- Radius scale: `8px` (buttons, inputs, chips), `16px` (cards), `24px` (modals).
- Only one elevation "language" — don't mix drop-shadow-heavy skeuomorphism with glass; blur + subtle border is the entire elevation system. Modals add a `rgba(0,0,0,0.6)` scrim behind them, no shadow.

### 3.5 Motion

"Restrained motion" (Blueprint Section 3) means:

- Durations: `150ms` for hover/focus micro-interactions, `250ms` for panel/modal enter-exit, nothing longer than `400ms` anywhere.
- Easing: `ease-out` for entrances, `ease-in` for exits — no bounce, no spring physics. This isn't a consumer app.
- **What gets animated:** state transitions that carry meaning — bot status changing, a new trade appearing in the feed, a tier unlocking. **What doesn't:** decorative page-load sequences, hover effects on non-interactive elements, animated gradients. If in doubt, don't animate it.
- Respect `prefers-reduced-motion` — disable all non-essential transitions when set.

## 4. Component Patterns

### 4.1 Cards
Standard content container = `.glass-panel` (Section 3.4) with a `heading`-styled title, `24px` padding. Metric cards (Dashboard, Analytics) right-align the numeric value in `data-lg`, left-align the label in `caption`.

### 4.2 Buttons
| Variant | Style | Use |
|---|---|---|
| Primary | Solid `accent-gold` fill, `bg-canvas` text | "Start Trading," "Link Broker Account," primary form submits |
| Secondary | Transparent, `border-subtle` border, `text-primary` | "Cancel," secondary actions |
| Destructive | Solid `danger` fill | "Stop Trading," "Disconnect Broker" |
| Ghost | No border/fill, `text-secondary` | Tertiary/inline actions |

Given real trading consequences behind "Start/Stop Trading" even in a non-custodial model, both use a confirmation modal (Section 4.8) — never a bare single-click toggle.

### 4.3 Status Indicators
A single shared "status pill" component across the app — small dot + label, color from Section 3.1's semantic tokens:
- Broker connection: `connected` (success) / `disconnected` (text-secondary) / `error` (danger)
- Bot session: `running` (success, subtle pulse animation per Section 3.5) / `stopped` (text-secondary) / `error` (danger)
- Strategy mode: `STRATEGY_A` (accent-gold outline) / `STRATEGY_B` (warning outline) / `HALTED` (danger outline) — ties to Bot Architecture Section 6.1, so a user glancing at the Dashboard can tell at a glance the bot has stepped back into capital-preservation mode.

### 4.4 Data Visualization
- Library: **Recharts** (MIT license, free, React-native, already compatible with the approved React/TS stack) for equity curves, P&L over time, and drawdown charts.
- Chart styling: dark canvas (`bg-surface`), gridlines at `border-subtle` opacity, single-series lines in `accent-gold`, comparison/benchmark series in `text-secondary`. Losses/negative regions shaded in `danger` at low opacity, never a jarring solid fill.
- No 3D charts, no pie charts for anything with more than 3–4 segments (illegible at a glance, doesn't fit the precision-first tone).

### 4.5 Tables
Trade history, positions, orders, decision log (`06_API_Specification.md` Section 6): dense rows (`12px` vertical padding, tighter than card spacing per Section 3.3's density note), numeric columns right-aligned in `data-base`, zebra-striping via `glass-fill` on alternate rows rather than a hard border grid.

### 4.6 Forms
Broker-linking form (`FR-ONB-1`) gets explicit security affordances given what it's collecting: a persistent inline note ("Your credentials are encrypted and never stored in this browser") near the submit button, and the credentials fields never rehydrate with a stored value on revisit — matching `NFR-2`, this is a UI-level reinforcement of a backend guarantee, not just copy.

### 4.7 Navigation
Persistent left sidebar (desktop, `260px`, Section 3.3) with module icons + labels (Auth excluded — pre-login only). Collapses to a bottom tab bar or hamburger drawer at mobile breakpoints (Section 6). Active module indicated by a `accent-gold` left-border accent on the nav item, not a filled background (keeps gold usage restrained per Section 3.1's rule).

### 4.8 Modals & Confirmations
Used for: Start/Stop Trading, broker disconnect, any admin write (`06_API_Specification.md` Section 13). Modal copy states the concrete consequence in plain terms ("This stops the bot from placing new trades. Open positions stay open.") rather than a generic "Are you sure?" — see Section 8 on voice.

## 5. Icons

**Lucide** (MIT license, free, already the approved icon set for the artifact/component ecosystem) — a clean line-icon style fits the restrained, precise brand better than filled/skeuomorphic icon sets. Consistent stroke width (`1.5px`) throughout; icons never carry their own color beyond `text-primary`/`text-secondary`/semantic tokens — no multi-color icon sets.

## 6. Responsive Behavior (`NFR-4`)

| Breakpoint | Width | Layout change |
|---|---|---|
| Desktop | ≥1024px | Full sidebar, multi-column widget grids (Dashboard, Analytics) |
| Tablet | 768–1023px | Sidebar collapses to icon-only rail; widget grids drop to 2-column |
| Mobile | <768px | Sidebar becomes a bottom tab bar (5 primary modules); widget grids stack single-column; tables switch to a stacked card-per-row layout rather than horizontal scroll, since horizontal-scrolling data tables are a common mobile failure point for exactly this kind of dense financial data |

Every module must be fully functional (not just viewable) at the mobile breakpoint — Trading's Start/Stop and manual order entry included, per `NFR-4`'s "full functionality" requirement, not a read-only mobile mode.

## 7. Accessibility

- **Contrast:** `text-primary` (`#EDEDE6`) on `bg-canvas` (`#0A0A0B`) exceeds WCAG AAA. `accent-gold` (`#D4AF37`) on `bg-canvas` passes AA for large text/UI components but is borderline for small body text at 4.5:1 — **gold is never used for small body copy**, only headings, data figures ≥`data-base` size, and iconography, which keeps it compliant by construction rather than requiring per-instance contrast checking.
- **Focus states:** visible focus ring (`2px accent-gold`, offset `2px`) on every interactive element — never suppressed for aesthetic reasons.
- **Reduced motion:** per Section 3.5.
- **Semantic HTML / ARIA:** status pills (Section 4.3) use `aria-live="polite"` regions where they reflect real-time bot/connection state, so screen reader users get equivalent "watch it work" transparency.

## 8. Content & Voice

Matches the "calm, precise, professional" brand (Vision Section 2) rather than a generic SaaS voice:

- **Active voice, plain verbs.** "Stop Trading" produces a status change to "Stopped" — not "Trading has been terminated." A button's label and its resulting confirmation use the same verb (frontend-design skill's naming-consistency principle).
- **Name things by what the user controls.** "Broker Connection," not "Integration Config." "Notification Preferences," not "Alert Settings Object."
- **Errors state what happened and what to do**, in the interface's voice, never apologetic filler: "Broker connection failed. Check your credentials and try again." — not "Oops! Something went wrong."
- **Empty states are an invitation to act**, not decoration: an empty Trade History reads "No trades yet — link a broker account and press Start Trading to begin," with the actual next-step control alongside it, not a standalone illustration.
- No emoji, no exclamation points in system copy, no "Congrats! 🎉" — a tier unlocking or a profit-lock milestone is communicated as a fact (`Tier 3 reached — active risk ceiling now 20%`), not celebrated like a gamified app. This is a direct consequence of the "never playful" brand rule (AI Rules Section 5), applied to copy as well as visuals.

## 9. Tooling & Cost Notes ($0-cost, per current project constraint)

- **Fonts:** Fraunces, Public Sans, IBM Plex Mono — all free, open-license, served via Google Fonts or self-hosted (self-hosting avoids a runtime dependency on Google's CDN and is still free).
- **Icons:** Lucide — MIT license, free, no attribution requirement beyond standard OSS license inclusion.
- **Charts:** Recharts — MIT license, free.
- **Design/mockup tooling:** if Figma or similar is used for mockups before implementation, the free tier is sufficient for a single-editor project at this stage — no paid seat needed yet.
- None of the above requires a paid API, license, or subscription. If any future component (e.g. a premium icon pack, a paid chart library feature) is proposed, it should be flagged explicitly against this section rather than adopted silently, per the standing $0-cost preference.

## 10. Open Questions

- Whether Fraunces/Public Sans/IBM Plex Mono get self-hosted (bundled) vs. loaded from Google Fonts CDN at runtime — affects `NFR-3`/perceived load performance marginally; recommend self-hosting once the Frontend build pipeline exists, but not blocking now.
- Exact mobile tab bar module set (only 5 fit comfortably) — likely Dashboard, Trading, Portfolio, Notifications, Settings, with Analytics/Reports/AI Assistant reachable via a "More" entry, but not yet confirmed against real usage patterns.
- Whether the Admin module gets a visually distinct theme (e.g. a subtle accent shift) to reduce the chance of an admin mistaking it for the regular user dashboard — not yet decided, flagged for `03_SRS.md`/Admin scoping rather than assumed here.

---

*Next: this guide should be cross-checked against `06_API_Specification.md`'s response shapes once Frontend implementation starts — particularly the status-pill states (Section 4.3), which must map exactly onto the enum values in `05_Database_Design.md` (`connection_status`, `bot_instances.status`, `active_strategy_mode`).*