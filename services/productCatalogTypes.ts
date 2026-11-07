/**
 * 产品库 · 类型与本地存根（小竹熊/霄鸟云同步在管理后台接通）
 */
import { assignBestCategory, idsFromAssignments, assignCategories } from './categoryTaxonomy';
import { TOY_ROOT_ID } from '../data/productTaxonomy';

export type ProductSource = 'manual' | 'toysbear' | 'skybird' | 'ai_redesign' | 'import';

export type CatalogSku = {
  id: string;
  skuCode: string;
  name: string;
  nameEn?: string;
  /** 自由文本品类（展示）；正式匹配请用 categoryIds */
  category?: string;
  /** 官方 L1 品类 ID（与客户 sell/procureCategoryIds 呼应） */
  categoryL1Id?: string;
  /** 官方 L2 品类 ID */
  categoryL2Id?: string;
  /** 全部相关官方品类 ID */
  categoryIds?: string[];
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

/** 根据品名/品类文本挂靠官方类目（录入、导入、同步后统一调用） */
export const ensureSkuTaxonomy = (sku: CatalogSku): CatalogSku => {
  if (sku.categoryL1Id && (sku.categoryIds?.length || 0) > 0) return sku;
  const blob = [sku.category, sku.name, sku.nameEn, sku.specs].filter(Boolean).join(' · ');
  const best = assignBestCategory(blob, { preferRootId: TOY_ROOT_ID });
  if (!best || best.verified === false) return sku;
  const more = assignCategories(blob, 3, { preferRootId: TOY_ROOT_ID });
  const ids = idsFromAssignments(more.length ? more : [best]);
  return {
    ...sku,
    category: sku.category || best.label,
    categoryL1Id: best.l1Id,
    categoryL2Id: best.l2Id,
    categoryIds: ids,
  };
};

const LS = 'trade_scout_product_catalog_v1';

export const loadCatalogSkus = (): CatalogSku[] => {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 旧数据无官方 ID 时惰性回填
    return parsed.map((r: CatalogSku) => ensureSkuTaxonomy(r));
  } catch {
    return [];
  }
};

export const saveCatalogSkus = (rows: CatalogSku[]) => {
  const normalized = rows.map((r) => ensureSkuTaxonomy(r));
  localStorage.setItem(LS, JSON.stringify(normalized));
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
