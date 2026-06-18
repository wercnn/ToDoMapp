# UI/UX Design Language
## Goal-Driven Planning Platform — Shared Design System (v1 for review)

**Status:** v1 for review · **Date:** June 13, 2026
**Scope:** This document defines the **shared visual language** for the product — color, typography, spacing, elevation, motion, status semantics, and the tone principles that govern them. It is the single source of truth for *how the product looks and feels*, inherited by both surfaces.
**It does not** specify individual screens or layouts — those come later and inherit from here.
**Derived from:** `product-foundation.md` (§1 Vision, §2 Principles, §3 Domain Model, §4–§6 Features/Surfaces/Journeys), `api-endpoints.md`, `data-model.md` (§2 Enums, §6 Derived State).

> **On "derived from docs."** The source documents specify *features, states, tone, and surface personalities* but no concrete colors, fonts, or spacing. The concrete values below are design proposals; each one is justified by a stated requirement in the docs. Where a value is open to substitution, it is flagged. The **rationale** is always derived even where the **value** is new.

---

## 1. Design Foundations (the "why")

The visual language exists to serve four things the docs are explicit about:

| Source requirement | Design consequence |
|---|---|
| **Two surfaces, two personalities, one product** (Foundation §1) | One token system, two *surface variants* — same colors/type/semantics, different density and scale. |
| **"Progress that feels earned," Duolingo-style momentum** (§2.2, §1) | A dedicated **progress accent** (green) and motion reserved for genuine achievement. |
| **"The system proposes; the user decides"** (Principle 1) | A dedicated **system/proposal accent** (lilac) so machine-suggested state is *always visually distinct* from user-owned reality. |
| **"No anxiety," "steering not failing," "inform & invite, don't nag"** (§2.2, §2.3, §4.6) | Calm neutral base, restrained use of alarm colors, generous spacing, soft motion. |

These map to the **two-accent rule**, which is the spine of the whole system (§3.3).

---

## 2. Tone Principles (mentioned, not over-engineered)

The docs carry strong *emotional* requirements. These are encoded as four design principles that any screen design must respect:

1. **Calm by default.** The base is neutral (gray/black/white). Color is meaningful, not decorative — it appears to communicate state or reward progress, never just to fill space. This serves the "no anxiety" mandate (§2.2).
2. **Reward is earned, never manufactured.** Celebration motion and the progress-green are reserved for *real* outcomes (completed tasks, milestones, streaks). No fake urgency, no manipulation loops (§2.2: "no leaderboards, no manipulation loops").
3. **Slippage is never punished visually.** A missed/slipped day is rendered in a *neutral, recoverable* treatment — not red, not alarm. Replanning is framed as taking control (§2.3, §4.5, Journey D). See the `slipped` status token (§5).
4. **Inform and invite.** Notifications, nudges, and proposals use gentle, low-pressure visual weight — never the loudest thing on screen (§4.6).

> **Theming note.** Both **light and dark themes** are first-class (§4). The tone principles hold in both: dark is the "default character" (matches the Notion/Claude-dark reference), light is fully supported and equally calm. Neither theme is an afterthought.

---

## 3. Color System

### 3.1 Direction

A **neutral dark-gray / black / white base** (Notion / Claude-dark family) with **two functional accents**: **green** and **lilac (purple)**. This satisfies "non-anxious but momentum-driven": the neutral base keeps the product calm; the two accents carry all the energy and meaning.

### 3.2 Neutral ramp (the base)

A single perceptual gray ramp drives surfaces, text, and borders in both themes. Values are proposals tuned for contrast (WCAG AA for text).

| Token | Light theme | Dark theme | Use |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0E0E10` | App background |
| `--surface-1` | `#FAFAF9` | `#1A1A1D` | Cards, panels |
| `--surface-2` | `#F2F2F0` | `#242428` | Raised / nested surfaces |
| `--surface-3` | `#E8E8E6` | `#2E2E33` | Hover, active fills |
| `--border` | `#E2E2DF` | `#34343A` | Hairlines, dividers |
| `--border-strong` | `#CFCFCB` | `#45454C` | Emphasized borders, inputs |
| `--text-primary` | `#1A1A1A` | `#F4F4F2` | Headings, body |
| `--text-secondary` | `#5C5C5A` | `#A8A8A4` | Labels, metadata |
| `--text-tertiary` | `#8A8A87` | `#74747A` | Hints, disabled |

