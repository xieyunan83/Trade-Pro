import { AnalysisResult, Client, ClientSearchResult, HistoryItem } from '../types';

/** Normalize website / domain for CRM ↔ history matching */
export const normalizeCrmHost = (url?: string | null): string =>
  (url || '')
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();

const findClientIndex = (
  clients: Client[],
  website?: string | null,
  name?: string | null
): number => {
  const host = normalizeCrmHost(website);
  const nameKey = (name || '').trim().toLowerCase();
  return clients.findIndex((c) => {
    const cHost = normalizeCrmHost(c.website);
    if (host && cHost && host === cHost) return true;
    if (nameKey && (c.name || '').trim().toLowerCase() === nameKey) return true;
    return false;
  });
};

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
    tags: data?.searchTags,
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
  return matches.reduce((a, b) => (a.timestamp >= b.timestamp ? a : b));
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
      if (!prev || h.timestamp >= prev.timestamp) byHost.set(host, h);
    }
    if (name) {
      const prev = byName.get(name);
      if (!prev || h.timestamp >= prev.timestamp) byName.set(name, h);
    }
  }
  return { byHost, byName };
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

/** 推断 CRM 客户记录时间（背调时间 > id 前缀时间戳 > activityLog > 跟进日） */
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

export const isClientRecordBefore = (client: Client, cutoffMs: number): boolean => {
  const t = resolveClientRecordTime(client);
  return t != null && t < cutoffMs;
};

/** 按 cutoff 拆分 CRM 列表 */
export const splitCrmClientsByCutoff = (
  clients: Client[],
  cutoffMs: number
): { kept: Client[]; removed: Client[] } => {
  const kept: Client[] = [];
  const removed: Client[] = [];
  for (const c of clients) {
    if (isClientRecordBefore(c, cutoffMs)) removed.push(c);
    else kept.push(c);
  }
  return { kept, removed };
};

export type BackgroundCheckLookup = {
  checked: boolean;
  checkedAt?: number;
  keywords: string[];
  historyItem?: HistoryItem;
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

  for (const h of history) {
    const hHost = normalizeCrmHost(h.domain || h.data?.companyInfo?.website);
    const hName = (h.data?.companyInfo?.name || '').trim().toLowerCase();
    const match =
      (host && hHost && host === hHost) || (nameKey && hName && nameKey === hName);
    if (!match) continue;
    for (const k of collectKeywordsFromHistory(h)) keywords.add(k);
    if (!latest || h.timestamp > latest.timestamp) latest = h;
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
  return {
    checked: true,
    checkedAt: Math.max(byHost!.checkedAt || 0, byName!.checkedAt || 0) || undefined,
    keywords: [...new Set([...(byHost!.keywords || []), ...(byName!.keywords || [])])],
    historyItem:
      (byHost!.historyItem?.timestamp || 0) >= (byName!.historyItem?.timestamp || 0)
        ? byHost!.historyItem
        : byName!.historyItem,
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
  !!(item.data?.decisionMakerEmailSearchHistory && item.data.decisionMakerEmailSearchHistory.length > 0);
