/**
 * 可选：收紧 Supabase RLS（在 Dashboard → SQL Editor 执行）
 *
 * 说明：
 * - 当前主 schema 为开发便利使用了 USING (true)。
 * - 本脚本在「尚未接入 Supabase Auth」的前提下，用 workspace_id 做弱隔离：
 *   应用写入时把 user_id 设为你的工作区标识（建议随机长串），并仅允许匹配行。
 * - 执行前请先把现有数据的 user_id 统一改成同一 WORKSPACE_ID，并在前端/环境配置相同值。
 * - 若仍需完全开放（仅本地），不要执行本脚本。
 *
 * 更安全的长期方案：启用 Supabase Auth + 按 auth.uid() 策略，密钥只放 Edge Function。
 */

-- 1) 设定工作区 ID（改成你自己的长随机串，并与应用侧保持一致）
-- SELECT set_config('app.workspace_id', 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID', false);

-- 示例：批量迁移现有行（取消注释并替换 ID）
-- UPDATE knowledge_base SET user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID' WHERE user_id = 'default';
-- UPDATE api_configs SET user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID' WHERE user_id = 'default';
-- UPDATE investigation_history SET user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID' WHERE user_id = 'default';
-- UPDATE discovery_searches SET user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID' WHERE user_id = 'default';
-- UPDATE crm_clients SET user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID' WHERE user_id = 'default';
-- UPDATE product_profiles SET user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID' WHERE user_id = 'default';

-- 2) 删除全开放策略
DROP POLICY IF EXISTS "knowledge_base_all" ON knowledge_base;
DROP POLICY IF EXISTS "api_configs_all" ON api_configs;
DROP POLICY IF EXISTS "investigation_history_all" ON investigation_history;
DROP POLICY IF EXISTS "discovery_searches_all" ON discovery_searches;
DROP POLICY IF EXISTS "crm_clients_all" ON crm_clients;
DROP POLICY IF EXISTS "product_profiles_all" ON product_profiles;

-- 3) 仅允许匹配 workspace 的行（通过 PostgREST header 不可靠时，改用固定 workspace 常量）
-- 下面策略用「列值等于固定常量」——请把常量改成你的 WORKSPACE_ID。
-- 注意：SQL 策略里写死常量，比 USING(true) 安全；拿到 anon key 的人仍需猜中 workspace id。

CREATE POLICY "knowledge_base_workspace" ON knowledge_base
  FOR ALL
  USING (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID')
  WITH CHECK (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID');

CREATE POLICY "api_configs_workspace" ON api_configs
  FOR ALL
  USING (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID')
  WITH CHECK (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID');

CREATE POLICY "investigation_history_workspace" ON investigation_history
  FOR ALL
  USING (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID')
  WITH CHECK (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID');

CREATE POLICY "discovery_searches_workspace" ON discovery_searches
  FOR ALL
  USING (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID')
  WITH CHECK (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID');

CREATE POLICY "crm_clients_workspace" ON crm_clients
  FOR ALL
  USING (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID')
  WITH CHECK (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID');

CREATE POLICY "product_profiles_workspace" ON product_profiles
  FOR ALL
  USING (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID')
  WITH CHECK (user_id = 'REPLACE_WITH_LONG_RANDOM_WORKSPACE_ID');

-- 可选：禁止 anon 直接读 api_configs（改由 service_role / Edge Function）
-- REVOKE ALL ON api_configs FROM anon, authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON api_configs TO service_role;
