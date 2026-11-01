/**
 * 决策人挖掘结果耐久化：防止刷新后「已挖」变回「未挖」、积分白费。
 * 独立于 HistoryItem 全量写入，按 historyId / 域名可重放合并。
 */
import type { AnalysisResult, DecisionMaker, HistoryItem } from '../types';
import { hasRichProductCatalog } from './productCatalog';

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

/** 把耐久化结果合并进历史（刷新后恢复「已挖决策人」） */
export const applyDmPersistToHistory = (history: HistoryItem[]): HistoryItem[] => {
  const records = loadDmPersistRecords();
  if (!records.length || !history.length) return history;

  // 索引化：避免 history × records 全量嵌套扫描（登录卡顿主因之一）
  const byHistoryId = new Map<string, DmPersistRecord[]>();
  const byDomain = new Map<string, DmPersistRecord[]>();
  const byName: DmPersistRecord[] = [];
  for (const r of records) {
    if (r.historyId) {
      const arr = byHistoryId.get(r.historyId) || [];
      arr.push(r);
      byHistoryId.set(r.historyId, arr);
    }
    const d = cleanHost(r.domain);
    if (d) {
      const arr = byDomain.get(d) || [];
      arr.push(r);
      byDomain.set(d, arr);
    }
    if ((r.companyName || '').trim()) byName.push(r);
  }

  const pickBest = (matches: DmPersistRecord[]) =>
    matches.reduce((a, b) => ((b.searchedAt || 0) >= (a.searchedAt || 0) ? b : a));

  return history.map((h) => {
    const matches: DmPersistRecord[] = [];
    const idHits = byHistoryId.get(h.id);
    if (idHits) matches.push(...idHits);
    const host = cleanHost(h.domain || h.data?.companyInfo?.website);
    if (host) {
      const dHits = byDomain.get(host);
      if (dHits) {
        for (const r of dHits) {
          if (!matches.includes(r)) matches.push(r);
        }
      }
    }
    if (!matches.length && byName.length) {
      const name = (h.data?.companyInfo?.name || '').trim().toLowerCase();
      if (name) {
        for (const r of byName) {
          if ((r.companyName || '').trim().toLowerCase() === name) matches.push(r);
        }
      }
    }
    if (!matches.length) return h;
    const best = pickBest(matches);
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

const dmScore = (h: HistoryItem) => {
  const at = h.data?.decisionMakerEmailSearchAt || 0;
  const n = h.data?.decisionMakers?.length || 0;
  const histN = h.data?.decisionMakerEmailSearchHistory?.length || 0;
  return at * 1000 + n * 10 + histN;
};

const productScore = (h: HistoryItem) => {
  const d = h.data;
  if (!d) return 0;
  const rich = hasRichProductCatalog(d) ? 1_000_000 : 0;
  return (
    rich +
    (d.products?.length || 0) * 200 +
    (d.websiteCategories?.length || 0) * 80 +
    (d.productIntel?.sell?.categories?.length || 0) * 120 +
    (d.productIntel?.procure?.categories?.length || 0) * 80
  );
};

/**
 * 同 id 字段级合并：品类深挖与决策人深挖互不覆盖。
 * （旧逻辑只比决策人分数，会导致 A 机采完品类、B 机登录后仍显示未采）
 */
export const mergeTwoHistoryItemsRich = (a: HistoryItem, b: HistoryItem): HistoryItem => {
  const newerTs = (a.timestamp || 0) >= (b.timestamp || 0) ? a : b;
  const olderTs = newerTs === a ? b : a;
  const preferDm = dmScore(a) >= dmScore(b) ? a : b;
  const preferProduct = productScore(a) >= productScore(b) ? a : b;
  const baseData = { ...(olderTs.data || {}), ...(newerTs.data || {}) };
  const da = preferDm.data;
  const pa = preferProduct.data;
  const companyInfo = newerTs.data?.companyInfo || olderTs.data?.companyInfo;
  if (!companyInfo) {
    return (a.timestamp || 0) >= (b.timestamp || 0) ? a : b;
  }
  return {
    ...olderTs,
    ...newerTs,
    timestamp: Math.max(a.timestamp || 0, b.timestamp || 0),
    keyword: newerTs.keyword || olderTs.keyword,
    country: newerTs.country || olderTs.country,
    domain: newerTs.domain || olderTs.domain,
    data: {
      ...baseData,
      companyInfo,
      products:
        (pa?.products?.length || 0) >= (baseData.products?.length || 0)
          ? pa?.products || baseData.products
          : baseData.products,
      websiteCategories:
        (pa?.websiteCategories?.length || 0) >= (baseData.websiteCategories?.length || 0)
          ? pa?.websiteCategories || baseData.websiteCategories
          : baseData.websiteCategories,
      productIntel: pa?.productIntel || baseData.productIntel,
      productSummary: pa?.productSummary || baseData.productSummary,
      businessScope: pa?.businessScope || baseData.businessScope,
      tradeIntelligence: pa?.tradeIntelligence || baseData.tradeIntelligence,
      decisionMakers:
        (da?.decisionMakers?.length || 0) >= (baseData.decisionMakers?.length || 0)
          ? da?.decisionMakers || baseData.decisionMakers
          : baseData.decisionMakers,
      decisionMakerEmailSearchAt: Math.max(
        da?.decisionMakerEmailSearchAt || 0,
        baseData.decisionMakerEmailSearchAt || 0,
        newerTs.data?.decisionMakerEmailSearchAt || 0
      ),
      decisionMakerEmailSearchHistory:
        (da?.decisionMakerEmailSearchHistory?.length || 0) >=
        (baseData.decisionMakerEmailSearchHistory?.length || 0)
          ? da?.decisionMakerEmailSearchHistory || baseData.decisionMakerEmailSearchHistory
          : baseData.decisionMakerEmailSearchHistory,
    } as AnalysisResult,
  };
};

/** 合并两份历史：同 id 时字段级保留品类 + 决策人（兼容旧名） */
export const mergeHistoryPreferDmRich = (
  primary: HistoryItem[],
  secondary: HistoryItem[]
): HistoryItem[] => {
  const map = new Map<string, HistoryItem>();
  for (const item of [...secondary, ...primary]) {
    if (!item?.id) continue;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      continue;
    }
    map.set(item.id, mergeTwoHistoryItemsRich(prev, item));
  }
  return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
};

/** 按域名 / 公司名查找耐久化挖掘结果 */
export const findDmPersistForCompany = (
  domain?: string | null,
  companyName?: string | null
): DmPersistRecord | null => {
  const records = loadDmPersistRecords();
  if (!records.length) return null;
  const host = cleanHost(domain);
  const name = (companyName || '').trim().toLowerCase();
  const matches = records.filter((r) => {
    if (host && cleanHost(r.domain) === host) return true;
    const rn = (r.companyName || '').trim().toLowerCase();
    if (name && rn && name === rn) return true;
    return false;
  });
  if (!matches.length) return null;
  return matches.reduce((a, b) => ((b.searchedAt || 0) >= (a.searchedAt || 0) ? b : a));
};
