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
  fallbackDomain?: string
): Partial<Client> => {
  const website = data?.companyInfo?.website || fallbackDomain || '';
  return {
    name: data?.companyInfo?.name || fallbackDomain || 'Unknown',
    website,
    country:
      data?.searchCountry ||
      data?.companyInfo?.headquarters?.split(',').pop()?.trim() ||
      data?.companyInfo?.city ||
      'Global',
    productType: data?.businessScope?.coreProducts?.[0] || data?.searchKeyword || 'N/A',
    industry: data?.companyInfo?.nature || 'N/A',
    priceRange: data?.businessScope?.priceSensitivity || 'Medium',
    hasAnalyzed: true,
    hasBackgroundCheck: true,
    contacts: data?.decisionMakers || [],
    searchKeyword: data?.searchKeyword,
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
    const patch = clientPatchFromAnalysis(data, item.domain);
    const idx = findClientIndex(clients, patch.website, patch.name);
    if (idx >= 0) {
      clients[idx] = {
        ...clients[idx],
        ...patch,
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

/** Whether this CRM client has a completed background check (flag or linked history) */
export const clientHasBackgroundCheck = (
  client: Client,
  history: HistoryItem[] = []
): boolean => {
  if (client.hasBackgroundCheck || client.hasAnalyzed) return true;
  return !!findHistoryForClient(client, history);
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

/** Decision-maker email search already run on this report */
export const historyHasDmSearch = (item: HistoryItem): boolean =>
  !!item.data?.decisionMakerEmailSearchAt ||
  !!(item.data?.decisionMakerEmailSearchHistory && item.data.decisionMakerEmailSearchHistory.length > 0);
