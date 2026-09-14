/**
 * 云端行隔离用的 workspace id（与 scripts/supabase-rls-harden.sql 对齐）。
 * 未配置时仍为 default，保证现有环境不停用。
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
