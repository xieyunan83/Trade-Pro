/**
 * 决策人挖掘结果耐久化：防止刷新后「已挖」变回「未挖」、积分白费。
 * 独立于 HistoryItem 全量写入，按 historyId / 域名可重放合并。
 */
import type { DecisionMaker, HistoryItem } from '../types';

const STORAGE_KEY = 'trade_scout_dm_results_v2';
const MAX_RECORDS = 2000;

export type DmPersistRecord = {
  historyId?: string | null;
  domain: string;
  companyName?: string;
  searchedAt: number;
  decisionMakers: DecisionMaker[];
  searchHistory?: number[];
  updatedAt: number;
};

const cleanHost = (raw?: string | null): string =>
  (raw || '')
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .trim();

export const loadDmPersistRecords = (): DmPersistRecord[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DmPersistRecord[]) : [];
  } catch {
    return [];
  }
};

const saveAll = (list: DmPersistRecord[]) => {
  try {
    const trimmed = list
      .slice()
      .sort((a, b) => (b.searchedAt || 0) - (a.searchedAt || 0))
      .slice(0, MAX_RECORDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[dm-persist] localStorage save failed', e);
  }
};

/** 写入/更新一条挖掘结果（按 historyId 或域名去重，保留更新的 searchedAt） */
export const upsertDmPersistRecord = (rec: Omit<DmPersistRecord, 'updatedAt'>): void => {
  const domain = cleanHost(rec.domain);
  if (!domain && !rec.historyId) return;
  const list = loadDmPersistRecords();
  const nextRec: DmPersistRecord = {
    ...rec,
    domain: domain || rec.domain || '',
    updatedAt: Date.now(),
  };
  const idx = list.findIndex((x) => {
    if (rec.historyId && x.historyId && rec.historyId === x.historyId) return true;
    if (domain && cleanHost(x.domain) === domain) return true;
    return false;
  });
  if (idx >= 0) {
    const prev = list[idx];
    // 只允许更新时间更新或联系人更多的结果覆盖
    const prevAt = prev.searchedAt || 0;
    const nextAt = nextRec.searchedAt || 0;
    const prevN = prev.decisionMakers?.length || 0;
    const nextN = nextRec.decisionMakers?.length || 0;
    if (nextAt < prevAt && nextN <= prevN) return;
    list[idx] = {
      ...prev,
      ...nextRec,
      searchHistory: [
        ...new Set([...(prev.searchHistory || []), ...(nextRec.searchHistory || []), nextAt].filter(Boolean)),
      ].slice(-30),
    };
  } else {
    list.unshift(nextRec);
  }
  saveAll(list);
};

const recordAppliesToHistory = (rec: DmPersistRecord, h: HistoryItem): boolean => {
  if (rec.historyId && h.id === rec.historyId) return true;
  const host = cleanHost(h.domain || h.data?.companyInfo?.website);
  if (host && cleanHost(rec.domain) === host) return true;
  const name = (h.data?.companyInfo?.name || '').trim().toLowerCase();
  const recName = (rec.companyName || '').trim().toLowerCase();
  if (name && recName && name === recName) return true;
  return false;
};

/** 把耐久化结果合并进历史（刷新后恢复「已挖决策人」） */
export const applyDmPersistToHistory = (history: HistoryItem[]): HistoryItem[] => {
  const records = loadDmPersistRecords();
  if (!records.length || !history.length) return history;

  return history.map((h) => {
    const matches = records.filter((r) => recordAppliesToHistory(r, h));
    if (!matches.length) return h;
    const best = matches.reduce((a, b) => ((b.searchedAt || 0) >= (a.searchedAt || 0) ? b : a));
    const curAt = h.data?.decisionMakerEmailSearchAt || 0;
    const curN = h.data?.decisionMakers?.length || 0;
    const bestN = best.decisionMakers?.length || 0;
    // 本地报告已更新且不旧于 ledger → 跳过
    if (curAt >= (best.searchedAt || 0) && curN >= bestN && curAt > 0) return h;
    if (!h.data) return h;
    const mergedHistory = [
      ...new Set([
        ...(h.data.decisionMakerEmailSearchHistory || []),
        ...(best.searchHistory || []),
        best.searchedAt,
      ].filter(Boolean)),
    ].slice(-30);
    return {
      ...h,
      data: {
        ...h.data,
        decisionMakers:
          bestN >= curN ? best.decisionMakers : h.data.decisionMakers || best.decisionMakers,
        decisionMakerEmailSearchAt: Math.max(curAt, best.searchedAt || 0) || best.searchedAt,
        decisionMakerEmailSearchHistory: mergedHistory,
      },
    };
  });
};

/** 合并两份历史：同 id 时保留决策人挖掘更新的那份 */
export const mergeHistoryPreferDmRich = (
  primary: HistoryItem[],
  secondary: HistoryItem[]
): HistoryItem[] => {
  const map = new Map<string, HistoryItem>();
  const score = (h: HistoryItem) => {
    const at = h.data?.decisionMakerEmailSearchAt || 0;
    const n = h.data?.decisionMakers?.length || 0;
    const histN = h.data?.decisionMakerEmailSearchHistory?.length || 0;
    return at * 1000 + n * 10 + histN;
  };
  for (const item of [...secondary, ...primary]) {
    if (!item?.id) continue;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      continue;
    }
    map.set(item.id, score(item) >= score(prev) ? item : prev);
  }
  return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
};
