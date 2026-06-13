-- ============================================================================
-- Initial schema — Goal-Driven Planning Platform (Phase 1)
-- Translates data-model.md §2–§4 faithfully: enums, CHECK constraints,
-- composite FKs, and the partial unique indexes that do real work (notably the
-- point_event double-award guard, §4.6).
--
-- Target: PostgreSQL 15+ (Supabase). Standard Postgres only — no triggers
-- (§9.2 rule 6), no Supabase-specific objects (portable per §9.2 rule 4).
-- The `ON DELETE SET NULL (column)` form on work_package's composite FK
-- requires Postgres 15+.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto on older PG; built-in on 13+. Ensure it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- §2  Enumerated types
-- ----------------------------------------------------------------------------
CREATE TYPE goal_horizon     AS ENUM ('short', 'mid', 'long');
CREATE TYPE goal_status      AS ENUM ('active', 'achieved', 'archived');
CREATE TYPE project_status   AS ENUM ('active', 'completed', 'archived');
CREATE TYPE difficulty_level AS ENUM ('low', 'mid', 'high');
CREATE TYPE task_status      AS ENUM ('todo', 'done');
CREATE TYPE day_status       AS ENUM ('proposed', 'confirmed', 'completed', 'slipped');
CREATE TYPE plan_item_type   AS ENUM ('task');                 -- future: 'inbox_triage' (§7)
CREATE TYPE plan_item_status AS ENUM ('planned', 'completed', 'deferred');
CREATE TYPE plan_item_origin AS ENUM ('proposed', 'user_added', 'pulled_forward', 'replanned');
CREATE TYPE proposal_trigger AS ENUM ('slippage', 'new_work_package', 'user_request');
CREATE TYPE proposal_status  AS ENUM ('pending', 'approved', 'edited_approved', 'rejected', 'expired');
CREATE TYPE point_event_type AS ENUM ('task_completed', 'daily_goal_completed', 'milestone_achieved');
CREATE TYPE workspace_role   AS ENUM ('owner');                -- future: 'admin', 'member' (§7)
CREATE TYPE device_platform  AS ENUM ('ios');                  -- future: 'android', 'web_push' (§7)

-- ----------------------------------------------------------------------------
-- §4.1  Identity & Tenancy
-- ----------------------------------------------------------------------------

