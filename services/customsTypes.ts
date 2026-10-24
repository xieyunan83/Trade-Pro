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

/** 占位：后续接海关 API */
export const queryCustomsProvider = async (
  _q: string
): Promise<{ ok: boolean; message: string; rows: CustomsShipment[] }> => ({
  ok: false,
  message: '海关数据源尚未接通，请在管理后台「数据接入」配置。',
  rows: [],
});
