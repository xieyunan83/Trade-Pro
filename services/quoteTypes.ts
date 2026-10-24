/**
 * 报价 / 选品单 · 类型与本地存根
 */
export type QuoteLine = {
  skuId: string;
  skuCode: string;
  name: string;
  qty: number;
  unitPrice: number;
  currency: string;
  remark?: string;
};

export type QuoteDoc = {
  id: string;
  title: string;
  clientName?: string;
  crmClientId?: string;
  markupPercent: number;
  currency: string;
  lines: QuoteLine[];
  status: 'draft' | 'sent' | 'accepted' | 'expired';
  ownerUsername?: string;
  departmentId?: string;
  createdAt: number;
  updatedAt: number;
};

const LS = 'trade_scout_quotes_v1';

export const loadQuotes = (): QuoteDoc[] => {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveQuotes = (rows: QuoteDoc[]) => {
  localStorage.setItem(LS, JSON.stringify(rows));
};
