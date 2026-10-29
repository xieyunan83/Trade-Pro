/**
 * 着陆页客户端：拉取聚合接口 + stale-while-revalidate 缓存
 */
import type { LandingPayload } from './landingDataCore';

const CACHE_KEY = 'trade_scout_landing_hub_v3';
/** 新鲜期内直接用缓存，不打接口 */
const FRESH_TTL_MS = 5 * 60 * 1000;
/** 过期但仍可立刻展示，后台静默刷新 */
const STALE_TTL_MS = 6 * 60 * 60 * 1000;

export type { LandingPayload };

type CachedPayload = LandingPayload & { _cachedAt?: number };

const readRawCache = (): CachedPayload | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      // 兼容旧键
      const legacy = localStorage.getItem('trade_scout_landing_hub_v1');
      if (!legacy) return null;
      return JSON.parse(legacy) as CachedPayload;
    }
    return JSON.parse(raw) as CachedPayload;
  } catch {
    return null;
  }
};

const cacheAge = (parsed: CachedPayload) =>
  Date.now() - (parsed._cachedAt || parsed.fetchedAt || 0);

/** 新鲜缓存（未过 FRESH_TTL） */
export const loadLandingCache = (): LandingPayload | null => {
  const parsed = readRawCache();
  if (!parsed?.fetchedAt) return null;
  if (cacheAge(parsed) > FRESH_TTL_MS) return null;
  return parsed;
};

/** 含过期缓存，供首屏立刻渲染 */
export const loadLandingCacheAllowStale = (): LandingPayload | null => {
  const parsed = readRawCache();
  if (!parsed?.fetchedAt) return null;
  if (cacheAge(parsed) > STALE_TTL_MS) return null;
  return parsed;
};

/** 无缓存时的瞬时骨架：带图新品先上屏，汇率/新闻后台补齐 */
export const buildLandingSeed = (): LandingPayload => ({
  ok: true,
  fetchedAt: 0,
  fx: {
    quotes: [],
    source: '中国银行外汇牌价',
    note: '买入/卖出为中行现汇价；中间价列为中行折算价。单位：人民币 / 100 外币。仅供参考。',
  },
  news: { items: [] },
  products: { items: [] },
});

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

export const fetchLandingHub = async (opts?: {
  force?: boolean;
}): Promise<LandingPayload> => {
  if (!opts?.force) {
    const fresh = loadLandingCache();
    if (fresh) return fresh;
  }
  // 不阻塞等行业令牌（本地库读取会拖慢首请求）；有令牌时用户可点刷新
  const res = await fetch('/api/landing', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`着陆页数据 ${res.status}`);
  }
  const data = (await res.json()) as LandingPayload;
  if (data?.ok !== false) saveLandingCache(data);
  return data;
};
