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
- `src/planner/replan/scheduler.ts`: pure greedy scheduling engine.
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

8. A new pending `replan_proposal` is inserted. Older pending proposals are marked
`expired`, except the slippage job backs off from pending user-intent proposals.

## Step By Step: Scheduling

The scheduler in `src/planner/replan/scheduler.ts` is deterministic and greedy. It
does not solve a global optimization problem.

The high-level loop is:

1. Optionally split oversized flexible tasks into virtual parts.
2. Validate dependency graph consistency.
3. Build old assignment from `currentPlan`.
4. Add locked and frozen tasks to the assignment first.
5. Detect capacity conflicts caused by frozen work.
6. Mark impossible tasks:
   - time-fixed task with no fixed date
   - task larger than both global and project daily capacity
7. For each day in the horizon:
   - add frozen tasks for that day to the scheduled set
   - skip the day if it is locked
   - repeatedly collect feasible candidates
   - sort candidates by priority rank
   - place the best candidate
   - update load and dependency readiness
8. Anything still unscheduled after the horizon becomes an `unscheduled_task`
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

The current "objective function" is a greedy lexicographic ranking, not a summed
score. For each day, all feasible candidates are sorted by a rank tuple. The
scheduler picks the candidate with the smallest tuple.

The configured production objective is currently:

```text
objective: "earliest_completion"
```

There is also support for:

```text
objective: "min_disruption"
```

The objective affects earliest allowed date:

- `earliest_completion`: flexible tasks may be pulled as early as the replan start
  date if dependencies and capacity allow it.
- `min_disruption`: if a task already had an old future date, it cannot be moved
  earlier than that old date.
- Time-fixed tasks always use their fixed date as earliest allowed date.

## Priority Ranking Calculation

The ranking is calculated in `rankTask(taskId, currentDay)`.

Code-equivalent tuple:

```ts
[
  -isFixedToday,
  -wasPlannedToday,
  -isOverdueFromOldPlan,
  fixedPressure,
  project.priority,
  task.priority,
  oldDelta,
  project.position,
  wp.position,
  task.position,
  -isNewTask,
  taskId,
]
```

The scheduler sorts ascending. That means smaller values win.

### Ranking Fields

`isFixedToday`

```text
1 if task.isTimeFixed and task.fixedDate == currentDay
0 otherwise
```

The tuple uses `-isFixedToday`, so fixed work due today wins before non-fixed work.

`wasPlannedToday`

```text
1 if the old assignment date == currentDay
0 otherwise
```

The tuple uses `-wasPlannedToday`, so tasks already planned for this day are favored.
This reduces unnecessary movement.

`isOverdueFromOldPlan`

```text
1 if the task had an old date before the replan start date
0 otherwise
```

The tuple uses `-isOverdueFromOldPlan`, so overdue work is favored.

`fixedPressure`

```text
daysBetween(currentDay, task.fixedDate), if task has fixedDate
9999 otherwise
```

Lower wins. A task with a nearer fixed date has more scheduling pressure. In normal
valid data, only time-fixed tasks have `fixedDate`.

`project.priority`

Lower wins. In the current repository, `project.priority` is loaded from
`project.position` in `analyze.ts`. There is no separate persisted project priority
field in the checked-in schema.

`task.priority`

Lower wins. In the current repository, `task.priority` is loaded from `task.position`
in `analyze.ts`. There is no separate persisted task priority field in the checked-in
schema.

`oldDelta`

```text
abs(daysBetween(oldDate, currentDay)), if task had an old date
9999 otherwise
```

Lower wins. This favors keeping tasks close to where they already were.

`project.position`, `wp.position`, `task.position`

Lower wins. These are stable WBS ordering tie-breakers.

`isNewTask`

```text
1 if the task had no old assignment
0 otherwise
```

The tuple uses `-isNewTask`, so if all earlier fields tie, new tasks beat old tasks.
In practice, old tasks often win earlier through `wasPlannedToday` and `oldDelta`.

`taskId`

Final deterministic tie-breaker.

### Example Ranking

Assume today is `2026-06-22`, current day being filled is also `2026-06-22`, and
all tasks fit capacity.

Task A:

```text
old date: 2026-06-22
fixed: no
project position: 0
task position: 2
```

Task B:

```text
old date: none
fixed: no
project position: 0
task position: 1
```

Their important rank fields:

```text
A: wasPlannedToday = 1, oldDelta = 0, isNewTask = 0
B: wasPlannedToday = 0, oldDelta = 9999, isNewTask = 1
```

Because `-wasPlannedToday` is compared before task position, A wins even though B
has a lower task position.

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

## How To Modify The Ranking

Most ranking changes belong in `rankTask` in:

```text
src/planner/replan/scheduler.ts
```

Common changes:

- Give real priority fields more weight by placing `project.priority`,
  `wp.priority`, or `task.priority` earlier in the tuple.
- Favor earliest completion more aggressively by moving `oldDelta` later.
- Favor stability more aggressively by moving `oldDelta` earlier.
- Favor shortest tasks by adding `task.estimateHours` before position.
- Favor deadline pressure by adding project target date or milestone target date.
- Prevent new tasks from jumping ahead by replacing `-isNewTask` with `isNewTask`.

If a new persisted priority column is added, also update `buildPlanningState` in:

```text
src/domain/replan/analyze.ts
```

Today, `priority` is just copied from `position`, so editing the tuple alone will not
create a new priority concept unless the planner state starts receiving one.

## How To Modify The Objective

To switch the current production behavior from earliest completion to minimum
disruption, change the planner config in `analyzeReplan`:

```text
objective: "earliest_completion"
```

to:

```text
objective: "min_disruption"
```

To make objective user-configurable, pass a request-level or user-setting value into
`analyzeReplan`, validate it, and set `PlannerConfig.objective` from that value.

For a true optimizer, replace the greedy day loop with a model that minimizes a
weighted cost function, for example:

```text
total cost =
  movement_weight * sum(abs(new_date - old_date))
  + completion_weight * sum(completion_date)
  + lateness_weight * sum(max(0, completion_date - target_date))
  + unscheduled_weight * unscheduled_count
```

That would require explicit tradeoff weights and careful tests for locked days,
time-fixed work, dependency order, and capacity.

