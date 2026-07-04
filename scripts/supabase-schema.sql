-- Trade-Pro Supabase 扩展表（在 Supabase Dashboard → SQL Editor 中执行）
-- 背调历史、客户搜索、CRM 云端持久化

-- 背调历史
CREATE TABLE IF NOT EXISTS investigation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'default',
  local_id text NOT NULL,
  domain text,
  module_type text,
  report_data jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_investigation_history_user_created
  ON investigation_history (user_id, created_at DESC);

-- 客户搜索记录
CREATE TABLE IF NOT EXISTS discovery_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'default',
  product text DEFAULT '',
  country text DEFAULT '',
  industry text DEFAULT '',
  client_type text DEFAULT '',
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  has_searched boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_searches_user_created
  ON discovery_searches (user_id, created_at DESC);

-- CRM 客户（完整 Client JSON）
CREATE TABLE IF NOT EXISTS crm_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'default',
  local_id text NOT NULL,
  client_data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_clients_user_updated
  ON crm_clients (user_id, updated_at DESC);

-- RLS（与 knowledge_base / api_configs 一致：允许 anon 读写 default 用户数据）
ALTER TABLE investigation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investigation_history_all" ON investigation_history;
CREATE POLICY "investigation_history_all" ON investigation_history
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "discovery_searches_all" ON discovery_searches;
CREATE POLICY "discovery_searches_all" ON discovery_searches
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "crm_clients_all" ON crm_clients;
CREATE POLICY "crm_clients_all" ON crm_clients
  FOR ALL USING (true) WITH CHECK (true);
