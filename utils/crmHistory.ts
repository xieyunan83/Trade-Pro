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
