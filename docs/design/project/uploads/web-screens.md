# Web Workspace — Screen Flow Documentation
## Goal-Driven Planning Platform — Web (the "Workspace") · v1 for review

**Status:** v1 for review · **Date:** June 13, 2026
**Scope:** Screens, screen content, flow sequences, and buttons/controls for the **Web Workspace** only (the command center, Foundation §1, §5).
**Derived from:** `product-foundation.md` — §2 Principles, §3 Domain Model, §4 Core Features, §5 Surface Responsibilities, §6 Journeys A/C/D/E. Inherits all tokens/states from `ui-ux-design-language.md`.
**Companion (iOS) is out of scope** here and documented separately.

> **Method note.** Structure, surfaces, and interaction choices below were decided with the product owner, grounded in the foundation doc. Where a value is a design proposal, it's flagged. Status names (`blocked`, `proposed`, `confirmed`, `slipped`, `time-fixed`, etc.) and their visual treatments come from the design language doc §4.

---

## 0. Information Architecture (the shell)

Everything lives inside one persistent **dashboard shell**. Two elements never leave the screen:

### 0.1 Left Sidebar *(shadcn sidebar)* — navigation + WBS structure
A structured, collapsible tree that *is* the WBS spine (Foundation §3.1):

```
[ Logo / workspace name ]
─────────────────────────
⌂  Home
🗺  Roadmap
─────────────────────────
GOALS                    [+]
▸ ◎ Goal — "Build client base"   (short/mid/long tag)
   ├ ▸ Project — "Portfolio site"
   ├ ▸ Project — "Outreach"
▸ ◎ Goal — "Get fit"
   └ ▸ Project — "Training plan"
─────────────────────────
⚙  Settings
```

- Goals are top nodes (with a small horizon tag: short / mid / long, §3.1).
- Projects nest under their goal. **Selecting a project → Project Detail screen (C).**
- `[+]` next to GOALS → create-goal. Each goal row has a hover `+` to add a project.
- Collapsible; remembers expansion state.

### 0.2 Pinned Top Bar — "Today" summary *(persistent across all screens)*
A compact, always-present band summarizing today (Foundation §4.5; daily-goal must feel ever-present).

**Collapsed (default) content, left→right:**
- **Daily progress ring** — compact circular fill, green (`--accent-progress`), e.g. `4/6`.
- **Current task** — the active task title, truncated.
- **Streak** — flame + count.
- **Points** — today's points.
- **Proposal indicator** — lilac dot (`status-pending`) *only when* a proposal awaits approval (§4.6, gentle).

**On hover / pointer focus → expands into a popover with light adjustables:**
- The full ordered list of today's Daily Goals (tasks), each with a checkbox.
- Inline **check-off** of a task (✓).
- **Defer one task** / **pull one forward** (quick controls — Journey B-style adjust, available on web too).
- **Review & approve new tasks**: if a proposal/new task is pending, a compact card with **[Approve]** / **[Review in Roadmap →]**.

> Buttons in top-bar popover: `✓ complete` · `↪ defer` · `↩ pull forward` · `Approve` · `Review in Roadmap →`

---

## 1. Screen Inventory

| # | Screen | Purpose | Journey |
|---|---|---|---|
| **A** | Onboarding Flow | First-run: ambition → first roadmap | A |
| **B** | Home / Dashboard | Daily goal details + roadmap summary + overview | B/C entry |
| **C** | Project Detail | The WBS workbench: flow / Gantt / table + WP sheet | C |
| **D** | Roadmap | Full day-by-day path + replan review/approve | C/D |
| **E** | Milestone Celebration (dialog) | Recap + celebration on milestone achieved | E |

Supporting surfaces (not full screens): **WP right-side sheet** (within C), **Replan Proposal review** (within D + top bar), **create dialogs** (goal/project).

---

## A. Onboarding Flow *(Journey A — "from ambition to roadmap")*

