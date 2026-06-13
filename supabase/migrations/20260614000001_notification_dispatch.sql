-- Phase 5 — Notifications & background jobs.
--
-- The idempotency ledger for outbound notifications. Serverless crons fire late,
-- twice, or skip ticks (api-endpoints.md §13); this table is the "send once ever"
-- backstop, the same partial-unique discipline the point ledger uses for scoring.
--
-- A row records that we have DECIDED to send a given notification to a user. The
-- job claims a row (INSERT … ON CONFLICT DO NOTHING) and only sends on a winning
-- insert, so a re-run can never double-fire.
--
-- `dedupe_key` granularity is per-kind, carrying the TRIGGERING ENTITY so we
-- neither over- nor under-notify:
--   morning_brief         → local date          (one wake-up per local day)
--   milestone_approaching → milestone_id         (once per milestone, ever)
--   replan_needs_review   → replan_proposal id   (once per pending proposal)
--   streak_at_risk        → local date          (at most one per local day)
--
-- User-scoped (like `device` / `notification_preference`); the user FK cascade
-- cleans it up. No workspace_id — notifications are addressed to a person.

CREATE TABLE notification_dispatch (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN (
                           'morning_brief',
                           'milestone_approaching',
                           'replan_needs_review',
                           'streak_at_risk')),
  dedupe_key text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_dispatch_once UNIQUE (user_id, kind, dedupe_key)
);
