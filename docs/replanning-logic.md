# Replanning Logic

This document explains how the current replanning pipeline works, what triggers it,
how the scheduler chooses tasks, and where to change the ranking behavior.

## Core Idea

Replanning is a human-in-the-loop proposal flow. It does not immediately rewrite the
roadmap. A trigger creates a `replan_proposal` row containing a JSON diff. The plan
tables are changed only after the user approves the proposal.

Main flow:

```text
trigger
  -> analyzeReplan
  -> planRoadmap
  -> createProposalDiff
  -> store replan_proposal
  -> review
  -> approve or reject
  -> applyChanges, only if approved
```

Important files:

- `src/domain/replan/analyze.ts`: reads DB state and builds planner input.
- `src/planner/replan/scheduler.ts`: pure queue-first scheduling engine with the
  virtual-capacity repair loop.
- `src/planner/replan/constants.ts`: repair-loop limits (max extra hours, iterations).
- `src/planner/replan/proposalDiff.ts`: compares old plan vs proposed plan.
- `src/domain/replan/proposals.ts`: proposal lifecycle.
- `src/domain/replan/apply.ts`: applies an approved diff to roadmap tables.
- `src/domain/replan/dayReview.ts`: day-by-day proposal review.

## What Triggers A Replan

### Manual user request

`POST /v1/replan-proposals` accepts only `trigger: "user_request"` from clients.
The frontend uses this for the Roadmap "Replan" button and for Timeline drag.

Timeline drag is not a hard "move this task to that date" operation. The current
backend only supports a replan scope with an anchor date:

```json
{
  "trigger": "user_request",
  "scope": {
    "project_id": "...",
    "from_date": "YYYY-MM-DD"
  }
}
```

The drop date is treated as "replan from here", not as a guaranteed target slot.

### New work package during an active roadmap

`createWorkPackage` checks whether confirmed roadmap days exist. If they do, it
creates a `new_work_package` proposal in the same transaction as the work-package
insert. The existing plan is not touched until approval.

### Slippage detector

The background job finds confirmed past days that still have planned items. It marks
those days as `slipped` and creates a `slippage` proposal if there is something
actionable to review. The job never applies the proposal.

## Step By Step: Proposal Generation

1. The trigger calls `createProposal` or `createProposalInTx`.

2. `analyzeReplan` chooses the planning start date:
   - `scope.from_date`, when provided.
   - Otherwise the user's local today.

3. `buildPlanningState` loads:
   - active goals, projects, milestones, work packages, and tasks
   - task dependencies
   - work-package dependencies
   - current planned items
   - day status and lock metadata
   - global daily capacity from `user_stats`
   - project daily capacities from `project.capacity_hours_per_day`
   - completed work for today, to reduce today's remaining capacity

4. Some existing tasks are marked frozen:
   - tasks outside the requested project scope
   - tasks on dates before the replan start date
   - tasks on locked days
   - tasks on future confirmed days
   - tasks explicitly selected as "keep today"

5. `analyzeReplan` calls `planRoadmap` with this config:

```text
today: start date
horizonDays: usually 120
sameDayDependencies: true
allowTaskSplitting: true
objective: "earliest_completion"
```

6. `planRoadmap` returns a new assignment:

```text
task id -> proposed date
```

7. `createProposalDiff` compares:

```text
old assignment from currentPlan
vs
new assignment from planRoadmap
```

It produces:

- `moves`: changed date, newly scheduled, or descheduled tasks.
- `insertions`: tasks with no old date and a new date.
- `removed_or_unplanned`: tasks with an old date and no new date.
- `milestone_impacts`: projected milestone date changes.
- `goal_impacts`: projected goal date changes.
- `time_fixed_conflicts`: time-fixed work that needs explicit user choice.
- `planning_conflicts`: non-time-fixed planning conflicts.
- `split_report`: flexible tasks split into smaller parts for capacity.
- `capacity_proposals`: per-project advisory extra capacity needed to meet a deadline.
- `deadline_results`: per-project deadline satisfaction (met or not).

8. A new pending `replan_proposal` is inserted. Older pending proposals are marked
`expired`, including when a slippage recovery proposal supersedes earlier user intent.

## Step By Step: Scheduling

The scheduler in `src/planner/replan/scheduler.ts` is deterministic. It builds one
priority-ordered task queue, fills it to capacity, then repairs missed deadlines by
proposing extra capacity. It does not solve a global optimization problem.

