/**
 * 跨客户端共享 Key「本月额度耗尽」状态（仅指纹，无明文）。
 * 表不存在 / 未配置 Supabase 时静默失败，不影响现有功能。
 */
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { getCloudWorkspaceId } from './workspaceId';
import type { ApiKeyPoolProvider } from './apiKeyPool';

const monthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** 稳定短指纹，不落库明文 */
export const fingerprintApiKey = (key: string): string => {
  const s = (key || '').replace(/^Bearer\s+/i, '').replace(/\s+/g, '').trim();
  if (!s) return '';
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 加盐长度片段，降低碰撞误伤
  return `${(h >>> 0).toString(16)}_${s.length}_${s.slice(0, 4)}`;
};

let tableMissing = false;
let lastPullAt = 0;
const PULL_MIN_INTERVAL_MS = 45_000;

export const pushKeyExhaustedCloud = async (
  provider: ApiKeyPoolProvider,
  key: string
): Promise<void> => {
  if (tableMissing || !isSupabaseConfigured()) return;
  const fp = fingerprintApiKey(key);
  if (!fp) return;
  try {
    const { error } = await getSupabaseClient().from('key_quota_state').upsert(
      {
        user_id: getCloudWorkspaceId(),
        provider,
        key_fingerprint: fp,
        exhausted_month: monthKey(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider,key_fingerprint' }
    );
    if (error) {
      if (/key_quota_state|schema cache|does not exist/i.test(error.message || '')) {
        tableMissing = true;
        console.info(
          '[key-quota] 缺少表 key_quota_state，可执行 scripts/supabase-key-quota-state.sql（可选）'
        );
      }
    }
  } catch {
    /* soft */
  }
};

/** 拉取本月已耗尽指纹；调用方与本地 Key 比对 */
export const pullExhaustedFingerprints = async (
  provider: ApiKeyPoolProvider
): Promise<Set<string>> => {
  const empty = new Set<string>();
  if (tableMissing || !isSupabaseConfigured()) return empty;
  const now = Date.now();
  if (now - lastPullAt < PULL_MIN_INTERVAL_MS) return empty;
  lastPullAt = now;
  try {
    const { data, error } = await getSupabaseClient()
      .from('key_quota_state')
      .select('key_fingerprint')
      .eq('user_id', getCloudWorkspaceId())
      .eq('provider', provider)
      .eq('exhausted_month', monthKey());
    if (error) {
      if (/key_quota_state|schema cache|does not exist/i.test(error.message || '')) {
        tableMissing = true;
      }
      return empty;
    }
    return new Set(
      (data || [])
        .map((r: { key_fingerprint?: string }) => String(r.key_fingerprint || ''))
        .filter(Boolean)
    );
  } catch {
    return empty;
  }
};