CREATE TABLE workspace (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Opaque external auth subject; NO FK into auth.users (§9.2 rule 5: auth swappable).
  auth_subject text        NOT NULL UNIQUE,
  email        text        NOT NULL,
  display_name text,
  -- IANA tz name; drives the midnight-local day boundary (Decision #14).
  timezone     text        NOT NULL DEFAULT 'UTC',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive unique email.
CREATE UNIQUE INDEX app_user_email_lower_key ON app_user (lower(email));

CREATE TABLE workspace_member (
  workspace_id uuid           NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      uuid           NOT NULL REFERENCES app_user(id)  ON DELETE CASCADE,
  role         workspace_role NOT NULL DEFAULT 'owner',
  created_at   timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
-- login → workspace lookup
CREATE INDEX workspace_member_user_idx ON workspace_member (user_id);

CREATE TABLE device (
  id           uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid            NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  platform     device_platform NOT NULL DEFAULT 'ios',
  push_token   text            NOT NULL UNIQUE,
  last_seen_at timestamptz,
  created_at   timestamptz     NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- §4.2  The WBS Hierarchy
-- ----------------------------------------------------------------------------

CREATE TABLE goal (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid         NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  title        text         NOT NULL CHECK (length(trim(title)) > 0),
  description  text,
  horizon      goal_horizon NOT NULL,
  status       goal_status  NOT NULL DEFAULT 'active',
  achieved_at  timestamptz,
  position     integer      NOT NULL DEFAULT 0,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX goal_workspace_status_idx ON goal (workspace_id, status);

CREATE TABLE project (
  id                     uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid           NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  goal_id                uuid           NOT NULL REFERENCES goal(id)      ON DELETE CASCADE,
  title                  text           NOT NULL CHECK (length(trim(title)) > 0),
  description            text,
  -- Planner fills each day up to this value (Decision #12). Capacity is passed
  -- to the planner as a parameter, not hard-wired — see src/planner.
  capacity_hours_per_day numeric(4,2)   NOT NULL
                           CHECK (capacity_hours_per_day > 0 AND capacity_hours_per_day <= 24),
  status                 project_status NOT NULL DEFAULT 'active',
  target_end_date        date,
  completed_at           timestamptz,
  position               integer        NOT NULL DEFAULT 0,
  created_at             timestamptz    NOT NULL DEFAULT now(),
  updated_at             timestamptz    NOT NULL DEFAULT now(),
  -- Supports composite FKs that pin children to the same workspace.
  UNIQUE (id, workspace_id)
);
CREATE INDEX project_goal_idx             ON project (goal_id);
CREATE INDEX project_workspace_status_idx ON project (workspace_id, status);

CREATE TABLE milestone (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES project(id)   ON DELETE CASCADE,
  title        text        NOT NULL CHECK (length(trim(title)) > 0),
  description  text,
  -- Set ONCE by the API when every WP in the set completes; gates celebration
  -- + extra points so they fire exactly once (§6 derived state).
  achieved_at  timestamptz,
  position     integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Referenced by work_package's composite FK to guarantee same-project grouping.
  UNIQUE (id, project_id)
);
CREATE INDEX milestone_project_idx ON milestone (project_id);

CREATE TABLE work_package (
  id            uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid             NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_id    uuid             NOT NULL REFERENCES project(id)   ON DELETE CASCADE,
  milestone_id  uuid,
  title         text             NOT NULL CHECK (length(trim(title)) > 0),
  description   text,
  estimate_hours numeric(5,2)    CHECK (estimate_hours > 0),
  difficulty    difficulty_level,
  is_time_fixed boolean          NOT NULL DEFAULT false,
  fixed_date    date,
  -- Cache: set by the API when all child tasks are done; cleared if one reopens.
  -- Source of truth remains the tasks (§6).
  completed_at  timestamptz,
  position      integer          NOT NULL DEFAULT 0,
  created_at    timestamptz      NOT NULL DEFAULT now(),
  updated_at    timestamptz      NOT NULL DEFAULT now(),
  -- Either/or estimation (Decision #13): hours XOR difficulty, or neither.
  CONSTRAINT work_package_estimate_xor
    CHECK (num_nonnulls(estimate_hours, difficulty) <= 1),
  CONSTRAINT work_package_time_fixed_pairing
    CHECK (is_time_fixed = (fixed_date IS NOT NULL)),
  -- Composite FK guarantees the milestone belongs to the SAME project. Deleting
  -- a milestone ungroups its WPs (nulls only milestone_id, keeps project_id) —
  -- PG15+ column-list SET NULL form.
  CONSTRAINT work_package_milestone_fk
    FOREIGN KEY (milestone_id, project_id)
    REFERENCES milestone (id, project_id)
    ON DELETE SET NULL (milestone_id)
);
CREATE INDEX work_package_project_idx   ON work_package (project_id);
CREATE INDEX work_package_milestone_idx ON work_package (milestone_id);
-- Open-work scans for the planner.
CREATE INDEX work_package_open_idx      ON work_package (project_id) WHERE completed_at IS NULL;

CREATE TABLE task (
  id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid             NOT NULL REFERENCES workspace(id)    ON DELETE CASCADE,
  work_package_id uuid             NOT NULL REFERENCES work_package(id) ON DELETE CASCADE,
  title           text             NOT NULL CHECK (length(trim(title)) > 0),
  notes           text,
  estimate_hours  numeric(4,2)     CHECK (estimate_hours > 0),
  difficulty      difficulty_level,
  is_time_fixed   boolean          NOT NULL DEFAULT false,
  fixed_date      date,
  status          task_status      NOT NULL DEFAULT 'todo',
  completed_at    timestamptz,
  position        integer          NOT NULL DEFAULT 0,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT task_estimate_xor
    CHECK (num_nonnulls(estimate_hours, difficulty) <= 1),
  CONSTRAINT task_time_fixed_pairing
    CHECK (is_time_fixed = (fixed_date IS NOT NULL)),
  -- done iff completed_at set. `blocked` is derived, never stored (§6).
  CONSTRAINT task_status_completed_pairing
    CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX task_work_package_idx ON task (work_package_id);
-- Planner candidate scans.
CREATE INDEX task_todo_idx ON task (workspace_id) WHERE status = 'todo';

-- ----------------------------------------------------------------------------
-- §4.3  Dependencies (two levels, self-referencing, acyclic — acyclicity is
-- enforced in the API dependency module, not by a trigger).
-- ----------------------------------------------------------------------------

CREATE TABLE task_dependency (
  predecessor_task_id uuid        NOT NULL REFERENCES task(id)      ON DELETE CASCADE,
  successor_task_id   uuid        NOT NULL REFERENCES task(id)      ON DELETE CASCADE,
  workspace_id        uuid        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (predecessor_task_id, successor_task_id),
  CONSTRAINT task_dependency_no_self CHECK (predecessor_task_id <> successor_task_id)
);
-- Reverse traversal: "what blocks me?"
CREATE INDEX task_dependency_successor_idx ON task_dependency (successor_task_id);

CREATE TABLE work_package_dependency (
  predecessor_wp_id uuid        NOT NULL REFERENCES work_package(id) ON DELETE CASCADE,
  successor_wp_id   uuid        NOT NULL REFERENCES work_package(id) ON DELETE CASCADE,
  workspace_id      uuid        NOT NULL REFERENCES workspace(id)    ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (predecessor_wp_id, successor_wp_id),
  CONSTRAINT wp_dependency_no_self CHECK (predecessor_wp_id <> successor_wp_id)
);
CREATE INDEX wp_dependency_successor_idx ON work_package_dependency (successor_wp_id);

-- ----------------------------------------------------------------------------
-- §4.4  Planning, Roadmap & Daily Goals
-- ----------------------------------------------------------------------------

CREATE TABLE daily_plan_day (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- Interpreted in the user's timezone (midnight-local boundary, Decision #14).
  plan_date    date        NOT NULL,
  status       day_status  NOT NULL DEFAULT 'proposed',
  is_locked    boolean     NOT NULL DEFAULT false,
  -- confirmed_at / completed_at consistency with status is maintained by the API
  -- (a slipped day may never have been confirmed) — intentionally not a CHECK.
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- One day-step per calendar day per workspace.
  UNIQUE (workspace_id, plan_date)
);
CREATE INDEX daily_plan_day_workspace_status_idx ON daily_plan_day (workspace_id, status);

CREATE TABLE daily_plan_item (
  id                uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid             NOT NULL REFERENCES workspace(id)      ON DELETE CASCADE,
  daily_plan_day_id uuid             NOT NULL REFERENCES daily_plan_day(id) ON DELETE CASCADE,
  -- Extension seam for the Content Inbox (§7): future 'inbox_triage' items get
  -- their own nullable FK column guarded by a type-matching CHECK.
  item_type         plan_item_type   NOT NULL DEFAULT 'task',
  task_id           uuid             REFERENCES task(id) ON DELETE CASCADE,
  status            plan_item_status NOT NULL DEFAULT 'planned',
  origin            plan_item_origin NOT NULL DEFAULT 'proposed',
  position          integer          NOT NULL DEFAULT 0,
  created_at        timestamptz      NOT NULL DEFAULT now(),
  updated_at        timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT daily_plan_item_task_type_pairing
    CHECK ((item_type = 'task') = (task_id IS NOT NULL)),
  -- A task appears at most once per day.
  UNIQUE (daily_plan_day_id, task_id)
);
-- A task can be ACTIVELY PLANNED on only one day at a time. Pulling forward
-- moves the planned item (old → deferred/deleted, new → 'pulled_forward').
CREATE UNIQUE INDEX daily_plan_item_one_planned_per_task
  ON daily_plan_item (task_id) WHERE status = 'planned';
CREATE INDEX daily_plan_item_day_idx ON daily_plan_item (daily_plan_day_id);

-- ----------------------------------------------------------------------------
-- §4.5  Replanning Pipeline (human in the loop)
-- ----------------------------------------------------------------------------

CREATE TABLE replan_proposal (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid            NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- "trigger" is a reserved word in SQL — must stay quoted in raw DDL.
  "trigger"           proposal_trigger NOT NULL,
  status              proposal_status  NOT NULL DEFAULT 'pending',
  summary             text            NOT NULL,
  changes             jsonb           NOT NULL,
  applied_changes     jsonb,
  resolved_by_user_id uuid            REFERENCES app_user(id) ON DELETE SET NULL,
  resolved_at         timestamptz,
  created_at          timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT replan_proposal_resolved_pairing
    CHECK ((status <> 'pending') = (resolved_at IS NOT NULL))
);
-- "anything awaiting approval?"
CREATE INDEX replan_proposal_pending_idx ON replan_proposal (workspace_id) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- §4.6  Motivation Layer — Points, Streak, Stats
-- ----------------------------------------------------------------------------

CREATE TABLE point_rule (
  event_type point_event_type PRIMARY KEY,
  points     integer          NOT NULL CHECK (points > 0)
);

CREATE TABLE point_event (
  id                uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid             NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id           uuid             NOT NULL REFERENCES app_user(id)  ON DELETE CASCADE,
  -- Rules are seed data → default NO ACTION (RESTRICT-like) on the rule FK.
  event_type        point_event_type NOT NULL REFERENCES point_rule(event_type),
  -- Copied from point_rule at award time so history survives later tuning.
  points            integer          NOT NULL,
  task_id           uuid             REFERENCES task(id)           ON DELETE SET NULL,
  daily_plan_day_id uuid             REFERENCES daily_plan_day(id) ON DELETE SET NULL,
  milestone_id      uuid             REFERENCES milestone(id)      ON DELETE SET NULL,
  occurred_at       timestamptz      NOT NULL DEFAULT now(),
  -- At most one source. The data-model states "exactly one (= 1)" AND "sources
  -- SET NULL so ledger history survives deletion". Those conflict on delete: a
  -- strict "= 1" would make SET NULL violate the CHECK and block deleting a
  -- scored task/day/milestone (which DELETE /tasks/{id} relies on). We resolve
  -- in favour of the thrice-stated "ledger survives": at most one source, and a
  -- type↔source FAMILY agreement (a task_completed row may only ever carry a
  -- task_id, never a milestone_id) — preserving the real work of the original
  -- agreement CHECK while tolerating an all-null orphan after source deletion.
  CONSTRAINT point_event_one_source
    CHECK (num_nonnulls(task_id, daily_plan_day_id, milestone_id) <= 1),
  CONSTRAINT point_event_type_source_agreement CHECK (
       (event_type = 'task_completed'       AND daily_plan_day_id IS NULL AND milestone_id IS NULL)
    OR (event_type = 'daily_goal_completed' AND task_id IS NULL           AND milestone_id IS NULL)
    OR (event_type = 'milestone_achieved'   AND task_id IS NULL           AND daily_plan_day_id IS NULL)
  )
);
-- Double-award prevention: each source scores exactly once, EVER. Un-completing
-- and re-completing a task can never farm points (§4.6, invariant #8). These
-- partial uniques are the database half of the belt-and-suspenders guard.
CREATE UNIQUE INDEX point_event_task_once      ON point_event (task_id)           WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX point_event_day_once       ON point_event (daily_plan_day_id) WHERE daily_plan_day_id IS NOT NULL;
CREATE UNIQUE INDEX point_event_milestone_once ON point_event (milestone_id)      WHERE milestone_id IS NOT NULL;
CREATE INDEX point_event_history_idx ON point_event (workspace_id, occurred_at);

CREATE TABLE engagement_day (
  user_id          uuid        NOT NULL REFERENCES app_user(id)  ON DELETE CASCADE,
  -- Local date (computed by the API from app_user.timezone, Decision #14).
  activity_date    date        NOT NULL,
  workspace_id     uuid        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  first_engaged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity_date)
);

CREATE TABLE user_stats (
  user_id           uuid        PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  workspace_id      uuid        NOT NULL REFERENCES workspace(id)   ON DELETE CASCADE,
  total_points      integer     NOT NULL DEFAULT 0 CHECK (total_points  >= 0),
  current_streak    integer     NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  -- longest >= current is intentionally NOT enforced (allows rebuild ordering).
  longest_streak    integer     NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_engaged_date date,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_preference (
  user_id                  uuid        PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  morning_brief_enabled    boolean     NOT NULL DEFAULT true,
  morning_brief_time       time        NOT NULL DEFAULT '07:00',
  milestone_nudges_enabled boolean     NOT NULL DEFAULT true,
  replan_nudges_enabled    boolean     NOT NULL DEFAULT true,
  streak_nudges_enabled    boolean     NOT NULL DEFAULT true,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
