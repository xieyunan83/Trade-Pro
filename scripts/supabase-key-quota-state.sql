-- 可选：跨客户端共享「本月额度耗尽」指纹（不存明文 Key）
-- 在 Supabase SQL Editor 执行。未执行时前端会静默跳过云端同步。

CREATE TABLE IF NOT EXISTS key_quota_state (
  user_id text NOT NULL DEFAULT 'default',
  provider text NOT NULL,
  key_fingerprint text NOT NULL,
  exhausted_month text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, provider, key_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_key_quota_state_user_month
  ON key_quota_state (user_id, exhausted_month);

ALTER TABLE key_quota_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "key_quota_state_all" ON key_quota_state;
CREATE POLICY "key_quota_state_all" ON key_quota_state
  FOR ALL USING (true) WITH CHECK (true);

-- 生产建议改为 workspace 常量策略（与 supabase-rls-harden.sql 同思路）
-- DROP POLICY IF EXISTS "key_quota_state_all" ON key_quota_state;
-- CREATE POLICY "key_quota_state_workspace" ON key_quota_state
--   FOR ALL
--   USING (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID')
--   WITH CHECK (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID');
