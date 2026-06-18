# UI Design Gap Updates

_Last updated: 2026-06-19_

This summarizes the web UI parity work against
`docs/design/project/TodoMapp Prototype.dc.html`. The implementation remains React + Vite and uses
the existing dark "Earned Momentum" token system in `frontend/src/styles/tokens.css`.

## API support added
- Enriched roadmap/day/morning-brief task refs with project, work package, estimate, difficulty,
  time-fixed, fixed date, and blocked metadata.
- Added proposal detail `refs.tasks` so Replan Review can show readable task/project names.
- Added `GET /goals/{goalId}/projects?include=progress` for sidebar project progress.
- Added frontend `tasksApi.pullForward(taskId, toDate?)`.

## Shell and Home
- Replaced the static top bar with an expandable Today bar: progress ring, current task, streak,
  points, proposal pill, quick add, defer, complete/reopen, pull-forward candidates, and proposal
  actions.
- Updated the sidebar to a WBS tree with goal/project creation, roadmap proposal indicator,
  project progress, and settings row.
- Reworked Home into the prototype dashboard: grouped Today tasks, estimates/status/time-fixed pins,
  road-ahead strip, goal progress cards, and richer attention card.

## Onboarding
- Split onboarding into seven steps:
  `Goal → Project → Milestone → Breakdown → Group → Capacity → Roadmap`.
- Added first-milestone preview and grouping/order step with milestone assignment and suggested
  ordering.
- Restyled the final roadmap step as a horizontal proposed-day path with milestone diamonds.

## Roadmap and Replan
- Replaced the centered vertical list with a full-width horizontal path and right-side day context
  panel.
- Added goal/date filters, propose-more-days action, day confirm/lock/adjust controls, grouped day
  tasks, and automatic pending-proposal review.
- Replan Review now uses `refs.tasks` and is backward-compatible with older proposal responses.

## Project workbench
- Made Flow the default view and ordered the toggle as `Flow | Timeline | Table`.
- Updated Flow to show work packages only. Clicking a work package lists and edits its tasks in an
  inline right-side panel instead of opening an overlay.
- Restyled Flow canvas with dotted background, status cards, lilac handles, and critical path cues.
- Added Timeline milestone grouping and day/week/month zoom while keeping drag-to-replan as a
  proposal-only action.
- Added Table search, open-only filter, group-by-milestone, sortable columns, position/time-fixed
  columns, and richer expanded task rows.
- Converted Add Work Package from a right sheet to a centered modal.

## Work package panel
- Changed the work package detail view from a darkening overlay sheet to a persistent side panel.
- The panel supports inline WP edits, task complete/reopen, delete, task detail edits, task reorder
  with drag and up/down fallback, notes, estimate, time-fixed date, and dependency chips.

## Celebration
- Restyled milestone celebration with lilac landmark visual, confetti, recap rows, points/streak
  summary, next landmark card, and buttons `See what's next` / `Close`.
- Motion continues to respect the global reduced-motion rule.

## Verification
- Frontend `npm run typecheck`: passing.
- Frontend `npm test`: passing.
- Frontend `npm run build`: passing, with the existing Vite large-chunk warning.
- Backend typecheck passed during the parity pass. DB-backed backend tests require `DIRECT_URL`;
  they were not runnable in the local environment without that value.
- Automated browser verification could not run because `agent-browser` was not installed locally.
