import { Client, HistoryItem } from '../types';

/** Normalize website / domain for CRM ↔ history matching */
export const normalizeCrmHost = (url?: string | null): string =>
  (url || '')
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();

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