The high-level flow is:

1. Optionally split oversized flexible tasks into virtual parts.
2. Validate dependency-graph consistency (cycles, intra-WP / intra-project rules).
3. Reserve protected work: completed-today, frozen tasks, locked-day items, and
   time-fixed tasks. This immovable baseline is where every fill pass starts.
4. Detect capacity conflicts caused by that reserved work.
5. Mark impossible tasks:
   - time-fixed task with no fixed date
   - task larger than both global and project daily capacity and not splittable
6. Order projects by deadline pressure (see Project Urgency Ordering).
7. Build one dependency-valid, priority-aware task queue across all projects.
8. Fill the queue: for each task, take its earliest dependency-valid day, then scan
   forward to the first day with room under the (base + proposed-extra) capacity.
9. If a project misses its deadline, propose extra capacity and refill from scratch
   (the repair loop), then minimize the proposed extra once a feasible plan is found.
10. Anything still unplaceable becomes an `unscheduled_task` conflict; a deadline that
    cannot be met within the extra-capacity limits becomes an `infeasible_plan`
    conflict.

## Hard Constraints

A task can be considered for a day only if all of these pass:

- The task is not done.
- The task is not replaced by split parts.
- The task is not already assigned.
- The task is not impossible.
- Time-fixed tasks are considered only on their fixed date.
- The current day is not earlier than the task's earliest allowed date.
- Task-level dependencies are ready.
- Work-package dependencies are ready.
- Adding the task does not exceed global capacity for the day.
- Adding the task does not exceed project capacity for the day.
- Locked days are not modified.

## Objective Function

The guiding objective is to keep already-planned work still, finish projects by their
deadlines, never silently exceed capacity, keep work packages together, and respect
priority. The scheduler does not minimize a single weighted score; it encodes those
preferences structurally:

- Hard constraints are feasibility filters: dependency order, time-fixed dates, locked
  days, and capacity (base plus any explicitly proposed extra).
- Soft preferences are encoded in ordering: project urgency, work-package critical
  path, and task position decide what gets capacity first.

The earliest-day selection still honors a per-task objective knob:

- `earliest_completion` (production): a flexible task may be pulled as early as the
  replan start date if dependencies and capacity allow.
- `min_disruption`: a flexible task with an old future date is floored at that old
  date, reducing movement.
- Time-fixed tasks always use their fixed date.

## Project Urgency Ordering

`sortProjectsByUrgency` ranks projects before any task is placed. For each project
with a `target_end_date`:

```text
required_daily    = remaining_effort / eligible_days_before_deadline
deadline_pressure = required_daily / project.capacity_hours_per_day
```

Projects sort by: already-missed deadline first, then highest pressure, then closest
deadline, then `position` (the explicit-priority proxy — there is still no separate
priority column). Pressure also predicts the repair loop: `> 1.0` means the deadline
is unreachable under normal capacity, so extra capacity will be proposed.

## Queue Construction

`buildTaskQueue` produces one global queue. Projects come in urgency order; inside a
project, work packages are topologically sorted and, among ready WPs, ordered by
critical-path length, then downstream-WP count, then position; inside a WP, tasks are
topologically sorted and ordered by position. Because v1 dependencies stay
intra-project, the queue alone guarantees predecessor-before-successor, and keeping a
work package's tasks contiguous is what holds it together.

The fill (`assignQueue`) walks the queue once: each task takes its earliest
dependency-valid day, then scans forward to the first day with room under the
`base + proposed-extra` capacity envelope, skipping locked days.

## Virtual-Capacity Repair Loop

When the fill leaves a project past its deadline, the scheduler proposes extra
(overload) capacity rather than just giving up:

1. Find the highest-priority project that misses its deadline.
2. Add one `capacity_increment_step` (0.5h) of extra capacity on the eligible day
   closest to the deadline, raising the project and global ceilings in lockstep.
3. Refill the whole queue from scratch — added capacity can shift earlier placements.
4. Repeat until every deadline is met or a limit is hit: `max_extra_hours_per_day`
   (4), `max_extra_hours_per_week` (10), `max_iterations` (100). Hitting a limit emits
   an `infeasible_plan` conflict.
5. Once feasible, minimize: try removing each proposed increment and keep the removal
   only if no previously-satisfied deadline regresses.

