/**
 * 商机证据层 · 本地缓存与数据商占位。
 * 接通「线上货架 / 海关」后：查询 → 缓存 → 拼 MarketEvidenceBundle → 支撑生产/销售建议。
 */
import { loadCustomsCache, searchCustomsCache } from './customsTypes';
import { loadDataProviderLocal } from './dataProviders';
import type {
  ImportBehaviorSignal,
  MarketEvidenceBundle,
  MarketEvidenceProviderResult,
  MarketEvidenceQuery,
  MarketplaceCategorySignal,
} from './marketEvidenceTypes';

const LS_ONLINE = 'trade_scout_marketplace_signal_cache_v1';
const LS_BUNDLES = 'trade_scout_market_evidence_bundles_v1';

const readJson = <T>(key: string, fallback: T): T => {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[marketEvidence] persist failed', e);
  }
};

export const loadMarketplaceSignalCache = (): MarketplaceCategorySignal[] =>
  readJson(LS_ONLINE, []);

export const saveMarketplaceSignalCache = (rows: MarketplaceCategorySignal[]) => {
  writeJson(LS_ONLINE, rows.slice(0, 3000));
};

export const loadMarketEvidenceBundles = (): MarketEvidenceBundle[] =>
  readJson(LS_BUNDLES, []);

export const saveMarketEvidenceBundles = (rows: MarketEvidenceBundle[]) => {
  writeJson(LS_BUNDLES, rows.slice(0, 1000));
};

/** 从本地海关缓存合成「进口行为」弱信号（无外采时也能演示结构） */
export const importSignalsFromCustomsCache = (query: string): ImportBehaviorSignal[] => {
  const hits = searchCustomsCache(query, loadCustomsCache());
  if (!hits.length) return [];
  const byCompany = new Map<string, typeof hits>();
  for (const h of hits) {
    const name = (h.linkedCompanyName || h.consignee || h.shipper || '').trim();
    if (!name) continue;
    const list = byCompany.get(name) || [];
    list.push(h);
    byCompany.set(name, list);
  }
  const now = Date.now();
  return [...byCompany.entries()].slice(0, 40).map(([companyName, rows], i) => {
    const hs = [...new Set(rows.map((r) => r.hsCode).filter(Boolean) as string[])];
    const origins = [...new Set(rows.map((r) => r.originCountry).filter(Boolean) as string[])];
    const products = [...new Set(rows.map((r) => r.productDesc).filter(Boolean) as string[])].slice(
      0,
      8
    );
    return {
      id: `imp_local_${i}_${companyName.slice(0, 24)}`,
      companyName,
      hsCodes: hs,
      productHints: products,
      shipmentCount: rows.length,
      topOrigins: origins,
      lastShipmentAt: rows.map((r) => r.date).filter(Boolean).sort().slice(-1)[0],
      evidenceTier: 'B' as const,
      sourceNote: '本地海关缓存聚合（待接通数据商后升级为 A 级）',
      customsRowIds: rows.map((r) => r.id),
      createdAt: now,
    };
  });
};

/**
 * 线上货架 / 品类趋势查询占位。
 * 启用 marketplace_intel 并配置 Key 后在此对接真实 API。
 */
export const queryMarketplaceProvider = async (
  q: MarketEvidenceQuery
): Promise<MarketEvidenceProviderResult> => {
  const meta = loadDataProviderLocal('marketplace_intel');
  const keyword = (q.keyword || q.companyName || '').trim();

  const localOnline = loadMarketplaceSignalCache().filter((r) => {
    if (!keyword) return true;
    const blob = [r.categoryPath, r.keyword, r.country, r.platform].join(' ').toLowerCase();
    return blob.includes(keyword.toLowerCase());
  });

  const offlineImport = keyword ? importSignalsFromCustomsCache(keyword) : [];

  if (localOnline.length || offlineImport.length) {
    return {
      ok: true,
      message: `本地命中：线上 ${localOnline.length} · 进口行为 ${offlineImport.length}（未请求外网）`,
      online: localOnline,
      offlineImport,
    };
  }

  if (!meta.enabled || !meta.apiKey) {
    return {
      ok: false,
      message:
        '商机证据源尚未接通。请在「数据接入 → 线上货架情报」启用并配置后查询；亦可先导入海关缓存做线下侧演示。',
      online: [],
      offlineImport: [],
    };
  }

  // 预留：按 meta.apiBase / extra.platform 拉取 Amazon / TikTok / Walmart 类目趋势
  return {
    ok: false,
    message:
      '线上货架 API 适配层待实现。配置已保存，接通数据商后可返回品类价带 / 需求热度并与海关行为对齐。',
    online: [],
    offlineImport: [],
  };
};