A guided, multi-step flow that *teaches the hierarchy as the user builds it* (Journey A step 2). Linear with a visible stepper; each step is a focused screen-state, not the full shell yet.

**Stepper:** `Goal → Project → Breakdown → Milestones & Dependencies → Capacity → Roadmap`

### A1 — Create your first Goal
- **Content:** Welcome line; single prominent input *"What outcome are you pursuing?"*; horizon selector (short / mid / long term — Decision #4); optional description.
- **Buttons:** `[Continue →]` (disabled until title non-empty). `[Skip intro]` (small).

### A2 — Create the first Project
- **Content:** *"What's a concrete initiative toward this goal?"* — project title, optional description, optional target end date.
- **Buttons:** `[← Back]` `[Continue →]`

### A3 — Guided Breakdown (Work Packages → Tasks)
- **Content:** The teaching moment. User adds **work packages** (to-do lists), and **tasks** (to-do lines) inside each. A short inline explainer shows the hierarchy as it's built. Add multiple WPs; each expands to add tasks.
- **Per-item controls:** estimate (hours **or** low/mid/high difficulty — Decision #13, either/or), optional time-fixed toggle (+ date).
- **Buttons:** `[+ Add work package]` · per-WP `[+ Add task]` · inline delete · `[← Back]` `[Continue →]`

### A4 — Milestones & Dependencies *(assisted)*
- **Content:** Two light tasks: (1) **group work packages into milestones** (optional grouping — some WPs may belong to none, §3.2); (2) **draw key dependencies** — the UI **suggests likely orderings** (Journey A step 3) which the user accepts or edits.
- **Controls:** assign WP → milestone; accept/dismiss suggested dependency edges; add an edge manually.
- **Buttons:** `[+ New milestone]` · `Accept suggestion` / `Dismiss` · `[← Back]` `[Continue →]`

### A5 — Set Capacity
- **Content:** *"How many hours per day do you want to spend on this project?"* — single capacity input (0 < h ≤ 24, Decision #12). Brief note that the planner fills each day up to this.
- **Buttons:** `[← Back]` `[Generate my roadmap →]`

### A6 — First Roadmap (proposed)
- **Content:** The "moment of magic" (Journey A step 6): the system's **proposed** day-steps rendered as the Duolingo-style path, milestones placed as landmarks, *starting tomorrow morning*. Days shown in **proposed (lilac)** state. User can adjust (swap/load/lock) before confirming.
- **Controls:** adjust a day (swap task, change load, lock); re-propose.
- **Buttons:** `[Adjust]` (per day) · `[Re-propose]` · `[Confirm & enter Workspace →]`

**Flow sequence (A):**
```
A1 →(Continue)→ A2 →(Continue)→ A3 →(Continue)→ A4 →(Continue)→ A5
   →(Generate)→ A6 →(Confirm)→ B (Home/Dashboard, shell now active)
Any step: [← Back] returns one step. Progress saved per step.
```

---

## B. Home / Dashboard

The landing screen after onboarding and the default return view (Journey C entry). Inside the full shell (sidebar + top bar). Goal: a calm overview where **today is front and center** and the **coming days** are understandable at a glance (Principle 5).

### Layout & content (top → bottom)
1. **Today's Daily Goal — detail panel** *(primary)*
   - Date, the ordered list of today's tasks (Daily Goals), each a row with: checkbox, title, work-package/project label, estimate, status chip (`open` / `in-progress` / `blocked` / `done`), time-fixed pin if applicable.
   - Day-level progress (e.g. `4/6 · 3.5h of 5h`), points earned today.
   - **Working-ahead affordance:** if today's plan is done → a *"Pull tomorrow's tasks forward?"* prompt (Decision #12; Journey C step 2) listing only **unblocked** candidates.
   - **Controls:** `✓ complete task` · `↪ defer task` · `↩ pull forward` · `+ quick add task to today`
2. **Roadmap summary** *(secondary)*
   - A condensed horizontal strip of the next several day-steps with milestone landmarks and "you are here." Read-only preview.
   - **Button:** `[Open Roadmap →]` (→ Screen D)
3. **Goals & progress overview**
   - Roll-up cards per active goal: % done, next milestone + days-away counter, quick link into its projects.
   - **Button (per card):** `[Open project →]`
4. **Needs your attention** *(only when relevant)*
   - Pending replan proposal headline (lilac), slippage recovery prompt (calm, never red — Principle 3).
   - **Buttons:** `[Review →]` (→ Roadmap D) · `[Approve]`

**Flow sequence (B):**
```
Sidebar(project) → C   ·   "Open Roadmap" / summary → D
Complete last task of day → may trigger E (celebration dialog)
"Pull forward" → adds unblocked task to today inline
```

---

## C. Project Detail *(the workbench — Journey C)*

Opened by selecting a project in the sidebar. The dense, command-center heart of the Workspace (§5 "Full"). Shows one project's work packages, milestones, and dependencies, with **three interchangeable views of the same data**.

### C.0 Header
- Project title, parent goal, status, capacity (hours/day, editable), target end date, progress roll-up.
- **View toggle (the key control):** `[ Flow ] [ Timeline ] [ Table ]`
- **Buttons:** `[+ Work package]` · `[Edit project]` · `[⋯ menu]` (archive/delete)

### C.1 View — **Flow Diagram** *(default; §4.2, Principle 5)*
- **Content:** the dependency graph as a canvas. Nodes = work packages (and, expandable, tasks); edges = finish-before dependencies at both levels (Decision #9). Each node colored by **derived status** (`done` green / `in-progress` blue / `blocked` amber+glyph / `open` neutral — design language §4.1). **Critical path** to the next milestone emphasized; milestone landmarks marked.
- **Create dependencies here:** **drag from one node's edge handle to another to connect** (assisted; the canvas can suggest orderings). Invalid edges (cycle / self) are rejected with a calm inline message.
- **Controls:** drag-to-connect; select node → opens WP sheet (C.4); pan/zoom; toggle task-level vs WP-level.
- **Buttons:** `[+ Work package]` · canvas: `Connect (drag)` · `Delete edge` (on selected edge) · `Fit view`

### C.2 View — **Timeline (Gantt)**
- **Content:** the same WPs/tasks on a **horizontal time axis**, milestones as markers, dependencies as connectors, time-fixed items anchored to their dates (pinned, can't drag off — Decision #7), flexible items movable. Today line shown.
- **Create dependencies here too:** drag-to-connect between bars.
- **Controls:** drag a flexible bar to reschedule (proposes a change, doesn't silently rewrite — Principle 1); select bar → WP sheet.
- **Buttons:** `[+ Work package]` · zoom (day/week/month) · `Connect (drag)`

### C.3 View — **Table**
- **Content:** structured at-a-glance table (Principle 5): rows = work packages (expandable to tasks); columns = title, milestone, estimate, time-fixed, status, position. Sortable/filterable (e.g. open-only).
- **Controls:** inline edit cells; row select → WP sheet.
- **Buttons:** `[+ Work package]` · column filters · `Group by milestone`

### C.4 **Work-Package Sheet** *(right-side sheet — opens from any view)*
Selecting a work package slides in a right-side sheet. **A work package is a to-do list**, so the sheet *is* that editable list (§3.1).

- **Sheet header:** WP title (inline-editable), milestone assignment, estimate (hours **or** difficulty), time-fixed toggle + date, status, description.
- **Body — the to-do list:** task rows, each **inline-editable** (per owner decision):
  - checkbox (complete) · title (inline) · estimate (hours/difficulty) · time-fixed pin + date · notes (expand) · dependency chips (add/remove).
  - **Create dependencies in-sheet** as well as on canvas: a task row's dependency control lets you set "must finish after …".
  - **Reorder** rows (drag). **Add task** at the bottom.
  - Blocked tasks show the `blocked` chip + glyph; can't be scheduled (§6).
- **Buttons:** `[+ Add task]` · per row: `✓` `pin` `notes` `+ dependency` `delete` · sheet: `[Close]` `[Delete work package]`
- **Note:** adding a work package or task here is a *normal mid-flight operation* (§4.1) — if confirmed roadmap days exist, it feeds a **replan proposal** rather than silently changing the plan (Principle 1). User is told a proposal was created.

**Flow sequence (C):**
```
Sidebar(project) → C.1 (Flow default)
   ⇄ [Flow|Timeline|Table] toggle switches view, same data
Select WP (any view) → C.4 sheet opens (right)
   Edit tasks inline · drag-to-connect deps (canvas) or add in sheet
Add WP/task mid-flight → if confirmed days exist → replan proposal created
   → top bar lilac dot · review in D
Complete all WPs of a milestone → E (celebration dialog)
```

---

## D. Roadmap *(dedicated screen — Journey C step 4, Journey D)*

The full day-granular path (the summary on Home is the teaser; this is the whole thing) **and** the place to review/approve replan proposals.

### D.1 The Path
- **Content:** the Duolingo-style sequence of day-steps from "now" forward, milestones as landmarks. Each day shows its status: **completed (green, filled), confirmed (neutral, ahead), proposed (lilac), slipped (calm/dashed — never red, Principle 3)**, locked (lock glyph). "You are here" marks today. Filters: by goal (`goal_id`), date range.
- **Per-day controls:** expand to see that day's tasks; adjust (swap/load); **lock/unlock**; confirm a proposed day.
- **Buttons:** `[Propose more days]` (extend horizon) · per day: `[Confirm]` (proposed→confirmed) · `[Lock]` / `[Unlock]` · `[Adjust]`

### D.2 Replan Proposal Review *(panel / drawer within D)*
Where the **detect → analyze → propose → approve** loop is resolved (Foundation §4.4). Surfaces when a proposal is pending (also reachable from top bar / Home).

- **Content:**
  - **Summary headline** (e.g. *"Push 3 tasks forward one day; milestone moves Fri → Mon"*).
  - **Moves list:** each affected task with from-date → to-date.
  - **Milestone impacts:** old → new projected dates.
  - **Time-fixed conflicts — separate section** (Decision #7, Journey D step 3): never auto-moved; shown with **explicit options per conflict**: `Prioritize today` · `Descope` · `Renegotiate date`.
- **Buttons:** `[Approve]` · `[Edit then approve]` (adjust the diff first) · `[Reject]` · per time-fixed conflict: the three option buttons above.
- **Tone:** framed as steering, not failure (Principle 3). Slippage prompts read as recovery, not guilt (Journey D step 2).

**Flow sequence (D):**
```
Home "Open Roadmap" / sidebar Roadmap → D.1
Pending proposal exists → D.2 opens (or via top bar [Review])
  [Approve] → plan updates, days re-render (lilac→neutral/green)
  [Edit then approve] → adjust diff → apply
  [Reject] → plan unchanged
Time-fixed conflict → choose Prioritize / Descope / Renegotiate → resolves that item
Confirm a proposed day → it joins the path ahead
```

---

## E. Milestone Celebration *(dialog — Journey E)*

Triggered when the **last work package in a milestone's set completes** (§3.2, Decision #15). On web this is a **dialog with a celebration visual** (per owner decision) — present but lighter than mobile (§4.5: web "Present", mobile "Primary").

- **Content:** celebration visual/animation; **recap card** — milestone name, what was accomplished, **extra points awarded**, and **what's next** (the next milestone becomes the new near-term landmark, Journey E step 3).
- **Buttons:** `[See what's next →]` (→ Roadmap D, next landmark focused) · `[Close]`
- **Side effect (already handled server-side):** the milestone lights up on the roadmap; points awarded once.

**Flow sequence (E):**
```
Complete final task → milestone set complete → E dialog appears
  [See what's next] → D (next milestone in focus)
  [Close] → returns to prior screen; roadmap landmark now lit
```

---

## 2. Cross-Screen Flow Map

```
                 ┌─────────────────────────────────────────────┐
                 │  SHELL: Left Sidebar + Pinned Top Bar (Today) │
                 └─────────────────────────────────────────────┘
A (Onboarding) ──Confirm──▶ B (Home/Dashboard)
                               │   │        │
        Sidebar(project) ──────┘   │        └────▶ Goal/Project overview cards
                                   │
   ┌──────────────────────────────┼───────────────────────────┐
   ▼                              ▼                            ▼
 C (Project Detail)        D (Roadmap)                Top Bar popover
  Flow│Timeline│Table       Path + Replan review        quick complete/defer/
   └─ WP Sheet (right)        └─ Approve/Edit/Reject       pull-forward/approve
        │                          │
   add WP/task mid-flight ─────────┘ (creates replan proposal)
   complete milestone ──▶ E (Celebration dialog) ──See next──▶ D
```

---

## 3. Global Buttons / Controls Reference

| Context | Buttons / controls |
|---|---|
| **Sidebar** | `+ Goal` · per-goal `+ Project` · expand/collapse · Home · Roadmap · Settings |
| **Top bar (collapsed)** | progress ring · current task · streak · points · proposal dot |
| **Top bar (hover popover)** | `✓ complete` · `↪ defer` · `↩ pull forward` · `+ quick add` · `Approve` · `Review in Roadmap →` |
| **Onboarding** | `Continue →` · `← Back` · `+ Add WP/task` · `+ New milestone` · `Accept/Dismiss suggestion` · `Generate roadmap →` · `Confirm & enter →` |
| **Home** | `Open Roadmap →` · `Open project →` · `Review →` · `Approve` · `Pull forward` · `+ quick add` |
| **Project Detail** | `[Flow|Timeline|Table]` · `+ Work package` · `Edit project` · `Connect (drag)` · `Delete edge` · `Fit view` |
| **WP Sheet** | `+ Add task` · per-row `✓ pin notes +dependency delete` · `Close` · `Delete work package` |
| **Roadmap** | `Propose more days` · per-day `Confirm` `Lock/Unlock` `Adjust` |
| **Replan review** | `Approve` · `Edit then approve` · `Reject` · `Prioritize today` · `Descope` · `Renegotiate date` |
| **Celebration** | `See what's next →` · `Close` |

---

## 4. Status Treatments In Use (from design language §4)

| Where | States shown |
|---|---|
| Flow nodes / table rows | `open` · `in-progress` · `blocked` (amber+glyph) · `done` (green) |
| Day-steps (roadmap) | `proposed` (lilac) · `confirmed` (neutral) · `completed` (green) · `slipped` (calm/dashed) · `locked` |
| Task/WP rows | `time-fixed` (pin) vs flexible |
| Top bar / Home | `pending` proposal (lilac dot) |

---

## 5. Open Questions (carry into hi-fi design)

1. **Default Project Detail view** — proposed as **Flow** first; confirm vs Table/Timeline as default.
2. **Top-bar popover depth** — how many "light adjustables" before it becomes cluttered; where the line is between quick-adjust and "go to Roadmap."
3. **Onboarding for additional goals/projects** — is the full A1–A6 flow reused, or a lighter inline create after the first run?
4. **Drag-to-connect affordance** — exact handle/edge interaction grammar for the Flow canvas (a hi-fi spec of its own).
5. **Empty states** — first project with no WPs, roadmap before first proposal, etc.

---

*Next step: on approval, wire these into low-fi wireframes screen by screen, then design the iOS Companion flow as the counterpart. All screens inherit `ui-ux-design-language.md`.*
