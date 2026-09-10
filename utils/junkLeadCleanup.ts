/**
 * 清理与玩具主业明显不符的客户/背调（IT 咨询、快递、食品等跨品类噪音）。
 */
import type { Client, DiscoveryArchiveItem, HistoryItem } from '../types';

const TOY_SIGNAL =
  /玩具|汽车玩具|泡泡|儿童玩具|儿童用品|益智|拼图|毛绒|派对礼品|\btoys?\b|car\s*toy|kids\s*toy|children'?s\s*product|plush|lego|puzzle|party\s*favor|novelty\s*toy|playset/i;

const TOY_KEYWORD =
  /bubble|wand|泡泡|玩具|toy|doll|plush|lego|puzzle|kids|children|party.?favor|novelty|car\s*toy|汽车玩具|儿童/i;

/** 文案已写明不匹配 / 跨品类 */
const EXPLICIT_MISMATCH =
  /跨品类|搜索误差|完全不匹配|无关品类|完全不采购|重新筛选|与.{0,16}无关|不属于.{0,10}品类|不采购.{0,12}(玩具|car\s*toy|汽车玩具)|建议.{0,12}重新筛选|澄清产品匹配度/i;

/**
 * 明显非玩具主业（且无玩具信号时视为垃圾）。
 * 用较具体的词，避免误伤「有物流能力的玩具进口商」。
 */
const NON_TOY_INDUSTRY =
  /IT\s*咨询|信息技术咨询|软件咨询|系统集成公司|数字化转型咨询|IT\s*consulting|software\s*consulting|saas\s*consult|快递服务|快递公司|速递公司|courier\s*service|parcel\s*(delivery|service)|快递专营|食品生产商|食品制造商|食品加工厂|食品超市|精品食品|高端食品|纯食品|食品零售商|food\s*manufacturer|food\s*producer|specialty\s*food|gourmet\s*food|supermarket|银行|保险公司|证券公司|律师事务所|会计师事务所|房地产中介|石油化工|水泥贸易|钢材贸易/i;

export const isToyRelatedKeyword = (keyword?: string): boolean =>
  !!keyword && TOY_KEYWORD.test(keyword);

export const blobHasToySignal = (blob: string): boolean => TOY_SIGNAL.test(blob || '');

/** 汇总文本是否应作为跨品类垃圾清理 */
export const isNonToyJunkBlob = (blob: string, searchKeyword?: string): boolean => {
  const text = (blob || '').trim();
  if (!text) return false;
  if (EXPLICIT_MISMATCH.test(text)) return true;

  const kw = (searchKeyword || '').trim();
  const toyKw = !kw || isToyRelatedKeyword(kw);
  const hasToy = blobHasToySignal(text) || (kw ? blobHasToySignal(kw) : false);

  if (hasToy) return false;

  // 玩具关键词（或未填关键词）场景下，命中非玩具行业 → 清理
  if (toyKw && NON_TOY_INDUSTRY.test(text)) return true;

  // 玩具关键词下的食品/杂货硬冲突
  if (
    isToyRelatedKeyword(kw) &&
    /食品超市|精品食品|高端食品|生鲜|肉类|海鲜|奶酪|烘焙|餐饮服务|grocery|supermarket|gourmet|seafood|butcher|bakery|cfia|食品零售|纯食品/i.test(
      text
    )
  ) {
    return true;
  }

  return false;
};

export const historyItemJunkBlob = (h: HistoryItem): string => {
  const d = h.data;
  const actionPlan = Array.isArray(d?.strategy?.actionPlan) ? d.strategy.actionPlan.join(' ') : '';
  const parts = [
    h.keyword,
    h.domain,
    d?.searchKeyword,
    d?.companyInfo?.name,
    d?.companyInfo?.nature,
    d?.companyInfo?.description,
    d?.businessScope?.coreProducts?.join(' '),
    d?.businessScope?.brandPositioning,
    d?.businessScope?.relevantProducts?.join(' '),
    actionPlan,
    d?.productSummary,
    d?.tradeIntelligence?.customsSummary,
  ];
  return parts.filter(Boolean).join(' · ');
};

