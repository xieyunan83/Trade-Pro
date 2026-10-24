/**
 * 自有买家库 · 类型与本地存根
 * 检索策略（后续实现）：本地命中 → 不足再 Tavily/AnySearch → 静默背调写回
 */
export type BuyerRecord = {
  id: string;
  companyName: string;
  domain?: string;
  country?: string;
  industry?: string;
  emails?: string[];
  phones?: string[];
  source: 'manual' | 'yellow_pages' | 'customs' | 'background' | 'online_search' | 'import';
  enrichmentStatus?: 'raw' | 'enriched' | 'stale';
  lastEnrichedAt?: number;
  ownerUsername?: string;
  departmentId?: string;
  createdAt: number;
  updatedAt: number;
};

const LS = 'trade_scout_buyer_library_v1';

export const loadBuyerRecords = (): BuyerRecord[] => {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveBuyerRecords = (rows: BuyerRecord[]) => {
  localStorage.setItem(LS, JSON.stringify(rows));
};

/** 占位：库优先搜索 */
export const searchBuyerLibrary = (
  query: string,
  records: BuyerRecord[] = loadBuyerRecords()
): BuyerRecord[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return records.filter(
    (r) =>
      r.companyName.toLowerCase().includes(q) ||
      (r.domain || '').toLowerCase().includes(q) ||
      (r.country || '').toLowerCase().includes(q)
  );
};
