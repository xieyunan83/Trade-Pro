/**
 * 着陆页客户端：拉取聚合接口并短缓存
 */
import { loadDataProvider } from './dataProviders';
import type { LandingPayload } from './landingDataCore';

const CACHE_KEY = 'trade_scout_landing_hub_v1';
const CACHE_TTL_MS = 3 * 60 * 1000;

export type { LandingPayload };

export const loadLandingCache = (): LandingPayload | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LandingPayload & { _cachedAt?: number };
    if (!parsed?.fetchedAt) return null;
    if (Date.now() - (parsed._cachedAt || parsed.fetchedAt) > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const saveLandingCache = (payload: LandingPayload) => {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...payload, _cachedAt: Date.now() })
    );
  } catch {
    /* ignore */
  }
};

/** 行业源令牌：优先 toysbear.apiKey，其次 skybird.apiKey */
export const resolveIndustryToken = async (): Promise<string> => {
  try {
    const a = await loadDataProvider('toysbear');
    if (a.enabled && (a.apiKey || '').trim()) return a.apiKey!.trim();
    const b = await loadDataProvider('skybird');
    if (b.enabled && (b.apiKey || '').trim()) return b.apiKey!.trim();
  } catch {
    /* ignore */
  }
  return '';
};

export const fetchLandingHub = async (opts?: {
  force?: boolean;
}): Promise<LandingPayload> => {
  if (!opts?.force) {
    const cached = loadLandingCache();
    if (cached) return cached;
  }
  const token = await resolveIndustryToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['x-industry-token'] = token;
  const res = await fetch('/api/landing', { headers });
  if (!res.ok) {
    throw new Error(`着陆页数据 ${res.status}`);
  }
  const data = (await res.json()) as LandingPayload;
  if (data?.ok !== false) saveLandingCache(data);
  return data;
};
