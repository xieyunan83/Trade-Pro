/**
 * 从当前浏览器导出桌面客户端安装种子（localStorage 快照）。
 * 仅管理员操作；明文 JSON 勿上传公开仓库。
 */

const PREFIXES = [
  'trade_scout_',
  'trade_pro_',
];

const EXACT_ALLOW = new Set([
  'trade_scout_users',
  'trade_scout_users_updated_at',
  'trade_scout_departments',
  'trade_scout_departments_updated_at',
  'trade_scout_supabase_url',
  'trade_scout_supabase_anon_key',
  'trade_scout_workspace_id',
  'trade_scout_default_ai_model',
  'trade_scout_task_ai_models',
  'trade_scout_task_ai_models_ts',
  'trade_scout_api_configs',
  'trade_scout_force_qwen',
  'trade_scout_custom_proxy',
]);

export type DesktopSeedExport = {
  version: 1;
  createdAt: number;
  note: string;
  localStorage: Record<string, string>;
};

const shouldExportKey = (key: string): boolean => {
  if (EXACT_ALLOW.has(key)) return true;
  if (PREFIXES.some((p) => key.startsWith(p))) {
    // 排除体积过大 / 与设备绑定相关的本机指纹（换电脑应重新绑定）
    if (key.includes('device_secret') || key.includes('local_mac')) return false;
    if (key.includes('dm_results') || key.includes('discovery')) return false;
    if (key.endsWith('_jobs_v1') || key.includes('poster_')) return false;
    return true;
  }
  return false;
};

/** 采集账号、部门、API Key 池等，供打进桌面安装包 */
export const collectDesktopSeedFromLocalStorage = (): DesktopSeedExport => {
  const localStorageMap: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !shouldExportKey(key)) continue;
    const val = localStorage.getItem(key);
    if (val == null || val === '') continue;
    localStorageMap[key] = val;
  }
  return {
    version: 1,
    createdAt: Date.now(),
    note: 'BabyWorld desktop seed — keep private',
    localStorage: localStorageMap,
  };
};

export const downloadDesktopSeedJson = (filename = 'seed.private.json') => {
  const payload = collectDesktopSeedFromLocalStorage();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return payload;
};