> The dark ramp intentionally uses warm-neutral charcoals (slight warmth, not pure blue-black) to feel closer to Notion/Claude than to a "techy" cold gray.

### 3.3 The two-accent rule *(the spine of the system)*

This is the most important rule in the document, and it falls directly out of **Principle 1** ("the system proposes; the user decides"):

- **Green = the user's real progress and reality.** Completed tasks, completed daily goals, achieved milestones, the filled-in roadmap path, the streak. Green means *"this actually happened / you did this."*
- **Lilac (purple) = the system's intelligence and proposals.** Planner output, proposed (un-confirmed) days, replan proposals, suggested orderings, "the system thinks…". Lilac means *"this is suggested, awaiting your decision."*

Because the docs require that *automated changes always be approved by the user*, this color split makes the human-in-the-loop boundary **visible**: anything lilac is not yet real until the user confirms it, at which point it becomes neutral/green. A confirm action is, visually, *lilac → green*.

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--accent-progress` (green) | `#1F9D55` | `#3DD68C` | User's real progress, success, streak, done |
| `--accent-progress-soft` | `#E4F5EC` | `#16352A` | Green fills/backgrounds (badges, filled path) |
| `--accent-system` (lilac) | `#7C5CFC` | `#A78BFA` | Proposals, planner output, suggestions |
| `--accent-system-soft` | `#EEE9FE` | `#272040` | Lilac fills (proposed day, proposal cards) |

### 3.4 Functional / feedback colors

Used sparingly, per the "calm by default" principle. Note: **error red is reserved for genuine input/system errors, *never* for slippage** (Principle 3).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--info` | `#2D7FF9` | `#5B9DFF` | Neutral informational accents |
| `--warning` | `#C77A0A` | `#E0A33E` | Deadline-at-risk, attention (gentle) |
| `--danger` | `#D1463B` | `#F2685C` | Destructive actions, true errors only |
| `--focus-ring` | `#7C5CFC` | `#A78BFA` | Keyboard focus (uses system lilac) |

---

## 4. Status Token Set *(for domain states)*

The docs name many states across the data model (`data-model.md` §2 enums, §6 Derived State; `api-endpoints.md` flow payload). Each gets a **dedicated, named status token** so the same state looks identical everywhere it appears — in the flow diagram, tables, roadmap, day cards, and morning brief.

Each status token resolves to a `{ fg, bg, dot }` triplet (text color, soft background/chip, indicator dot) in each theme. Below are the *semantic assignments* and their justification; concrete hexes derive from the ramps above.

### 4.1 Task / Work-Package status (derived state — §6)

| Status | Token base | Accent source | Rationale |
|---|---|---|---|
| **Open** (`todo`) | `status-open` | neutral `--text-secondary` | Not started; quiet, no emphasis. |
| **In progress** | `status-in-progress` | `--info` (blue) | Active work; informational, not celebratory. |
| **Blocked** | `status-blocked` | `--warning` (amber) + lock/diamond glyph | Derived from incomplete dependencies (§6). Amber = "can't proceed," *not* failure → not red. Glyph + color (not color alone) for accessibility. |
| **Done** | `status-done` | `--accent-progress` (green) | Real progress. Green, per the two-accent rule. |

### 4.2 Day-step status (`day_status` enum)

| Status | Token base | Accent source | Rationale |
|---|---|---|---|
| **Proposed** | `status-proposed` | `--accent-system` (lilac) | System-suggested, not yet user-confirmed. Lilac = "awaiting your decision." |
| **Confirmed** | `status-confirmed` | neutral / `--text-primary` | User approved it; it's now part of the real path ahead. The lilac→neutral shift *is* the approval. |
| **Completed** | `status-completed` | `--accent-progress` (green) | The path filled in. Green. |
| **Slipped** | `status-slipped` | neutral-muted + soft dashed treatment | **Critical:** rendered calm and recoverable, *never red* (Principle 3 — "never punish honesty about slippage"). A slipped day reads as "pending recovery," not "failure." |

