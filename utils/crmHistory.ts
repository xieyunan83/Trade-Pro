import { AnalysisResult, Client, ClientSearchResult, HistoryItem } from '../types';
import { hasRichProductCatalog } from '../services/productCatalog';
import {
  assignCategoriesFromSignals,
  idsFromAssignments,
} from '../services/categoryTaxonomy';

const isWeakProductType = (s?: string) =>
  !s ||
  !String(s).trim() ||
  /^(n\/?a|公开信息未找到|未知|待补充|global|-)$/i.test(String(s).trim());

/** 同客户多条背调时：优先已采品类的报告，再比时间 */
const preferHistoryItem = (a: HistoryItem, b: HistoryItem): HistoryItem => {
  const aRich = hasRichProductCatalog(a.data);
  const bRich = hasRichProductCatalog(b.data);
  if (aRich !== bRich) return aRich ? a : b;
  const aProd = (a.data?.products?.length || 0) + (a.data?.websiteCategories?.length || 0);
  const bProd = (b.data?.products?.length || 0) + (b.data?.websiteCategories?.length || 0);
  if (aProd !== bProd) return aProd > bProd ? a : b;
  return (a.timestamp || 0) >= (b.timestamp || 0) ? a : b;
};

/** Normalize website / domain for CRM ↔ history matching */
export const normalizeCrmHost = (url?: string | null): string =>
  (url || '')
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();

/** 弱名称禁止裸匹配，避免「公开信息未找到」等把不同公司误判为同一家 */
export const isWeakCrmMatchName = (nameKey: string) =>
  !nameKey ||
  nameKey.length < 3 ||
  /^(公开信息未找到|未知|不详|n\/?a|unknown|not found|unnamed|—|-)$/i.test(nameKey);

/**
 * 官网优先；无官网时仅用非弱名称精确匹配。
 * 营销工具「是否已入 CRM」与导入去重必须共用此规则。
 */
export const findCrmClientIndex = (
  clients: Client[],
  website?: string | null,
  name?: string | null
): number => {
  if (!clients?.length) return -1;
  const host = normalizeCrmHost(website);
  const nameKey = (name || '').trim().toLowerCase();
  if (host) {
    const byHost = clients.findIndex((c) => {
      const cHost = normalizeCrmHost(c.website);
      return !!(cHost && host === cHost);
    });
    if (byHost >= 0) return byHost;
  }
  if (isWeakCrmMatchName(nameKey)) return -1;
  return clients.findIndex((c) => (c.name || '').trim().toLowerCase() === nameKey);
};

/** O(1) 查找用：营销列表等大批量合并时避免对 CRM 线性扫 */
export type CrmLookupIndex = {
  byHost: Map<string, number>;
  byName: Map<string, number>;
  clients: Client[];
};

export const buildCrmLookupIndex = (clients: Client[]): CrmLookupIndex => {
  const byHost = new Map<string, number>();
  const byName = new Map<string, number>();
  for (let i = 0; i < (clients?.length || 0); i++) {
    const c = clients[i];
    const host = normalizeCrmHost(c.website);
    if (host && !byHost.has(host)) byHost.set(host, i);
    const nk = (c.name || '').trim().toLowerCase();
    if (!isWeakCrmMatchName(nk) && !byName.has(nk)) byName.set(nk, i);
  }
  return { byHost, byName, clients: clients || [] };
};

export const findCrmClientIndexFast = (
  index: CrmLookupIndex,
  website?: string | null,
  name?: string | null
): number => {
  const host = normalizeCrmHost(website);
  if (host && index.byHost.has(host)) return index.byHost.get(host)!;
  const nameKey = (name || '').trim().toLowerCase();
  if (!isWeakCrmMatchName(nameKey) && index.byName.has(nameKey)) {
    return index.byName.get(nameKey)!;
  }
  return -1;
};

const findClientIndex = findCrmClientIndex;

const mapDiscoveryType = (t?: string): Client['type'] => {
  const s = (t || '').toLowerCase();
  if (s.includes('retail')) return '零售商';
  if (s.includes('wholesale')) return '批发商';
  if (s.includes('distribut')) return '分销商';
  return '进口商';
};

