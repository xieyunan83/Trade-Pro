/**
 * 云端行隔离用的 workspace id（与 scripts/supabase-rls-harden.sql 对齐）。
 * 未配置时仍为 default，保证现有环境不停用。
 *
 * 多租户建议：
 * - 公司共享 CRM：设 VITE_WORKSPACE_ID 或 trade_scout_workspace_id 为同一长随机串
 * - 按部门隔离：另存 trade_scout_workspace_id = `${base}:${departmentId}`（需同步迁库）
 */
export const getCloudWorkspaceId = (): string => {
  try {
    const fromEnv = String(
      (import.meta as any)?.env?.VITE_WORKSPACE_ID ||
        process.env.VITE_WORKSPACE_ID ||
        ''
    ).trim();
    if (fromEnv) return fromEnv;
    const fromLs = (localStorage.getItem('trade_scout_workspace_id') || '').trim();
    if (fromLs) return fromLs;
  } catch {
    /* ignore */
  }
  return 'default';
};

export const setCloudWorkspaceIdLocal = (id: string) => {
  localStorage.setItem('trade_scout_workspace_id', id.trim());
};

/** 建议部门级 workspace（不自动切换，避免误拆现有共享库） */
export const suggestDeptWorkspaceId = (departmentId: string, base?: string): string => {
  const root = (base || getCloudWorkspaceId() || 'default').trim() || 'default';
  const dept = (departmentId || '').trim();
  if (!dept) return root;
  if (root.endsWith(`:${dept}`)) return root;
  return `${root}:${dept}`;
};
