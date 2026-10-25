/**
 * 产品库 · 类型与本地存根（小竹熊/霄鸟云同步在管理后台接通）
 */
export type ProductSource = 'manual' | 'toysbear' | 'skybird' | 'ai_redesign' | 'import';

export type CatalogSku = {
  id: string;
  skuCode: string;
  name: string;
  nameEn?: string;
  category?: string;
  /** dataURL / https，供设计·平面/3D/视频等模块二次创作 */
  images: string[];
  specs?: string;
  moq?: number;
  currency?: string;
  factoryPrice?: number;
  packing?: string;
  certificates?: string[];
  /** 工厂报价扩展 */
  colors?: string;
  cartonQty?: string;
  innerBox?: string;
  cartonSpec?: string;
  grossNetKg?: string;
  supplierName?: string;
  supplierId?: string;
  source: ProductSource;
  externalId?: string;
  ownerUsername?: string;
  departmentId?: string;
  createdAt: number;
  updatedAt: number;
};

const LS = 'trade_scout_product_catalog_v1';

export const loadCatalogSkus = (): CatalogSku[] => {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveCatalogSkus = (rows: CatalogSku[]) => {
  localStorage.setItem(LS, JSON.stringify(rows));
};

/** 小竹熊 / 霄鸟云：配置检测 + 预留同步（接通官方 API 后在此拉取并 merge） */
export const syncCatalogFromProvider = async (
  provider: 'toysbear' | 'skybird'
): Promise<{ ok: boolean; message: string; count: number }> => {
  try {
    const { loadDataProviderLocal } = await import('./dataProviders');
    const meta = loadDataProviderLocal(provider);
    const label = provider === 'toysbear' ? '小竹熊' : '霄鸟云';
    if (!meta.enabled) {
      return { ok: false, message: `${label} 未启用：请到管理后台「数据接入」勾选启用并保存。`, count: 0 };
    }
    if (!(meta.apiKey || '').trim()) {
      return { ok: false, message: `${label} 缺少 API Key：请在「数据接入」填写后保存。`, count: 0 };
    }
    // 官方开放 API 文档齐备后在此请求 meta.apiBase；当前不伪造数据，避免脏库。
    return {
      ok: false,
      message: `${label} 凭证已保存。官方同步接口接通后将自动拉取 SKU；现可先用「Excel 导入 / 手工录入」。`,
      count: 0,
    };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e), count: 0 };
  }
};