/** Build CRM patch fields from a completed background-check report */
export const clientPatchFromAnalysis = (
  data: AnalysisResult | undefined,
  fallbackDomain?: string,
  checkedAt?: number
): Partial<Client> => {
  const website = data?.companyInfo?.website || fallbackDomain || '';
  const kw = (data?.searchKeyword || '').trim();
  const tagKws = (data?.searchTags || [])
    .filter((t) => typeof t === 'string' && t.startsWith('关键词:'))
    .map((t) => t.replace(/^关键词:/, '').trim())
    .filter(Boolean);
  const searchedKeywords = [...new Set([kw, ...tagKws].filter(Boolean))];
  const packFromProducts = (data?.products || [])
    .map((p) => (p.packaging || '').trim())
    .filter((s) => s && !/公开信息未找到|^n\/?a$/i.test(s))
    .slice(0, 3)
    .map((s) => `包装:${s.slice(0, 24)}`);
  const colorFromProducts = (data?.products || [])
    .map((p) => (p.colors || '').trim())
    .filter((s) => s && !/公开信息未找到|^n\/?a$/i.test(s))
    .slice(0, 3)
    .map((s) => `配色:${s.slice(0, 24)}`);
  const sellFromProducts = (data?.products || [])
    .filter((p) => p.role !== 'procure')
    .map((p) => (p.category || p.name || '').trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((c) => `在售:${c.slice(0, 28)}`);
  const procureFromProducts = (data?.products || [])
    .filter((p) => p.role === 'procure' || p.role === 'both')
    .map((p) => (p.category || p.name || '').trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((c) => `采购:${c.slice(0, 28)}`);

  const sellSignals = [
    ...(data?.productIntel?.sell?.categories || []),
    ...(data?.businessScope?.coreProducts || []),
    ...(data?.websiteCategories || []).map((w) => w.categoryName),
    ...(data?.products || [])
      .filter((p) => p.role !== 'procure')
      .map((p) => p.category || p.name || ''),
  ].filter(Boolean) as string[];
  const procureSignals = [
    ...(data?.productIntel?.procure?.categories || []),
    ...(data?.tradeIntelligence?.importCategories || []),
    ...(data?.products || [])
      .filter((p) => p.role === 'procure' || p.role === 'both')
      .map((p) => p.category || p.name || ''),
  ].filter(Boolean) as string[];

  const sellIdsFromProducts = (data?.products || [])
    .filter((p) => p.role !== 'procure')
    .flatMap((p) => [p.taxonomyL1Id, p.taxonomyL2Id].filter(Boolean) as string[]);
  const procureIdsFromProducts = (data?.products || [])
    .filter((p) => p.role === 'procure' || p.role === 'both')
    .flatMap((p) => [p.taxonomyL1Id, p.taxonomyL2Id].filter(Boolean) as string[]);
  const sellIdsFromWc = (data?.websiteCategories || []).flatMap(
    (w) => [w.taxonomyL1Id, w.taxonomyL2Id].filter(Boolean) as string[]
  );

  const sellCategoryIds = [
    ...new Set([
      ...sellIdsFromProducts,
      ...sellIdsFromWc,
      ...idsFromAssignments(assignCategoriesFromSignals(sellSignals, { limit: 8, minScore: 20 })),
    ]),
  ].slice(0, 24);
  const procureCategoryIds = [
    ...new Set([
      ...procureIdsFromProducts,
      ...idsFromAssignments(assignCategoriesFromSignals(procureSignals, { limit: 8, minScore: 20 })),
    ]),
  ].slice(0, 24);

  const productTags = [
    ...(data?.productIntel?.matchTags || []),
    ...(data?.productIntel?.sell?.tags || []),
    ...(data?.productIntel?.procure?.tags || []),
    ...(data?.productIntel?.sell?.categories || []).slice(0, 4).map((c) => `在售:${c}`),
    ...(data?.productIntel?.procure?.categories || []).slice(0, 4).map((c) => `采购:${c}`),
    ...(data?.businessScope?.coreProducts || []).slice(0, 4).map((c) => `在售:${c}`),
    ...(data?.tradeIntelligence?.importCategories || []).slice(0, 4).map((c) => `采购:${c}`),
    ...sellFromProducts,
    ...procureFromProducts,
    ...packFromProducts,
    ...colorFromProducts,
    ...sellCategoryIds.slice(0, 6).map((id) => `类目ID:${id}`),
    ...procureCategoryIds.slice(0, 4).map((id) => `类目ID:${id}`),
    ...(data?.productSummary?.packagingAnalysis
      ? [`包装:${String(data.productSummary.packagingAnalysis).slice(0, 24)}`]
      : []),
    ...(data?.productSummary?.colorPreference
      ? [`配色:${String(data.productSummary.colorPreference).slice(0, 24)}`]
      : []),
  ]
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  const mergedTags = [...new Set([...(data?.searchTags || []), ...productTags])].slice(0, 48);
  return {
    name: data?.companyInfo?.name || fallbackDomain || 'Unknown',
    website,
    country:
      data?.searchCountry ||
      data?.companyInfo?.headquarters?.split(',').pop()?.trim() ||
      data?.companyInfo?.city ||
      'Global',
    productType:
      data?.businessScope?.coreProducts?.[0] ||
      data?.productIntel?.sell?.categories?.[0] ||
      data?.products?.find((p) => p.category)?.category ||
      data?.products?.[0]?.name ||
      data?.searchKeyword ||
      'N/A',
    industry: data?.companyInfo?.nature || 'N/A',
    priceRange: (() => {
      const mins = (data?.products || [])
        .map((p) => p.priceMinCNY ?? p.retailPriceCNY ?? p.estimatedFOBPriceCNY)
        .filter((n): n is number => typeof n === 'number' && n > 0);
      const maxs = (data?.products || [])
        .map((p) => p.priceMaxCNY ?? p.retailPriceCNY ?? p.estimatedFOBPriceCNY)
        .filter((n): n is number => typeof n === 'number' && n > 0);
      if (mins.length || maxs.length) {
        const lo = mins.length ? Math.min(...mins) : Math.min(...maxs);
        const hi = maxs.length ? Math.max(...maxs) : Math.max(...mins);
        return `¥${lo}–${hi}`;
      }
      return data?.businessScope?.priceSensitivity || 'Medium';
    })(),
    hasAnalyzed: true,
    hasBackgroundCheck: true,
    lastBackgroundCheckAt: checkedAt || Date.now(),
    contacts: data?.decisionMakers || [],
    searchKeyword: data?.searchKeyword,
    searchedKeywords: searchedKeywords.length ? searchedKeywords : undefined,
    tags: mergedTags.length ? mergedTags : data?.searchTags,
    sellCategoryIds: sellCategoryIds.length ? sellCategoryIds : undefined,
    procureCategoryIds: procureCategoryIds.length ? procureCategoryIds : undefined,
  };
};

export type CrmImportStats = { added: number; updated: number; skipped: number };

/** Merge selected 背调 records into CRM list (upsert by website/name) */
export const mergeHistoryItemsIntoCrm = (
  prev: Client[],
  items: HistoryItem[],
  stamp: <T>(item: T) => T
): { clients: Client[]; stats: CrmImportStats } => {
  let clients = [...prev];
  const stats: CrmImportStats = { added: 0, updated: 0, skipped: 0 };
  const today = new Date().toISOString().split('T')[0];

  for (const item of items) {
    const data = item.data;
    if (!data?.companyInfo?.name && !item.domain) {
      stats.skipped += 1;
      continue;
    }
    const patch = clientPatchFromAnalysis(data, item.domain, item.timestamp);
    const idx = findClientIndex(clients, patch.website, patch.name);
    if (idx >= 0) {
      const prevKws = clients[idx].searchedKeywords || [];
      const nextKws = [
        ...new Set([...(patch.searchedKeywords || []), ...prevKws, clients[idx].searchKeyword].filter(Boolean) as string[]),
      ];
      clients[idx] = {
        ...clients[idx],
        ...patch,
        searchedKeywords: nextKws,
        lastBackgroundCheckAt: Math.max(
          clients[idx].lastBackgroundCheckAt || 0,
          patch.lastBackgroundCheckAt || 0
        ),
        activityLog:
          (clients[idx].activityLog || '') +
          ` [Synced from 记录中心 ${new Date().toLocaleDateString()}]`,
      };
      stats.updated += 1;
    } else {
      const newClient = stamp({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        type: '进口商' as const,
        status: '新建/潜在' as const,
        isSampleNeeded: false,
        lastOrderDate: '',
        lastContactSent: '',
        lastContactReceived: '',
        nextFollowUpDate: today,
        activityLog: `记录中心批量导入。Rev: ${data?.financials?.revenueEstimate || '-'}。`,
        ...patch,
      } as Client);
      clients = [newClient, ...clients];
      stats.added += 1;
    }
  }
  return { clients, stats };
};

/** Merge Discovery search results into CRM (skip existing websites) */
export const mergeDiscoveryResultsIntoCrm = (
  prev: Client[],
  results: ClientSearchResult[],
  stamp: <T>(item: T) => T,
  defaults?: { product?: string; industry?: string }
): { clients: Client[]; stats: CrmImportStats } => {
  let clients = [...prev];
  const stats: CrmImportStats = { added: 0, updated: 0, skipped: 0 };
  const today = new Date().toISOString().split('T')[0];
  const existingHosts = new Set(
    clients.map((c) => normalizeCrmHost(c.website)).filter(Boolean)
  );

  for (const r of results) {
    const host = normalizeCrmHost(r.website);
    if (host && existingHosts.has(host)) {
      stats.skipped += 1;
      continue;
    }
    if (!host && r.name) {
      const byName = findClientIndex(clients, null, r.name);
      if (byName >= 0) {
        stats.skipped += 1;
        continue;
      }
    }
    const newClient = stamp({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name: r.name,
      website: r.website,
      country: r.country,
      type: mapDiscoveryType(r.clientType),
      status: '新建/潜在' as const,
      productType: defaults?.product || r.mainProducts || r.searchKeyword || 'General',
      industry: defaults?.industry || 'Unknown',
      priceRange: r.estimatedScale || 'Unknown',
      isSampleNeeded: false,
      hasAnalyzed: false,
      lastOrderDate: '',
      lastContactSent: '',
      lastContactReceived: '',
      nextFollowUpDate: today,
      activityLog: `记录中心·搜索导入。匹配度:${r.fitScore ?? '-'}。${r.fitReason || r.description || ''}`,
      contacts: [],
      searchKeyword: r.searchKeyword || defaults?.product,
      tags: r.searchTags || [],
    } as Client);
    clients = [newClient, ...clients];
    if (host) existingHosts.add(host);
    stats.added += 1;
  }
  return { clients, stats };
};

/** Find the latest matching back-check report for a CRM client */
export const findHistoryForClient = (
  client: Client,
  history: HistoryItem[]
): HistoryItem | undefined => {
  const host = normalizeCrmHost(client.website);
  const name = (client.name || '').trim().toLowerCase();

  const matches = history.filter((h) => {
    const hHost = normalizeCrmHost(h.domain || h.data?.companyInfo?.website);
    if (host && hHost && host === hHost) return true;
    const hName = (h.data?.companyInfo?.name || '').trim().toLowerCase();
    if (name && hName && name === hName) return true;
    return false;
  });

  if (matches.length === 0) return undefined;
  return matches.reduce((a, b) => preferHistoryItem(a, b));
};

/** O(1) 背调历史索引（避免 CRM 列表每行 O(n) 扫描 history） */
export type HistoryLookupIndex = {
  byHost: Map<string, HistoryItem>;
  byName: Map<string, HistoryItem>;
};

export const buildHistoryLookupIndex = (history: HistoryItem[]): HistoryLookupIndex => {
  const byHost = new Map<string, HistoryItem>();
  const byName = new Map<string, HistoryItem>();
  for (const h of history) {
    const host = normalizeCrmHost(h.domain || h.data?.companyInfo?.website);
    const name = (h.data?.companyInfo?.name || '').trim().toLowerCase();
    if (host) {
      const prev = byHost.get(host);
      if (!prev || preferHistoryItem(h, prev) === h) byHost.set(host, h);
    }
    if (name) {
      const prev = byName.get(name);
      if (!prev || preferHistoryItem(h, prev) === h) byName.set(name, h);
    }
  }
  return { byHost, byName };
};

/**
 * 用背调历史回填 CRM 品类：跨端只同步了历史、CRM 仍显示「公开信息未找到」时调用。
 */
export const reconcileCrmProductTypesFromHistory = (
  clients: Client[],
  history: HistoryItem[]
): { clients: Client[]; changed: number } => {
  if (!clients.length || !history.length) return { clients, changed: 0 };
  const index = buildHistoryLookupIndex(history);
  let changed = 0;
  const next = clients.map((c) => {
    const h = lookupHistoryForClient(c, index);
    if (!h?.data) return c;
    const patch = clientPatchFromAnalysis(h.data, h.domain || c.website, h.timestamp);
    const needType = isWeakProductType(c.productType) && !isWeakProductType(patch.productType);
    const needTags =
      (patch.tags?.length || 0) > 0 &&
      !(c.tags || []).some((t) => /^(在售|采购|包装|配色):/.test(t));
    if (!needType && !needTags) return c;
    changed += 1;
    return {
      ...c,
      productType: needType ? patch.productType || c.productType : c.productType,
      tags: [...new Set([...(c.tags || []), ...(patch.tags || [])])].slice(0, 48),
      lastBackgroundCheckAt: Math.max(c.lastBackgroundCheckAt || 0, patch.lastBackgroundCheckAt || 0),
      hasAnalyzed: c.hasAnalyzed || patch.hasAnalyzed,
      hasBackgroundCheck: c.hasBackgroundCheck || patch.hasBackgroundCheck,
    };
  });
  return { clients: next, changed };
};

export const lookupHistoryForClient = (
  client: Client,
  index: HistoryLookupIndex
): HistoryItem | undefined => {
  const host = normalizeCrmHost(client.website);
  const name = (client.name || '').trim().toLowerCase();
  if (host) {
    const hit = index.byHost.get(host);
    if (hit) return hit;
  }
  if (name) return index.byName.get(name);
  return undefined;
};

export const clientHasBackgroundCheckIndexed = (
  client: Client,
  index: HistoryLookupIndex
): boolean => {
  if (client.hasBackgroundCheck || client.hasAnalyzed) return true;
  return !!lookupHistoryForClient(client, index);
};

export const resolveBackgroundCheckAtIndexed = (
  client: Client,
  index: HistoryLookupIndex
): number | undefined => {
  if (client.lastBackgroundCheckAt && client.lastBackgroundCheckAt > 0) {
    return client.lastBackgroundCheckAt;
  }
  return lookupHistoryForClient(client, index)?.timestamp;
};

/** Whether this CRM client has a completed background check (flag or linked history) */
export const clientHasBackgroundCheck = (
  client: Client,
  history: HistoryItem[] = []
): boolean => {
  if (client.hasBackgroundCheck || client.hasAnalyzed) return true;
  return !!findHistoryForClient(client, history);
};

/** Resolve 背调时间：CRM 字段优先，否则取匹配历史记录的 timestamp */
export const resolveBackgroundCheckAt = (
  client: Client,
  history: HistoryItem[] = []
): number | undefined => {
  if (client.lastBackgroundCheckAt && client.lastBackgroundCheckAt > 0) {
    return client.lastBackgroundCheckAt;
  }
  const item = findHistoryForClient(client, history);
  return item?.timestamp;
};

export const formatBackgroundCheckTime = (ms?: number): string => {
  if (!ms || !Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
};

/** 2026-06-01 00:00:00 UTC+8 — CRM 历史清理分界 */
export const CRM_JUNE_2026_CUTOFF_MS = new Date('2026-06-01T00:00:00+08:00').getTime();

/** 推断 CRM 客户记录时间（用于展示/筛选） */
export const resolveClientRecordTime = (client: Client): number | undefined => {
  if (client.lastBackgroundCheckAt && client.lastBackgroundCheckAt > 0) {
    return client.lastBackgroundCheckAt;
  }
  const id = (client.id || '').trim();
  const idMatch = id.match(/^(\d{10,13})/);
  if (idMatch) {
    let ts = Number(idMatch[1]);
    if (ts > 0 && ts < 1e12) ts *= 1000;
    if (ts > 1e11 && ts < 2e13) return ts;
  }
  const log = client.activityLog || '';
  const analyzed = log.match(/Analyzed\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (analyzed) {
    const d = new Date(analyzed[1]);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const iso = log.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const d = new Date(iso[1]);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  for (const raw of [client.lastContactSent, client.lastContactReceived, client.lastOrderDate]) {
    const s = (raw || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T12:00:00`);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
  }
  const fu = (client.nextFollowUpDate || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fu)) {
    const d = new Date(`${fu}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return undefined;
};

/**
 * 仅用于「6月前清理」：只用背调时间 / 创建 id / activityLog，不用跟进日（跟进日≠建档日，误删全部）
 */
export const resolveClientRecordTimeForPurge = (client: Client): number | undefined => {
  if (client.lastBackgroundCheckAt && client.lastBackgroundCheckAt > 0) {
    return client.lastBackgroundCheckAt;
  }
  const id = (client.id || '').trim();
  const idMatch = id.match(/^(\d{10,13})/);
  if (idMatch) {
    let ts = Number(idMatch[1]);
    if (ts > 0 && ts < 1e12) ts *= 1000;
    if (ts > 1e11 && ts < 2e13) return ts;
  }
  const log = client.activityLog || '';
  const analyzed = log.match(/Analyzed\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (analyzed) {
    const d = new Date(analyzed[1]);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const iso = log.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const d = new Date(iso[1]);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return undefined;
};

export const isClientRecordBefore = (client: Client, cutoffMs: number): boolean => {
  const t = resolveClientRecordTime(client);
  return t != null && t < cutoffMs;
};

export const isClientRecordBeforeForPurge = (client: Client, cutoffMs: number): boolean => {
  const t = resolveClientRecordTimeForPurge(client);
  return t != null && t < cutoffMs;
};

/** 按 cutoff 拆分 CRM 列表；forPurge=true 时用保守规则，无明确时间的记录保留 */
export const splitCrmClientsByCutoff = (
  clients: Client[],
  cutoffMs: number,
  forPurge = false
): { kept: Client[]; removed: Client[] } => {
  const kept: Client[] = [];
  const removed: Client[] = [];
  const isBefore = forPurge ? isClientRecordBeforeForPurge : isClientRecordBefore;
  for (const c of clients) {
    if (isBefore(c, cutoffMs)) removed.push(c);
    else kept.push(c);
  }
  return { kept, removed };
};

export type BackgroundCheckLookup = {
  checked: boolean;
  checkedAt?: number;
  keywords: string[];
  historyItem?: HistoryItem;
  /** 背调拥有人（历史或 CRM） */
  ownerUsername?: string;
};

const collectKeywordsFromHistory = (h: HistoryItem): string[] => {
  const out: string[] = [];
  const kw = (h.keyword || h.data?.searchKeyword || '').trim();
  if (kw) out.push(kw);
  for (const t of h.data?.searchTags || []) {
    if (typeof t !== 'string') continue;
    if (t.startsWith('关键词:')) {
      const v = t.replace(/^关键词:/, '').trim();
      if (v) out.push(v);
    }
  }
  return out;
};

/** Look up whether a website/name already has a background check (history or CRM). */
export const lookupBackgroundCheck = (
  website: string | undefined,
  name: string | undefined,
  history: HistoryItem[] = [],
  crmClients: Client[] = []
): BackgroundCheckLookup => {
  const host = normalizeCrmHost(website);
  const nameKey = (name || '').trim().toLowerCase();
  const keywords = new Set<string>();
  let latest: HistoryItem | undefined;
  let checkedAt = 0;
  let ownerUsername = '';

  for (const h of history) {
    const hHost = normalizeCrmHost(h.domain || h.data?.companyInfo?.website);
    const hName = (h.data?.companyInfo?.name || '').trim().toLowerCase();
    const match =
      (host && hHost && host === hHost) || (nameKey && hName && nameKey === hName);
    if (!match) continue;
    for (const k of collectKeywordsFromHistory(h)) keywords.add(k);
    if (!latest || h.timestamp > latest.timestamp) {
      latest = h;
      if ((h.ownerUsername || '').trim()) ownerUsername = h.ownerUsername!.trim();
    }
    if (h.timestamp > checkedAt) checkedAt = h.timestamp;
  }

  for (const c of crmClients) {
    const cHost = normalizeCrmHost(c.website);
    const cName = (c.name || '').trim().toLowerCase();
    const match =
      (host && cHost && host === cHost) || (nameKey && cName && nameKey === cName);
    if (!match) continue;
    if (c.searchKeyword) keywords.add(c.searchKeyword);
    for (const k of c.searchedKeywords || []) if (k?.trim()) keywords.add(k.trim());
    for (const t of c.tags || []) {
      if (t.startsWith('关键词:')) {
        const v = t.replace(/^关键词:/, '').trim();
        if (v) keywords.add(v);
      }
    }
    if (!ownerUsername && (c.ownerUsername || '').trim()) {
      ownerUsername = c.ownerUsername!.trim();
    }
    if (c.hasBackgroundCheck || c.hasAnalyzed || c.lastBackgroundCheckAt) {
      const at = c.lastBackgroundCheckAt || 0;
      if (at > checkedAt) checkedAt = at;
      if (!latest && (c.hasBackgroundCheck || c.hasAnalyzed || at)) {
        checkedAt = checkedAt || at || Date.now();
      }
    }
  }

  const checked = !!latest || checkedAt > 0;
  return {
    checked,
    checkedAt: checkedAt || latest?.timestamp,
    keywords: [...keywords],
    historyItem: latest,
    ownerUsername:
      ownerUsername ||
      (latest?.ownerUsername || '').trim() ||
      undefined,
  };
};

/** Build a host → lookup map for batch UI (search results). */
export const buildBackgroundCheckIndex = (
  history: HistoryItem[] = [],
  crmClients: Client[] = []
): Map<string, BackgroundCheckLookup> => {
  const map = new Map<string, BackgroundCheckLookup>();
  const upsert = (key: string, patch: BackgroundCheckLookup) => {
    if (!key) return;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, patch);
      return;
    }
    map.set(key, {
      checked: prev.checked || patch.checked,
      checkedAt: Math.max(prev.checkedAt || 0, patch.checkedAt || 0) || undefined,
      keywords: [...new Set([...prev.keywords, ...patch.keywords])],
      historyItem:
        (prev.historyItem?.timestamp || 0) >= (patch.historyItem?.timestamp || 0)
          ? prev.historyItem
          : patch.historyItem,
      ownerUsername:
        (prev.historyItem?.timestamp || 0) >= (patch.historyItem?.timestamp || 0)
          ? prev.ownerUsername || patch.ownerUsername
          : patch.ownerUsername || prev.ownerUsername,
    });
  };

  for (const h of history) {
    const host = normalizeCrmHost(h.domain || h.data?.companyInfo?.website);
    const name = (h.data?.companyInfo?.name || '').trim().toLowerCase();
    const base: BackgroundCheckLookup = {
      checked: true,
      checkedAt: h.timestamp,
      keywords: collectKeywordsFromHistory(h),
      historyItem: h,
      ownerUsername: (h.ownerUsername || '').trim() || undefined,
    };
    if (host) upsert(host, base);
    if (name) upsert(`name:${name}`, base);
  }

  for (const c of crmClients) {
    if (!(c.hasBackgroundCheck || c.hasAnalyzed || c.lastBackgroundCheckAt)) continue;
    const host = normalizeCrmHost(c.website);
    const name = (c.name || '').trim().toLowerCase();
    const kws = [
      c.searchKeyword,
      ...(c.searchedKeywords || []),
      ...(c.tags || [])
        .filter((t) => t.startsWith('关键词:'))
        .map((t) => t.replace(/^关键词:/, '').trim()),
    ].filter(Boolean) as string[];
    const base: BackgroundCheckLookup = {
      checked: true,
      checkedAt: c.lastBackgroundCheckAt,
      keywords: kws,
      ownerUsername: (c.ownerUsername || '').trim() || undefined,
    };
    if (host) upsert(host, base);
    if (name) upsert(`name:${name}`, base);
  }

  return map;
};

export const lookupFromBgIndex = (
  index: Map<string, BackgroundCheckLookup>,
  website?: string,
  name?: string
): BackgroundCheckLookup => {
  const host = normalizeCrmHost(website);
  const nameKey = (name || '').trim().toLowerCase();
  const byHost = host ? index.get(host) : undefined;
  const byName = nameKey ? index.get(`name:${nameKey}`) : undefined;
  if (!byHost && !byName) return { checked: false, keywords: [] };
  if (byHost && !byName) return byHost;
  if (!byHost && byName) return byName;
  const historyItem =
    (byHost!.historyItem?.timestamp || 0) >= (byName!.historyItem?.timestamp || 0)
      ? byHost!.historyItem
      : byName!.historyItem;
  return {
    checked: true,
    checkedAt: Math.max(byHost!.checkedAt || 0, byName!.checkedAt || 0) || undefined,
    keywords: [...new Set([...(byHost!.keywords || []), ...(byName!.keywords || [])])],
    historyItem,
    ownerUsername:
      historyItem?.ownerUsername ||
      byHost!.ownerUsername ||
      byName!.ownerUsername,
  };
};

/** Whether a history / analysis domain is already in CRM */
export const isHistoryInCrm = (
  item: Pick<HistoryItem, 'domain' | 'data'>,
  clients: Client[]
): boolean => {
  if (!clients?.length) return false;
  const host = normalizeCrmHost(item.domain || item.data?.companyInfo?.website);
  const name = (item.data?.companyInfo?.name || '').trim().toLowerCase();
  return clients.some((c) => {
    const cHost = normalizeCrmHost(c.website);
    if (host && cHost && host === cHost) return true;
    if (name && (c.name || '').trim().toLowerCase() === name) return true;
    return false;
  });
};

/** 搜索结果是否已在 CRM */
export const isSearchResultInCrm = (
  r: Pick<ClientSearchResult, 'website' | 'name'>,
  clients: Client[]
): boolean => {
  if (!clients?.length) return false;
  const host = normalizeCrmHost(r.website);
  const name = (r.name || '').trim().toLowerCase();
  if (!host && !name) return false;
  return clients.some((c) => {
    const cHost = normalizeCrmHost(c.website);
    if (host && cHost && host === cHost) return true;
    if (name && (c.name || '').trim().toLowerCase() === name) return true;
    return false;
  });
};

/** 待从记录中心移除的已入 CRM 背调 id */
export const listHistoryIdsAlreadyInCrm = (
  history: HistoryItem[],
  clients: Client[]
): string[] => history.filter((h) => isHistoryInCrm(h, clients)).map((h) => h.id);

/** CRM client ids matching a背调 record (by website / name) */
export const findCrmIdsForHistoryItem = (
  item: Pick<HistoryItem, 'domain' | 'data'>,
  clients: Client[]
): string[] => {
  if (!clients?.length) return [];
  const host = normalizeCrmHost(item.domain || item.data?.companyInfo?.website);
  const name = (item.data?.companyInfo?.name || '').trim().toLowerCase();
  return clients
    .filter((c) => {
      const cHost = normalizeCrmHost(c.website);
      if (host && cHost && host === cHost) return true;
      if (name && (c.name || '').trim().toLowerCase() === name) return true;
      return false;
    })
    .map((c) => c.id);
};

/** CRM client ids matching companies inside a discovery archive */
export const findCrmIdsForDiscoveryResults = (
  results: Array<{ website?: string; name?: string }> | undefined,
  clients: Client[]
): string[] => {
  if (!results?.length || !clients?.length) return [];
  const ids = new Set<string>();
  for (const r of results) {
    const host = normalizeCrmHost(r.website);
    const name = (r.name || '').trim().toLowerCase();
    for (const c of clients) {
      const cHost = normalizeCrmHost(c.website);
      if (host && cHost && host === cHost) ids.add(c.id);
      else if (name && (c.name || '').trim().toLowerCase() === name) ids.add(c.id);
    }
  }
  return [...ids];
};

/** Decision-maker email search already run on this report */
export const historyHasDmSearch = (item: HistoryItem): boolean =>
  !!item.data?.decisionMakerEmailSearchAt ||
  !!(item.data?.decisionMakerEmailSearchHistory && item.data.decisionMakerEmailSearchHistory.length > 0) ||
  // 兼容：已有带邮箱的决策人但漏写 searchedAt（刷新后勿显示「未挖」）
  (item.data?.decisionMakers || []).some((d) => !!(d.emailGuess && String(d.emailGuess).includes('@')));

/** 决策人挖掘完成态：未挖 / 已挖有联系人 / 已挖无联系人 */
export type DmDigStatus = 'none' | 'found' | 'empty';

export const countAnalysisDecisionMakers = (data?: AnalysisResult | null): number =>
  Array.isArray(data?.decisionMakers) ? data.decisionMakers.length : 0;

export const resolveDmDigStatus = (mined: boolean, contactCount: number): DmDigStatus => {
  if (!mined) return 'none';
  return contactCount > 0 ? 'found' : 'empty';
};

export const historyDmContactCount = (item: HistoryItem): number =>
  countAnalysisDecisionMakers(item.data);

export const historyDmDigStatus = (item: HistoryItem): DmDigStatus =>
  resolveDmDigStatus(historyHasDmSearch(item), historyDmContactCount(item));

export const dmDigStatusLabel = (status: DmDigStatus, contactCount = 0): string => {
  if (status === 'found') return contactCount > 0 ? `有联系人·${contactCount}` : '有联系人';
  if (status === 'empty') return '已挖无联系人';
  return '未挖决策人';
};

export const dmDigGroupLabel = (status: DmDigStatus): string => {
  if (status === 'found') return '已挖·有联系人';
  if (status === 'empty') return '已挖·无联系人';
  return '未挖掘决策人';
};

const FUNNEL_RANK: Record<Client['status'], number> = {
  已成交: 5,
  谈判中: 4,
  已寄样: 3,
  '新建/潜在': 2,
  '流失/搁置': 1,
};

const isWeakField = (s?: string) =>
  !s ||
  !String(s).trim() ||
  /^(n\/?a|公开信息未找到|未知|待补充|global|unknown|-)$/i.test(String(s).trim());

const contactKey = (c: NonNullable<Client['contacts']>[number]) => {
  const email = (c.emailGuess || '').trim().toLowerCase();
  if (email) return `e:${email}`;
  return `n:${(c.name || '').trim().toLowerCase()}|${(c.title || '').trim().toLowerCase()}`;
};

const scoreCrmClient = (c: Client): number => {
  let s = 0;
  s += (FUNNEL_RANK[c.status] || 0) * 1000;
  if (c.hasBackgroundCheck) s += 400;
  if (c.hasAnalyzed) s += 80;
  s += Math.min(200, (c.contacts?.length || 0) * 25);
  s += Math.min(80, (c.activityEvents?.length || 0) * 2);
  if (!isWeakField(c.productType)) s += 60;
  if (!isWeakField(c.industry)) s += 20;
  if ((c.website || '').trim()) s += 30;
  if (!isWeakCrmMatchName((c.name || '').trim().toLowerCase())) s += 40;
  s += Math.min(100, Math.floor((c.lastBackgroundCheckAt || 0) / 1e12));
  return s;
};

/** 把多条同域名 CRM 记录合并为一条（保留更完整的那条 id） */
export const mergeTwoCrmClients = (winner: Client, loser: Client): Client => {
  const prefer = (a?: string, b?: string) =>
    !isWeakField(a) ? a || '' : !isWeakField(b) ? b || '' : a || b || '';
  const contactMap = new Map<string, NonNullable<Client['contacts']>[number]>();
  for (const c of [...(loser.contacts || []), ...(winner.contacts || [])]) {
    const k = contactKey(c);
    if (!k || k === 'n:|') continue;
    const prev = contactMap.get(k);
    if (!prev) {
      contactMap.set(k, c);
      continue;
    }
    // 有邮箱 / 已验证的优先
    const score = (x: typeof c) =>
      (x.emailGuess ? 4 : 0) + (x.isVerified ? 2 : 0) + (x.whatsapp || x.phone ? 1 : 0);
    contactMap.set(k, score(c) >= score(prev) ? { ...prev, ...c } : { ...c, ...prev });
  }
  const status =
    (FUNNEL_RANK[winner.status] || 0) >= (FUNNEL_RANK[loser.status] || 0)
      ? winner.status
      : loser.status;
  const events = [...(loser.activityEvents || []), ...(winner.activityEvents || [])]
    .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 200);
  const logExtra = `\n[域名去重合并] ${new Date().toLocaleString('zh-CN')} 并入「${loser.name}」(${loser.id})`;
  return {
    ...loser,
    ...winner,
    id: winner.id,
    name: !isWeakCrmMatchName((winner.name || '').trim().toLowerCase())
      ? winner.name
      : loser.name || winner.name,
    website: winner.website || loser.website,
    country: prefer(winner.country, loser.country) || winner.country || loser.country,
    type: winner.type || loser.type,
    status,
    productType: prefer(winner.productType, loser.productType) || winner.productType || loser.productType,
    industry: prefer(winner.industry, loser.industry) || winner.industry || loser.industry,
    priceRange: prefer(winner.priceRange, loser.priceRange) || winner.priceRange || loser.priceRange,
    hasAnalyzed: !!(winner.hasAnalyzed || loser.hasAnalyzed),
    hasBackgroundCheck: !!(winner.hasBackgroundCheck || loser.hasBackgroundCheck),
    lastBackgroundCheckAt: Math.max(
      winner.lastBackgroundCheckAt || 0,
      loser.lastBackgroundCheckAt || 0
    ) || undefined,
    contacts: Array.from(contactMap.values()),
    tags: Array.from(new Set([...(loser.tags || []), ...(winner.tags || [])])).slice(0, 64),
    searchedKeywords: Array.from(
      new Set(
        [
          ...(loser.searchedKeywords || []),
          ...(winner.searchedKeywords || []),
          loser.searchKeyword,
          winner.searchKeyword,
        ].filter(Boolean) as string[]
      )
    ),
    searchKeyword: winner.searchKeyword || loser.searchKeyword,
    activityEvents: events,
    activityLog: `${winner.activityLog || ''}${loser.activityLog ? `\n---\n${loser.activityLog}` : ''}${logExtra}`,
    ownerUsername: winner.ownerUsername || loser.ownerUsername,
    departmentId: winner.departmentId || loser.departmentId,
    lastContactSent: winner.lastContactSent || loser.lastContactSent || '',
    lastContactReceived: winner.lastContactReceived || loser.lastContactReceived || '',
    nextFollowUpDate: winner.nextFollowUpDate || loser.nextFollowUpDate || '',
    lastOrderDate: winner.lastOrderDate || loser.lastOrderDate || '',
    isSampleNeeded: winner.isSampleNeeded || loser.isSampleNeeded,
  };
};

export type CrmDomainMergeResult = {
  clients: Client[];
  /** loserId → survivorId */
  remaps: Record<string, string>;
  mergedGroups: number;
  removedCount: number;
};

/**
 * 按规范化域名合并 CRM 重复客户（名称不同也合并）。
 * 无官网的记录不参与合并，避免误伤。
 */
export const mergeCrmClientsByDomain = (clients: Client[]): CrmDomainMergeResult => {
  const remaps: Record<string, string> = {};
  const byHost = new Map<string, Client[]>();
  const hostless: Client[] = [];

  for (const c of clients) {
    const host = normalizeCrmHost(c.website);
    if (!host) {
      hostless.push(c);
      continue;
    }
    const list = byHost.get(host) || [];
    list.push(c);
    byHost.set(host, list);
  }

  const out: Client[] = [...hostless];
  let mergedGroups = 0;
  let removedCount = 0;

  for (const [, group] of byHost) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    mergedGroups += 1;
    const ranked = [...group].sort((a, b) => {
      const ds = scoreCrmClient(b) - scoreCrmClient(a);
      if (ds !== 0) return ds;
      return String(a.id).localeCompare(String(b.id));
    });
    let survivor = ranked[0];
    for (let i = 1; i < ranked.length; i++) {
      const loser = ranked[i];
      remaps[loser.id] = survivor.id;
      survivor = mergeTwoCrmClients(survivor, loser);
      removedCount += 1;
    }
    // 统一域名展示为规范化 host（便于后续匹配）
    const host = normalizeCrmHost(survivor.website);
    if (host && normalizeCrmHost(survivor.website) === host) {
      survivor = {
        ...survivor,
        website: survivor.website?.includes('://') ? survivor.website : host,
      };
    }
    out.push(survivor);
  }

  return { clients: out, remaps, mergedGroups, removedCount };
};
