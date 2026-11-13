/**
 * 着陆页客户端：拉取聚合接口 + stale-while-revalidate 缓存
 */
import {
  LANDING_FALLBACK_FX,
  LANDING_FALLBACK_NEWS,
  type LandingPayload,
} from './landingDataCore';

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

const isHollowPayload = (p: LandingPayload | null | undefined) =>
  !p ||
  (!(p.news?.items?.length || 0) && !(p.fx?.quotes?.length || 0) && !(p.products?.items?.length || 0));

/** 新鲜缓存（未过 FRESH_TTL）；空壳缓存不挡刷新 */
export const loadLandingCache = (): LandingPayload | null => {
  const parsed = readRawCache();
  if (!parsed?.fetchedAt) return null;
  if (isHollowPayload(parsed)) return null;
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
  const headers: Record<string, string> = { Accept: 'application/json' };
  // 可选：带上已配置的行业源令牌（失败不影响公开资讯/汇率）
  try {
    const { loadDataProviderLocal } = await import('./dataProviders');
    const tb = loadDataProviderLocal('toysbear');
    const sky = loadDataProviderLocal('skybird');
    const token = (tb.enabled && tb.apiKey?.trim()) || (sky.enabled && sky.apiKey?.trim()) || '';
    if (token) headers['x-industry-token'] = token;
  } catch {
    /* ignore */
  }
  const offlineFallback = (hint: string): LandingPayload => {
    const stale = loadLandingCacheAllowStale();
    if (stale && !isHollowPayload(stale)) return stale;
    return {
      ok: true,
      fetchedAt: Date.now(),
      fx: {
        quotes: LANDING_FALLBACK_FX.slice(),
        source: '参考汇率',
        note: '实时牌价暂不可用，已显示参考价。单位：人民币 / 100 外币。仅供参考。',
        error: hint,
      },
      news: { items: LANDING_FALLBACK_NEWS.slice(), error: hint },
      products: { items: [], needsCredential: false },
    };
  };

  try {
    const res = await fetch('/api/landing', { headers });
    if (!res.ok) {
      return offlineFallback(`着陆页数据 ${res.status}`);
    }
    const data = (await res.json()) as LandingPayload;
    // 接口偶发空壳：补上本机兜底，避免「暂无」
    if (!data.news?.items?.length) {
      data.news = { ...(data.news || {}), items: LANDING_FALLBACK_NEWS.slice() };
    }
    if (!data.fx?.quotes?.length) {
      data.fx = {
        ...(data.fx || { source: '参考汇率', note: '' }),
        quotes: LANDING_FALLBACK_FX.slice(),
        source: data.fx?.source || '参考汇率',
        note:
          data.fx?.note ||
          '实时牌价暂不可用，已显示参考价。单位：人民币 / 100 外币。仅供参考。',
      };
    }
    if (data?.ok !== false && !isHollowPayload(data)) saveLandingCache(data);
    return data;
  } catch (e: any) {
    return offlineFallback(e?.message || String(e) || '网络异常');
  }
};