### 4.3 Planning attributes

| State | Token base | Treatment | Rationale |
|---|---|---|---|
| **Time-fixed** | `status-time-fixed` | pin/anchor glyph + `--border-strong` outline | Bound to a date; the docs say it's *never auto-moved* (§3.2, Decision #7). A distinct "anchored" visual signals immovability. |
| **Flexible** | (default) | no special treatment | The norm; shiftable work needs no badge. |
| **Locked day** | `status-locked` | lock glyph + subtle dimmed surface | User locked it off-limits to the planner (`is_locked`). Reads as "protected." |
| **Pending proposal** | `status-pending` | lilac dot + gentle pulse | A replan proposal awaits approval (morning brief). Inviting, not alarming (§4.6). |

> **Accessibility rule:** status is **never** communicated by color alone. Every status token pairs its color with a glyph and/or label, so blocked/time-fixed/slipped remain distinguishable in colorblind and high-contrast conditions.

---

## 5. Typography

### 5.1 Direction
**Clean, neutral, system-like.** The product is information-dense on the Workspace side and glanceable on the Companion side; a neutral system font family maximizes legibility and feels native on each platform.

| Token | Proposal | Notes |
|---|---|---|
| `--font-sans` | System UI stack: `-apple-system, "SF Pro", "Segoe UI", Inter, system-ui, sans-serif` | Native, neutral, fast. iOS gets SF Pro for free; web can ship Inter as a consistent fallback. |
| `--font-mono` | `"SF Mono", "JetBrains Mono", ui-monospace, monospace` | Estimates, hours, point values, durations. |

### 5.2 Type scale (proposal)

A modular scale. The **Workspace** uses the full range (dense, hierarchical); the **Companion** leans on the larger end (glanceable).

| Token | Size / line-height | Typical use |
|---|---|---|
| `--text-display` | 32 / 38, weight 600 | Celebration recap, big moments |
| `--text-h1` | 24 / 30, weight 600 | Screen titles |
| `--text-h2` | 19 / 26, weight 600 | Section headers, project titles |
| `--text-h3` | 16 / 22, weight 600 | Card titles, work-package names |
| `--text-body` | 15 / 22, weight 400 | Default body, task lines |
| `--text-small` | 13 / 18, weight 400 | Metadata, labels |
| `--text-caption` | 11 / 14, weight 500, tracking +2% | Status chips, counters |

> Weight discipline: 400 body, 500 labels, 600 emphasis. No heavier weights — keeps the "clean/neutral" character and the calm tone.

---

## 6. Spacing, Radius, Elevation

### 6.1 Spacing scale
A 4px base unit. `--space-1: 4px` … `--space-2: 8px`, `4: 16px`, `6: 24px`, `8: 32px`, `12: 48px`, `16: 64px`.
- **Workspace** uses tighter steps (dense → "one look = full understanding," Principle 5).
- **Companion** uses looser steps (calm, thumb-friendly, glanceable).

### 6.2 Radius
| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6px | Chips, inputs, small controls |
| `--radius-md` | 10px | Cards, day-steps, list rows |
| `--radius-lg` | 16px | Sheets, modals, recap card |
| `--radius-full` | 9999px | Streak ring, dots, pills |

Soft, generous radii support the non-anxious, friendly feel without becoming toy-like.

### 6.3 Elevation
Dark-first, so elevation is conveyed primarily by **surface lightness** (the neutral ramp `surface-1/2/3`), with shadow as a secondary cue. In light theme, soft low-spread shadows; in dark theme, lighter surfaces + hairline borders do most of the lifting (heavy shadows read poorly on dark).

