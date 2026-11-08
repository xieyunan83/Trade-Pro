/**
 * 产品库 · 类型与本地存根（小竹熊/霄鸟云同步在管理后台接通）
 */
import { assignBestCategory, idsFromAssignments, assignCategories } from './categoryTaxonomy';
import {
  formatTaxonomyLabel,
  PRODUCT_TAXONOMY_BY_ID,
  resolveLegacyCategoryId,
  TOY_ROOT_ID,
} from '../data/productTaxonomy';

export type ProductSource = 'manual' | 'toysbear' | 'skybird' | 'ai_redesign' | 'import';

export type CatalogSku = {
  id: string;
  skuCode: string;
  name: string;
  nameEn?: string;
  /** 自由文本品类（展示）；正式匹配请用 categoryIds */
  category?: string;
  /** 官方大类 ID */
  categoryRootId?: string;
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

/** 已显式选定官方一级/二级时，规范化 ID 链（信任人工/Excel 选择） */
export const applyExplicitSkuTaxonomy = (sku: CatalogSku): CatalogSku => {
  let l2Id = resolveLegacyCategoryId(sku.categoryL2Id) || sku.categoryL2Id;
  let l1Id = resolveLegacyCategoryId(sku.categoryL1Id) || sku.categoryL1Id;
  if (l2Id && PRODUCT_TAXONOMY_BY_ID[l2Id]) {
    const l2 = PRODUCT_TAXONOMY_BY_ID[l2Id];
    if (l2.level === 2) l1Id = l1Id || l2.parentId || undefined;
  }
  if (l1Id && !PRODUCT_TAXONOMY_BY_ID[l1Id]) l1Id = undefined;
  if (l2Id && !PRODUCT_TAXONOMY_BY_ID[l2Id]) l2Id = undefined;
  const l1Node = l1Id ? PRODUCT_TAXONOMY_BY_ID[l1Id] : undefined;
  const rootId =
    resolveLegacyCategoryId(sku.categoryRootId) ||
    sku.categoryRootId ||
    l1Node?.parentId ||
    (l1Node?.rootId) ||
    undefined;
  if (!l1Id && !l2Id) return sku;
  const ids = [...new Set([rootId, l1Id, l2Id, ...(sku.categoryIds || [])].filter(Boolean))] as string[];
  return {
    ...sku,
    categoryRootId: rootId,
    categoryL1Id: l1Id,
    categoryL2Id: l2Id,
    categoryIds: ids,
    category: sku.category || formatTaxonomyLabel(l2Id || l1Id) || sku.category,
  };
};

/** 是否已具备可精准匹配的官方类目（一级 + 二级小类均需） */
export const skuHasOfficialTaxonomy = (
  sku: Pick<CatalogSku, 'categoryL1Id' | 'categoryL2Id' | 'categoryIds'>
): boolean => {
  if (sku.categoryL2Id && PRODUCT_TAXONOMY_BY_ID[sku.categoryL2Id]?.level === 2) {
    return true;
  }
  // categoryIds 中含二级节点亦可
  return (sku.categoryIds || []).some((id) => PRODUCT_TAXONOMY_BY_ID[id]?.level === 2);
};

/** 根据品名/品类文本挂靠官方类目（录入、导入、同步后统一调用） */
export const ensureSkuTaxonomy = (sku: CatalogSku): CatalogSku => {
  if (sku.categoryL1Id || sku.categoryL2Id) return applyExplicitSkuTaxonomy(sku);
  const blob = [sku.category, sku.name, sku.nameEn, sku.specs].filter(Boolean).join(' · ');
  const best = assignBestCategory(blob, { preferRootId: sku.categoryRootId || TOY_ROOT_ID });
  if (!best || best.verified === false) return sku;
  const more = assignCategories(blob, 3, { preferRootId: sku.categoryRootId || TOY_ROOT_ID });
  const ids = idsFromAssignments(more.length ? more : [best]);
  return {
    ...sku,
    category: sku.category || best.label,
    categoryRootId: best.rootId || sku.categoryRootId,
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
