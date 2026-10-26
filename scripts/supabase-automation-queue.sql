-- 仅补建背调作业云端表（若已执行过旧版 supabase-schema.sql，在 SQL Editor 单独跑本文件即可）
CREATE TABLE IF NOT EXISTS automation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'default',
  local_id text NOT NULL,
  task_data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_automation_queue_user_updated
  ON automation_queue (user_id, updated_at DESC);

ALTER TABLE automation_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_queue_all" ON automation_queue;
CREATE POLICY "automation_queue_all" ON automation_queue
  FOR ALL USING (true) WITH CHECK (true);