The proposed extra capacity is **advisory**. It is reported on the proposal as
`capacity_proposals` (per project, per day, with `normal_projected_date` vs
`proposed_projected_date`) and `deadline_results`, but approval only writes the denser
day assignments — base capacities are never changed.

## Time-Fixed Work

Time-fixed work is not silently moved.

Generation rule:

- The generated diff should not auto-move time-fixed commitments.
- Time-fixed issues are surfaced through `time_fixed_conflicts`.

Apply rule:

- If a diff does contain a move for a time-fixed task, `applyChanges` rejects it
  unless there is an explicit `time_fixed_resolutions` entry.

Supported choices:

- `prioritize`: keep it where it is.
- `descope`: defer the old item and create no successor.
- `renegotiate`: update `task.fixed_date` and move it to the new date.

## Task Splitting

When task splitting is enabled, large flexible tasks may be split into virtual parts
before scheduling.

Rules:

- Time-fixed tasks are never auto-split.
- Locked-day tasks are never auto-split.
- Frozen tasks are never auto-split.
- Split parts are chained by dependencies so part 2 follows part 1, etc.
- Proposal generation is read-only; virtual split parts become real tasks only when
  the proposal is approved.

On approval, `applyChanges` materializes split parts as real `task` rows, marks the
original task `replaced_at`, and rewires dependencies around the new parts.

## Approval Semantics

Approving a proposal is transactional:

1. Claim the proposal by changing status from `pending` to `approved` or
   `edited_approved`.
2. Apply the effective diff.
3. Store `applied_changes`.
4. Record engagement and refresh stats.

For each move:

- `from_date` item becomes `deferred`.
- `to_date` gets a fresh `daily_plan_item` with `origin = "replanned"`.
- If `to_date` is null, the task is descheduled only.

Rejecting a proposal:

- Changes proposal status to `rejected`.
- Does not touch plan tables.
- Still counts as engagement.

## Day-By-Day Review

Roadmap review can approve or reject individual changed dates.

Approving a date applies only moves touching that date. If split parts span multiple
dates, the related dates are resolved together because a partial split approval would
be invalid.

Rejecting a date records it in `rejected_dates`; those moves are excluded from the
preview and from later active move selection.

The proposal remains `pending` until every review date is decided.

## How To Modify The Scheduler

Ordering changes belong in `src/planner/replan/scheduler.ts`:

- Project order: edit `sortProjectsByUrgency` (e.g. weight explicit priority over
  pressure, or change how `eligible_days_before_deadline` is counted).
- Work-package order: edit the `wpCompare` comparator in `buildTaskQueue` (critical
  path vs downstream count vs position).
- Task order: edit the `taskCompare` comparator in `buildTaskQueue`.

Deadline reasoning is keyed on `project.target_end_date` only. Milestones and goals
have no deadline column; their dates remain derived projections surfaced as impacts.
If a persisted project-priority column is added, also populate `project.priority` in
`buildPlanningState` (`src/domain/replan/analyze.ts`) — today it is copied from
`position`.

## How To Tune The Repair Loop

Repair behavior is controlled by the limits in `src/planner/replan/constants.ts`
(`MAX_ITERATIONS`, `MAX_EXTRA_GLOBAL_HOURS_PER_DAY`, `MAX_EXTRA_HOURS_PER_WEEK`,
`CAPACITY_INCREMENT_STEP`) and can be overridden per request by setting the matching
`PlannerConfig` fields in `analyzeReplan` (set iterations or per-day extra to 0 to
disable it). The distribution policy — which day gets the next increment — lives in
`addCapacityIncrement`; the trimming policy lives in the STEP-11 minimization block.

## How To Modify The Objective

The production objective for earliest-day selection is `earliest_completion`, with
`min_disruption` available (it floors a flexible task's earliest day at its old date).
Switch it via `PlannerConfig.objective` in `analyzeReplan`.

For a true weighted-cost optimizer, replace the queue fill with a model that minimizes
a cost function, for example:

```text
total cost =
  movement_weight * sum(abs(new_date - old_date))
  + completion_weight * sum(completion_date)
  + lateness_weight * sum(max(0, completion_date - target_date))
  + unscheduled_weight * unscheduled_count
```

That would require explicit tradeoff weights and careful tests for locked days,
time-fixed work, dependency order, and capacity.
