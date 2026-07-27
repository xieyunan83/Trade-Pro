-- Trade-Pro Supabase 全量表（在 Supabase Dashboard → SQL Editor 中执行）
-- 含：知识库、API 配置、背调历史、客户搜索、CRM

-- ==================== 知识库 ====================
CREATE TABLE IF NOT EXISTS knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'default',
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  category text DEFAULT 'bin',
  file_url text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_user_created
  ON knowledge_base (user_id, created_at DESC);

-- ==================== API 配置 ====================
CREATE TABLE IF NOT EXISTS api_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'default',
  provider text NOT NULL,
  encrypted_key text NOT NULL DEFAULT '',
  base_url text,
  model_id text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);

-- ==================== 背调历史 ====================
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

-- ==================== 客户搜索记录 ====================
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

-- ==================== CRM 客户 ====================
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

-- ==================== RLS（允许 anon 读写，便于本工具本地开发） ====================
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE investigation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge_base_all" ON knowledge_base;
CREATE POLICY "knowledge_base_all" ON knowledge_base
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "api_configs_all" ON api_configs;
CREATE POLICY "api_configs_all" ON api_configs
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "investigation_history_all" ON investigation_history;
CREATE POLICY "investigation_history_all" ON investigation_history
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "discovery_searches_all" ON discovery_searches;
CREATE POLICY "discovery_searches_all" ON discovery_searches
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "crm_clients_all" ON crm_clients;
CREATE POLICY "crm_clients_all" ON crm_clients
  FOR ALL USING (true) WITH CHECK (true);

-- ==================== 应用用户账号（可选；当前实现复用 api_configs.__app_users__） ====================
-- 手机端与电脑端共用同一套账号密码。若要用独立表，可执行下方 SQL；
-- 现有代码已通过 api_configs 的 provider=__app_users__ 同步，无需必须建表。

