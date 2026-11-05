/**
 * 云端行隔离用的 workspace id（与 scripts/supabase-rls-harden.sql 对齐）。
 * 未配置时统一为 default，保证多客户端共用同一公司库。
 *
 * 多租户建议：
 * - 公司共享：设 VITE_WORKSPACE_ID 为同一长随机串（所有客户端同一值）
 * - 勿在单机 localStorage 私自改 trade_scout_workspace_id，否则写入会落到另一分区
 * - 按部门隔离：另需迁库，见 suggestDeptWorkspaceId
 */
export const getCloudWorkspaceId = (): string => {
  try {
    const fromEnv = String(
      (import.meta as any)?.env?.VITE_WORKSPACE_ID ||
        process.env.VITE_WORKSPACE_ID ||
        ''
    ).trim();
    if (fromEnv) return fromEnv;
    // 本机若曾误设隔离 id，强制回退 default，避免两台电脑各写各的库
    const fromLs = (localStorage.getItem('trade_scout_workspace_id') || '').trim();
    if (fromLs && fromLs !== 'default') {
      console.warn(
        '[workspace] 忽略本机 trade_scout_workspace_id=%s，改用 default 共享库',
        fromLs
      );
      try {
        localStorage.setItem('trade_scout_workspace_id', 'default');
      } catch {
        /* ignore */
      }
    }
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
