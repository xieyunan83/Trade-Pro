/**
 * 海关情报 · 类型与本地存根（对接数据商后写入）
 */
export type CustomsShipment = {
  id: string;
  shipper?: string;
  consignee?: string;
  hsCode?: string;
  productDesc?: string;
  originCountry?: string;
  destCountry?: string;
  weightKg?: number;
  date?: string;
  /** 数据商若带联系人则可选回写买家库 */
  contactEmail?: string;
  contactPhone?: string;
  provider?: string;
  rawRef?: string;
  linkedCompanyName?: string;
  createdAt: number;
};

const LS = 'trade_scout_customs_cache_v1';

export const loadCustomsCache = (): CustomsShipment[] => {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveCustomsCache = (rows: CustomsShipment[]) => {
  localStorage.setItem(LS, JSON.stringify(rows));
};

/** 本地海关缓存检索（产品词 / HS / 公司名） */
export const searchCustomsCache = (
  query: string,
  rows: CustomsShipment[] = loadCustomsCache()
): CustomsShipment[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/[\s,，;/|+\-_.]+/).filter((t) => t.length >= 2);
  return rows.filter((r) => {
    const blob = [
      r.consignee,
      r.shipper,
      r.productDesc,
      r.hsCode,
      r.linkedCompanyName,
      r.originCountry,
      r.destCountry,
    ]
      .join(' ')
      .toLowerCase();
    if (blob.includes(q)) return true;
    return tokens.some((t) => blob.includes(t));
  });
};

/** 占位：后续接海关 API */
export const queryCustomsProvider = async (
  _q: string
): Promise<{ ok: boolean; message: string; rows: CustomsShipment[] }> => ({
  ok: false,
  message: '海关数据源尚未接通，请在管理后台「数据接入」配置。',
  rows: [],
});