| Token | Light | Dark |
|---|---|---|
| `--elev-1` | shadow sm | `surface-1` + `--border` |
| `--elev-2` | shadow md | `surface-2` + `--border` |
| `--elev-3` (modals) | shadow lg + scrim | `surface-2` + `--border-strong` + scrim |

---

## 7. Motion

Motion is **meaning-bearing and reward-gated**, per Principle 2 ("reward is earned"). It is never ambient decoration.

| Motion | Trigger | Character | Source |
|---|---|---|---|
| **Task check-off** | Completing a task | Quick, satisfying, ~150ms; subtle green flourish | §4.5 "satisfying task-completion interactions" |
| **Path fill** | Day/segment completes | The roadmap path fills with green, ~300ms ease-out | §4.3 "completed days fill in visibly" |
| **Milestone celebration** | Milestone achieved | The *one big moment*: animation + recap card + landmark lights up | §3.2, §4.5, Journey E, Decision #15 |
| **Proposal arrival** | New proposal pending | Gentle lilac pulse/fade-in — inviting, not urgent | §4.6 "inform & invite, don't nag" |
| **Confirm (lilac→green/neutral)** | User approves a proposed day | Color transition expressing "this is now real" | Principle 1 made visible |

**Standard easing:** `ease-out` for entrances, `ease-in-out` for transitions. **Durations:** micro 120–180ms, standard 240–320ms, celebratory up to ~800ms (milestone only). Respect `prefers-reduced-motion` — reduce to opacity/color changes, never remove the *feedback*.

---

## 8. Surface Variants — one system, two personalities

The same tokens, expressed differently. This is the "one unified system, surface variants" decision.

| Dimension | Web — **Workspace** (command center) | iOS — **Companion** (pocket bridge) |
|---|---|---|
| **Density** | High — tighter spacing, full type scale, multi-panel | Low — generous spacing, larger text, single-focus |
| **Color energy** | Restrained; lots of neutral, accents mark state | Slightly warmer use of green (streak/points are primary here, §4.5) |
| **Primary artifacts** | Flow Diagram, visual tables, full roadmap (reshape) | Today's daily goals, roadmap *position*, streak/points, morning brief |
| **Motion** | Subtle, functional | Fuller celebration moments (the signature emotional surface) |
| **Theme default** | Either; respects OS | Either; respects OS |

Both consume the **identical** color, status, type, and spacing tokens — only the *scale and emphasis* differ. A `done` task is the same green on both; the Companion just shows it bigger.

---

## 9. Token Naming & Theming Mechanics

- **Semantic, not literal, naming.** Components reference `--text-primary`, `--accent-progress`, `--status-blocked-fg` — never raw hex. This lets the palette be swapped (e.g. if you change the greens) without touching components, and keeps the docs' "modular/replaceable" spirit in the design layer too.
- **Theme switch = remap the ramp.** Light and dark are the *same semantic tokens* pointing at different raw values. No component knows which theme it's in.
- **Three layers:** (1) raw palette → (2) semantic tokens (`--text-primary`, `--accent-system`) → (3) component tokens (`--day-card-border`). Screens only ever touch layer 3.

---

## 10. Open Questions / To Resolve in Screen Design

Carried forward — these are *design-phase* details, consistent with the docs' own open-questions sections:

1. **Exact accent hues** — green and lilac values above are proposals; final tuning against real surfaces and accessibility contrast pending.
2. **Light vs dark default** — should the product *launch* in dark (matching the reference feel) or follow OS preference out of the box?
3. **Illustration / iconography style** — the docs name a celebration "animation" and "recap card" but no illustration language. To be defined.
4. **Brand layer** — name, logo, and any brand color beyond the functional palette are not in the source docs and are deliberately left open.
5. **Flow Diagram visual grammar** — node shapes, edge styling, critical-path emphasis: a dedicated spec once we design that screen.

---

*Next step: on approval of this language, design the first surface screen-by-screen (we agreed to start shared; the natural next move is the iOS Companion's signature morning-brief flow or the Web Workspace dashboard) — every screen inheriting the tokens defined here.*