/** 拼一条证据包草稿（对齐状态默认 unlinked） */
export const draftEvidenceBundle = (input: {
  title: string;
  online?: MarketplaceCategorySignal[];
  offlineImport?: ImportBehaviorSignal[];
  companyName?: string;
  domain?: string;
  country?: string;
}): MarketEvidenceBundle => {
  const online = input.online || [];
  const offlineImport = input.offlineImport || [];
  const hs = [...new Set(offlineImport.flatMap((o) => o.hsCodes || []))];
  return {
    id: `meb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    joinKeys: {
      companyName: input.companyName || offlineImport[0]?.companyName,
      domain: input.domain || offlineImport[0]?.domain,
      country: input.country || online[0]?.country || offlineImport[0]?.country,
      hsCodes: hs.length ? hs : undefined,
      listingIds: online.flatMap((o) => o.sampleListingIds || []).slice(0, 20),
      channelKind: online.length && offlineImport.length ? 'hybrid' : online.length ? 'online_marketplace' : 'import_trade',
    },
    online: online.length ? online : undefined,
    offlineImport: offlineImport.length ? offlineImport : undefined,
    alignmentStatus: 'unlinked',
    productionHints: [
      '待接入货架价带与评论痛点后，生成包装 / 功能 / 认证生产建议',
    ],
    salesHints: [
      '待对齐进口行为与平台机会后，生成匹配理由与开发话术硬证据',
    ],
    updatedAt: Date.now(),
  };
};

export type MarketEvidenceReadiness = {
  marketplaceConfigured: boolean;
  customsConfigured: boolean;
  onlineCacheCount: number;
  customsCacheCount: number;
  bundleCount: number;
  /** 是否具备「生产/销售建议」硬支撑的最低条件 */
  adviceReady: boolean;
  statusLabel: string;
};

/** 供适市 / 市调 / 匹配读取：有无硬数据可支撑建议 */
export const getMarketEvidenceReadiness = (): MarketEvidenceReadiness => {
  const mp = loadDataProviderLocal('marketplace_intel');
  const customs = loadDataProviderLocal('customs');
  const onlineCacheCount = loadMarketplaceSignalCache().length;
  const customsCacheCount = loadCustomsCache().length;
  const bundleCount = loadMarketEvidenceBundles().length;
  const marketplaceConfigured = !!(mp.enabled && mp.apiKey);
  const customsConfigured = !!(customs.enabled && customs.apiKey);
  const adviceReady =
    onlineCacheCount > 0 || customsCacheCount > 0 || bundleCount > 0;
  let statusLabel = '证据层占位中：建议仍以行业通则 + 背调画像为主';
  if (adviceReady && (marketplaceConfigured || customsConfigured)) {
    statusLabel = '已有本地证据缓存，且至少一侧数据源已启用';
  } else if (adviceReady) {
    statusLabel = '已有本地证据缓存（数据商尚未启用）';
  } else if (marketplaceConfigured || customsConfigured) {
    statusLabel = '数据源已配置，待首次拉取写入缓存';
  }
  return {
    marketplaceConfigured,
    customsConfigured,
    onlineCacheCount,
    customsCacheCount,
    bundleCount,
    adviceReady,
    statusLabel,
  };
};