export const isJunkHistoryItem = (h: HistoryItem): boolean => {
  const kw = h.keyword || h.data?.searchKeyword || '';
  return isNonToyJunkBlob(historyItemJunkBlob(h), kw);
};

export const clientJunkBlob = (c: Client): string =>
  [
    c.name,
    c.website,
    c.industry,
    c.productType,
    c.type,
    c.searchKeyword,
    ...(c.searchedKeywords || []),
    ...(c.tags || []),
    c.activityLog,
  ]
    .filter(Boolean)
    .join(' · ');

export const isJunkCrmClient = (c: Client): boolean => {
  const kw = c.searchKeyword || (c.searchedKeywords || [])[0] || '';
  return isNonToyJunkBlob(clientJunkBlob(c), kw);
};

export const discoveryResultJunkBlob = (r: {
  name?: string;
  mainProducts?: string;
  description?: string;
  fitReason?: string;
  searchKeyword?: string;
}): string =>
  [r.name, r.mainProducts, r.description, r.fitReason, r.searchKeyword].filter(Boolean).join(' · ');

export const isJunkDiscoveryResult = (r: {
  name?: string;
  mainProducts?: string;
  description?: string;
  fitReason?: string;
  searchKeyword?: string;
}): boolean => isNonToyJunkBlob(discoveryResultJunkBlob(r), r.searchKeyword);

export type JunkCleanupPlan = {
  historyIds: string[];
  crmIds: string[];
  discoveryIds: string[];
  /** 搜索归档内仅剔除部分结果时：id → 保留的 results */
  discoveryPatches: { id: string; results: DiscoveryArchiveItem['results'] }[];
};

export const buildJunkCleanupPlan = (
  history: HistoryItem[],
  crmClients: Client[],
  discoveryArchives: DiscoveryArchiveItem[]
): JunkCleanupPlan => {
  const historyIds = history.filter(isJunkHistoryItem).map((h) => h.id);
  const junkHistory = new Set(historyIds);
  const crmIds = new Set(crmClients.filter(isJunkCrmClient).map((c) => c.id));

  // 背调垃圾对应的 CRM（按域名/名称）也删
  const normHost = (url?: string) =>
    (url || '')
      .toLowerCase()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
      .split('/')[0]
      .trim();
  for (const h of history) {
    if (!junkHistory.has(h.id)) continue;
    const host = normHost(h.domain || h.data?.companyInfo?.website);
    const name = (h.data?.companyInfo?.name || '').trim().toLowerCase();
    for (const c of crmClients) {
      if (host && normHost(c.website) === host) crmIds.add(c.id);
      if (name && (c.name || '').trim().toLowerCase() === name) crmIds.add(c.id);
    }
  }

  const discoveryIds: string[] = [];
  const discoveryPatches: JunkCleanupPlan['discoveryPatches'] = [];
  for (const arch of discoveryArchives) {
    const results = arch.results || [];
    if (!results.length) continue;
    const kept = results.filter((r) => !isJunkDiscoveryResult(r));
    if (kept.length === 0) {
      discoveryIds.push(arch.id);
    } else if (kept.length < results.length) {
      discoveryPatches.push({ id: arch.id, results: kept });
    }
  }

  return {
    historyIds,
    crmIds: [...crmIds],
    discoveryIds,
    discoveryPatches,
  };
};

export const junkCleanupPlanCount = (plan: JunkCleanupPlan): number =>
  plan.historyIds.length +
  plan.crmIds.length +
  plan.discoveryIds.length +
  plan.discoveryPatches.length;

const PURGE_FLAG_KEY = 'trade_scout_nontøy_junk_purge_v2';

export const hasAutoPurgedNonToyJunk = (): boolean => {
  try {
    return localStorage.getItem(PURGE_FLAG_KEY) === '1';
  } catch {
    return false;
  }
};

export const markAutoPurgedNonToyJunk = (): void => {
  try {
    localStorage.setItem(PURGE_FLAG_KEY, '1');
  } catch {
    /* ignore */
  }
};

/** 允许用户再次强制清理 */
export const clearAutoPurgeNonToyJunkFlag = (): void => {
  try {
    localStorage.removeItem(PURGE_FLAG_KEY);
  } catch {
    /* ignore */
  }
};
