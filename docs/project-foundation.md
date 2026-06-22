# **Product Foundation Document**

## **Goal-Driven Planning Platform — Feature Scope, Domain Model & User Journeys**

**Status:** v1 for review · **Date:** June 11, 2026 **Purpose:** Establish a shared understanding of the product's features, domain model, and user journeys. This document is the source of truth for "what we are building and why." Initial deployment/tech decisions are recorded in §9; the full AWS architecture comes later, constrained by §7 and §9.

---

## **1\. Vision**

A personal goal-achievement platform that closes the gap between **the big picture** (your goals) and **today** (what you actually do this morning). It combines project-management rigor — work breakdown structures, dependencies, milestones — with the daily-habit feel of an app like Duolingo, where progress is visible, momentum is rewarding, and every day is a concrete step on a roadmap.

The product lives on two surfaces with deliberately different personalities:

* **Web app — the Workspace.** The command center for serious, seated work: building goal hierarchies, drawing dependencies, reading flow diagrams and visual tables, replanning. You understand the full state of your work at one glance.  
* **iOS app — the Companion.** The product in your pocket. Not a dashboard — a bridge between the system and your real life. It shows where you stand (roadmap position, daily goals, streak, points), supports light task actions, and reaches out through notifications. The defining moment: you wake up, check your phone, and see today's goals.

One synced product, two roles.

## **2\. Product Principles**

These principles resolve design disputes. When in doubt, return here.

1. **Human in the loop, always.** The system proposes; the user decides. Plans are never silently rewritten — every automated change to the roadmap requires user approval.  
2. **Progress that feels earned.** A simple, predictable point system rewards real outcomes — completed tasks, completed daily goals, achieved milestones — with fixed values per event. No leaderboards, no manipulation loops: points exist to make momentum tangible, not to create anxiety.  
3. **Engagement over perfection.** The streak rewards showing up and engaging with your plan — not flawless completion. A hard day where you opened the app and replanned still counts. The product must never punish honesty about slippage.  
4. **The roadmap bends, it doesn't break.** New work packages, missed days, and shifting priorities are normal. Flexibility is a first-class feature, not an error state.  
5. **One look \= full understanding.** The web workspace must communicate project state visually (flow diagram, tables, roadmap) so the user grasps the situation in seconds.  
6. **Built for the future, scoped for now.** v1 is personal and focused, but the foundation (data model, API design, infrastructure) must cleanly accommodate the planned future features — content inbox, mail/calendar integrations, team collaboration — and a clean later migration to AWS.

## **3\. Domain Model**

### **3.1 The hierarchy (Work Breakdown Structure)**

The user owns their Goals directly.

User  
 └── Goal  (tagged short / mid / long term)  
      └── Project  
           ├── Milestone  (a defined set of Work Packages)  
           └── Work Package  (a to-do list)  
                └── Task  (a to-do line)

| Level | Meaning | Example |
| ----- | ----- | ----- |
| **Goal** | An outcome the user is pursuing, owned directly by the user and classified short/mid/long term. | "Build a client base" |
| **Project** | A concrete initiative under a goal, with a definable end. Owns work packages and milestones. | "Portfolio website" |
| **Work Package** | A **to-do list object**: a cohesive chunk of project work where each to-do line is a Task. The planning unit for dependencies and estimation. | "Design the case-study pages" |
| **Task** | A single to-do line inside a work package. The atomic unit of doing — what appears in Daily Goals and gets checked off. | "Write case study \#1 draft" |

### **3.2 Cross-cutting concepts**

**Milestone.** A named checkpoint within a Project, **defined as a set of Work Packages**. Milestones are an **optional grouping**: a work package may belong to a milestone or to none at all — ungrouped work packages simply contribute to project progress without gating a checkpoint. A milestone is achieved when every work package in its set is complete. Milestones appear as landmark nodes on the roadmap and trigger the celebration moment: **animation \+ recap card \+ extra points**.

**Daily Goals.** The set of tasks selected for a specific calendar day. This is what the Companion surfaces in the morning and what the day's roadmap step contains. Produced by the hybrid planning loop (system proposes → user adjusts, §4.3). Completing all of a day's tasks completes the Daily Goal and awards its points.

**Roadmap.** The day-granular path from "now" to a goal, Duolingo-style: each step is a day carrying its Daily Goals, with milestones as landmarks along the path. The roadmap is a *projection* of the WBS \+ task order \+ work-package dependencies \+ the user's capacity onto the calendar. Normal WBS edits do not rewrite it automatically; the user manually requests Replan, and slippage recovery is approved in the morning brief.

**Dependency.** Task order is position-based inside each Work Package: the second task depends on the first, the third on the second, and so on. Work Packages can also have explicit directed "must finish before" dependencies. This dependency model drives the Project Flow Diagram and constrains the planner — a task whose ordered predecessor is incomplete is *blocked* and cannot be scheduled or pulled forward.

