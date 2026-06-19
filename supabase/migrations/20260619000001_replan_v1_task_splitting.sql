-- Replan proposal engine v1: user-level global capacity + task split metadata.

ALTER TABLE user_stats
  ADD COLUMN global_capacity_hours_per_day numeric(4,2) NOT NULL DEFAULT 8
    CHECK (global_capacity_hours_per_day > 0 AND global_capacity_hours_per_day <= 24);

ALTER TABLE task
  ADD COLUMN original_task_id uuid REFERENCES task(id) ON DELETE CASCADE,
  ADD COLUMN split_index integer CHECK (split_index > 0),
  ADD COLUMN split_count integer CHECK (split_count > 0),
  ADD COLUMN is_split_part boolean NOT NULL DEFAULT false,
  ADD COLUMN replaced_at timestamptz,
  ADD CONSTRAINT task_split_metadata_pairing CHECK (
    (
      is_split_part = false
      AND original_task_id IS NULL
      AND split_index IS NULL
      AND split_count IS NULL
    )
    OR
    (
      is_split_part = true
      AND original_task_id IS NOT NULL
      AND original_task_id <> id
      AND split_index IS NOT NULL
      AND split_count IS NOT NULL
      AND split_index <= split_count
    )
  );

CREATE INDEX task_split_parent_idx ON task (original_task_id) WHERE is_split_part;
CREATE INDEX task_todo_active_idx ON task (workspace_id) WHERE status = 'todo' AND replaced_at IS NULL;
