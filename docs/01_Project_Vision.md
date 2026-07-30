# 01 — Project Vision — Telos

> Read `MASTER_PROJECT_BLUEPRINT.md` first. This document expands on the "why" behind Telos — the problem it solves and who it's for. Requirements derived from this vision live in `02_Product_Requirements.md`.

---

## 1. The Problem

Traders, business owners, and financial consultants who want automated trading today are typically forced to choose between:

- **Bare trading bots** — powerful but ugly, hard to monitor, no real dashboard, no analytics, no sense of trust or control.
- **Retail trading apps** — polished, but not built for automation, business workflows, or professional-grade reporting.
- **Custodial platforms** — convenient, but require users to hand over their funds to a third party, creating trust, regulatory, and security concerns.

There's no single platform that gives professional and semi-professional traders a **trustworthy, premium, automated experience** — one where they keep control of their own broker account and funds, but still get the polish, visibility, and analytics of an enterprise product.

## 2. The Vision

**Telos is a premium AI-powered trading and business automation platform that lets users keep full control of their own broker account while Telos's automation does the work — visible, transparent, and presented like a product built for professionals, not hobbyists.**

Telos should feel like software from an established fintech or private banking institution: dark, gold-accented, calm, precise. Not a flashy retail app, not a bare-bones bot dashboard.

## 3. Who Telos Is For

- **Individual traders** who want automated execution without giving up custody of their funds
- **Investment firms** that need a dashboard layer over automated strategies and reporting
- **Business owners** who want workflow automation and analytics alongside trading tools
- **Financial consultants** managing client-facing reporting and insights
- **AI-automation companies** who need a professional front end for automated systems
- **Organizations** that need analytics/reporting tooling generally, beyond just trading

## 4. What Makes Telos Different

- **Non-custodial by design.** Users link their own existing broker account. Telos never holds, accepts, or moves user trading funds — trust doesn't require surrendering control. (See Blueprint Section 5a.)
- **One dashboard, many functions.** Trading, analytics, reporting, AI assistance, and business workflow tools live together instead of being scattered across separate tools.
- **Built to feel premium.** The visual and interaction design (black/dark-gray, gold accent, glassmorphism) signals trust and professionalism rather than gimmicky retail energy.
- **Automation-first, but transparent.** The core flow — link account, press Start Trading, watch it work — makes automation visible and understandable rather than a black box.

## 5. Core Experience (Summary)

1. User signs up and links their existing broker account.
2. User presses **Start Trading**.
3. The Trading Bot begins executing trades on their behalf, through their own account.
4. The user watches live trading activity, portfolio performance, and analytics on the Telos dashboard in real time.
5. Reports, notifications, and AI-assisted insights support the user without requiring them to hand over control of their capital.

## 6. What Telos Is Not

- Not a broker. Telos does not hold client funds or act as a counterparty to trades.
- Not a signals/tips service. The bot executes; it isn't just suggesting trades for the user to place manually (though manual trading views exist per the Trading module).
- Not a generic no-code automation tool — the automation scope here is centered on trading, analytics, and adjacent business workflows, not arbitrary process automation.

## 7. Long-Term Ambition

Telos should be capable of supporting thousands of concurrent users, live MT5 trading through linked broker accounts, a mobile-friendly dashboard, and a full admin panel — built and scaled like a real financial software product from the start, not retrofitted later.

---

*Next: `02_Product_Requirements.md` translates this vision into concrete features and requirements.*