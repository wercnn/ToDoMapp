-- ============================================================================
-- Reference data: point_rule values (Decision #11).
-- Stored as data so tuning (foundation §10 open question) is a row update, not a
-- deploy. These are the constants the task-completion cascade reads at award
-- time and copies onto each point_event. Placeholder values — tune in design.
-- ============================================================================

INSERT INTO point_rule (event_type, points) VALUES
  ('task_completed',       10),
  ('daily_goal_completed', 50),
  ('milestone_achieved',  100)
ON CONFLICT (event_type) DO NOTHING;