**Capacity.** Per project, the user states **how many hours per day** they want to spend on it. The planner fills each day up to capacity. If the user finishes early and wants more, they can **pull tasks from the next day forward** (only unblocked tasks) — working ahead advances the roadmap.

**Estimation.** Tasks/work packages are estimated in **hours, or with a difficulty level (low / mid / high)**. Difficulty levels map to a nominal planning load so the capacity engine can mix both. *(Exact mapping: design-phase detail, §10.)*

**Time-fixed vs. flexible work.** Every task/work package is either **time-fixed** (bound to a date — a deadline, an appointment, an external commitment) or **flexible** (can shift). This governs replanning (§4.4): flexible work may shift with user approval; time-fixed work is never auto-moved, and conflicts with it are escalated explicitly.

**Points.** Fixed values per scoring event: **task completed**, **daily goal completed** (all of the day's tasks), **milestone achieved** (extra points). Values are constants defined at design time. Tasks completed after a replan score normally — replanning is never penalized (Principle 3).

**Streak.** A count of consecutive days the user *opened and engaged with their plan* (viewed/adjusted Daily Goals, completed or rescheduled work). Completion is not required to keep the streak. The day boundary is **midnight, local time** — this is also the cutoff for slippage detection.

## **4\. Core Features (MVP / v1)**

### **4.1 Goal & WBS management *(web-primary)***

Create and edit the hierarchy: goals (tagged short/mid/long term), projects, work packages (as to-do lists), and tasks (as to-do lines). Group work packages into milestones. Estimate effort in hours or low/mid/high difficulty. Adding a new work package mid-flight is a normal, supported operation: it is added directly, placed as holding work when needed, and the user can manually run Replan to reorganize the roadmap.

### **4.2 Dependencies & Project Flow Diagram *(web-primary)***

Arrange task order inside each work package and define finish-before dependencies between work packages. The **Project Flow Diagram** renders this dependency model visually — what's done, in progress, blocked, and on the critical path to the next milestone. Alongside it, visual tables give a structured at-a-glance view of project state (Principle 5).

### **4.3 Day-based Roadmap & Hybrid Daily Planning *(both surfaces)***

The roadmap lays the path to each goal as a sequence of day-steps with milestone landmarks. Planning is **hybrid**:

1. The system proposes Daily Goals for upcoming days, derived from task order, work-package dependencies (only unblocked work), estimates, deadlines, and the user's per-project hours-per-day capacity.
2. The user adjusts — swaps tasks, changes load, locks a day — and confirms.  
3. Confirmed days render as the roadmap path. Completed days fill in visibly; the current day is highlighted; future days show what's coming.  
4. **Working ahead:** if the day's plan is done and the user wants more, they pull unblocked tasks from the next day forward; the roadmap advances accordingly.

The Companion shows the user's *position* on this path; the Workspace shows the *whole* path and lets the user reshape it.

### **4.4 Slippage & Replanning Flow *(both surfaces, web for deep replans)***

Slippage is detected at **midnight local time**. The system never silently rewrites the plan:

1. **Detect** — incomplete Daily Goals at the day boundary, or a missed day entirely.  
2. **Analyze** — classify affected work as time-fixed or flexible; trace downstream dependency impact; check milestone/deadline risk.  
3. **Propose** — for flexible work: a shifted plan (e.g., "push these 3 tasks forward one day; milestone moves Fri → Mon"). For time-fixed work: no auto-move — the conflict is surfaced explicitly with options (reprioritize today, descope, renegotiate the date).  
4. **Approve** — the user accepts, edits, or rejects the proposal. Only then does the roadmap update.

New work packages and tasks are added directly without automatic replan proposals. When the user wants the roadmap reorganized, they manually request Replan: analyze dependency/roadmap impact → propose updated roadmap → user approves.

### **4.5 Points, Progress Experience & Streak *(mobile-primary, present on web)***

The motivational layer:

* **Points** for completed tasks, completed daily goals, and achieved milestones (fixed values per event; milestone \= extra points).  
* **Milestone celebration:** animation \+ recap card (what was accomplished, points earned, what's next) \+ the milestone lighting up on the roadmap.  
* Satisfying task-completion interactions; the roadmap path visibly filling in; goal-progress roll-ups and days-to-milestone counters.  
* **Streak** kept by daily engagement (midnight-local boundary), independent of completion.

Tone is encouraging and honest — replanning is framed as taking control, never as failure (Principle 3).

### **4.6 Notifications & Morning Brief *(mobile)***

* **Morning brief** (core flow): wake up → notification → today's Daily Goals, roadmap position, streak, points.  
* **Contextual nudges**: milestone approaching, plan needs review after slippage, streak at risk (gentle, engagement-framed).  
* User-controlled timing and frequency. Notifications inform and invite — they don't nag.

### **4.7 Sync *(platform)***

Companion and Workspace operate on the same live data through the same backend API. An action on one surface is reflected on the other. **No offline mode in v1** — both clients require connectivity; offline support may be revisited later.

## **5\. Surface Responsibilities**

| Capability | Web (Workspace) | iOS (Companion) |
| ----- | ----- | ----- |
| Build/edit WBS, dependencies, milestones | ✅ Full | Light edits only (add quick task, edit titles) |
| Project Flow Diagram & visual tables | ✅ Full | View-only summary |
| Roadmap | Full view \+ reshape | Position view ("you are here") |
| Daily planning (review/adjust/confirm) | ✅ | ✅ (primary morning surface) |
| Complete tasks / work ahead | ✅ | ✅ |
| Replanning approvals | Deep replans | Quick approvals of proposals |
| Points, streak & celebrations | Present | ✅ Primary |
| Notifications | — | ✅ |

## **6\. User Journeys**

### **Journey A — Onboarding: from ambition to roadmap *(web)***

1. User signs up and creates their first Goal, choosing its horizon (short/mid/long term).  
2. Guided breakdown: Goal → first Project → Work Packages (as to-do lists) → Tasks (as to-do lines). The UI teaches the hierarchy as the user builds it.  
3. User groups work packages into milestones and draws key dependencies (assisted — the UI suggests likely orderings).  
4. User sets capacity: hours per day they want to spend on this project.  
5. The system proposes the first roadmap: day-steps populated with Daily Goals, milestones placed on the path. User adjusts and confirms.  
6. First "moment of magic": the user sees their ambition rendered as a concrete day-by-day path starting tomorrow morning.

### **Journey B — The Morning Ritual *(iOS — the signature flow)***

1. Morning notification: today's plan is ready.  
2. User opens the Companion: today's Daily Goals, position on the roadmap, current streak and points.  
3. User quickly adjusts if needed (defer one task, pull one forward) and confirms the day. Streak extends — engagement achieved.  
4. Through the day, the user checks off tasks on the phone, earning points with satisfying completion feedback. Completing the full day awards the daily-goal points.

### **Journey C — Deep Work Session *(web)***

1. User opens the Workspace; the dashboard shows project state at a glance: flow diagram, visual tables, roadmap, today's progress.  
2. User works through tasks, marks completions, refines upcoming work packages. If the day's plan is finished, they pull tomorrow's unblocked tasks forward and keep going.  
3. Mid-session, a new requirement emerges → user adds a new Work Package with ordered tasks and any work-package dependencies.
4. When ready, the user opens Replan. The system analyzes impact and proposes an updated roadmap ("milestone shifts \+2 days"). User approves or counter-adjusts. Roadmap re-renders.

### **Journey D — Slippage & Recovery *(both)***

1. Yesterday ended (midnight local) with two incomplete tasks, or the whole day was missed.  
2. Morning brief opens with the recovery proposal, not a guilt trip: "2 tasks from yesterday are pending. They're flexible — shift them to today and tomorrow? Milestone impact: none."  
3. If a *time-fixed* item is involved, it is flagged distinctly: "Friday's deliverable can't move. Options: prioritize it today / descope task X / adjust the commitment."  
4. User picks an option; the roadmap updates; streak continues (the user engaged). The replan feels like steering, not failing.

### **Journey E — Milestone Reached *(both)***

1. The user completes the last work package in a milestone's set.  
2. Celebration moment (mobile especially): **animation**, the milestone lights up on the roadmap, **extra points** are awarded, and a **recap card** summarizes what was accomplished and what's ahead.  
3. The roadmap ahead comes into focus — the next milestone becomes the new near-term landmark.

## **7\. Out of Scope for v1 — Designed-for Future Features**

These are **not built in v1**, but the data model and architecture must not preclude them:

| Future feature | v1 design obligation |
| ----- | ----- |
| **Content Inbox** (save articles/videos/screenshots/posts; morning triage into backlog or archive) | The Daily Goals / morning-brief flow must be extensible to carry non-task items (content triage cards). The data model should anticipate an "inbox item" entity feeding the planning loop. |
| **Mail & Calendar integration** | Time-fixed tasks already model external commitments; calendar events will later map onto the same concept. Keep an integration seam in the planning engine. |
| **Notes** | Attachable to any WBS node later; no v1 work needed beyond not hard-coding against it. |
| **Team collaboration / shared workspaces** | Data model is personal-first but multi-tenant-ready: every entity owned by a workspace (which in v1 always equals one user). Avoid assumptions that user \== workspace in code. |
| **Android app** | API-first backend; no business logic locked into the iOS client. |
| **Offline mode** | Not in v1; API-first clients keep the option open. |
| **AWS deployment** | Phase 1 runs on Vercel \+ Supabase but follows the migration-readiness rules in §9 so the move to AWS is low-friction. |

## **8\. Decision Log**

| \# | Question | Decision |
| ----- | ----- | ----- |
| 1 | MVP scope | Goals \+ WBS \+ dependencies/flow diagram \+ day-based (Duolingo-style) roadmap \+ rewarding progress UX \+ infrastructure ready for content inbox & integrations |
| 2 | Personal vs team | Personal first; collaboration later |
| 3 | Mobile role | Companion, not dashboard: roadmap position, daily goals, streak, points, notifications, light task actions |
| 4 | WBS hierarchy | User → Goal (short/mid/long) → Project → Work Package (to-do list) → Task (to-do line) |
| 5 | Milestone definition | An optional grouping: a set of Work Packages within a project (some WPs may belong to no milestone); achieved when all WPs in the set complete |
| 6 | Daily planning | Hybrid: system proposes, user adjusts and confirms; user can pull next-day unblocked tasks forward |
| 7 | Slippage handling | Ask the user; time-fixed work never auto-moves; flexible work may shift, only with user approval |
| 8 | Streak rule | Kept by opening & engaging with the plan (completion not required) |
| 9 | Dependency levels | Task order inside work packages plus explicit work-package dependencies |
| 10 | Mobile platform | iOS first (Swift) |
| 11 | Point system | Fixed values per event: task completed, daily goal completed, milestone achieved (extra points) |
| 12 | Capacity model | User sets hours/day per project; planner fills to capacity; work-ahead pulls next-day tasks |
| 13 | Estimation unit | Hours, or low/mid/high difficulty |
| 14 | Day boundary | Midnight, local time (streak \+ slippage detection) |
| 15 | Milestone celebration | Animation \+ recap card \+ extra points |
| 16 | Phase-1 deployment | Local dev \+ Vercel \+ Supabase; AWS migration later |
| 17 | Offline | Not in v1 |
| 18 | Tech stack | Web: React \+ TypeScript; iOS: Swift; both on the same backend API and database |
| 19 | Planning engine location | Decide later; keep the logic modular and replaceable |

## **9\. Phase-1 Architecture & Deployment Decisions**

The full AWS architecture will be designed later. For now, the product ships on a lightweight stack chosen for speed and team sharing, with strict rules that keep the AWS migration cheap.

### **9.1 Stack**

User ──► Vercel (Web UI)        iOS App (Swift)  
              │                       │  
              └──────► Vercel API ◄───┘  
                           │  
                     Supabase (Postgres \+ Auth)

**Vercel — frontend \+ backend API**

* Hosts the web UI (React \+ TypeScript / Next.js): roadmap, tasks, dashboard.  
* Runs the API routes (e.g., `/api/tasks`, `/api/replan`) and the planning logic.  
* Auto-deploys from GitHub; preview deployments make work shareable across the team.

**Supabase — database \+ auth (+ optional realtime later)**

* Postgres stores all domain data: goals, projects, work packages, tasks, dependencies, milestones, points, streaks.  
* Handles user accounts and authentication.  
* Realtime features are available later if needed.

**iOS app (Swift)** consumes the same Vercel API and the same database as the web app — no separate backend.

### **9.2 AWS migration-readiness rules**

These rules are binding for all Phase-1 code:

1. **No direct Supabase calls from the frontend** — all data access goes through our API.  
2. **Our own API design** — endpoints and contracts are ours, not dictated by the platform, so clients don't change when the backend moves.  
3. **Business logic lives in reusable modules**, importable independently of the hosting platform.  
4. **Clean, relational DB schema** — standard Postgres, portable as-is.  
5. **Auth is loosely coupled** — swappable without rewriting business logic.  
6. **No critical logic in DB triggers.**  
7. **No reliance on Vercel-specific features** in core logic.

### **9.3 Deliberately deferred**

* **Roadmap-projection / replanning engine location (client vs. server) and proposal computation.** The logic will evolve; it is built as a modular, replaceable component behind the API so this decision can be made (and remade) later.  
* **AWS service topology** — designed at migration time, constrained by §9.2.

## **10\. Open Questions**

* **Point values:** the fixed constants per event (task / daily goal / milestone) — to be tuned during design.  
* **Difficulty → load mapping:** how low/mid/high difficulty translates to planning hours for the capacity engine.  
* **Multi-project days:** when several projects have daily capacity, how the morning brief orders/groups them (design-phase detail).

---

*Next step: review and approve, then begin Phase-1 implementation per §9.*
