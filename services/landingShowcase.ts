/**
 * 今日看板 · 新品推荐
 * - 优先展示「产品库」中本机已补图的 SKU（dataURL / 可用链接）
 * - 其次合并着陆接口带图条目
 * - 过滤已知易裂外链，避免演示裂图
 */
import type { LandingProductItem, LandingProductSpec } from './landingDataCore';
import { loadCatalogSkus } from './productCatalogTypes';

/** 已清空：不再用失效外链样本硬凑 */
export const LANDING_SHOWCASE_PRODUCTS: LandingProductItem[] = [];

const isUsableImage = (img: string | undefined | null): boolean => {
  const s = (img || '').trim();
  if (!s) return false;
  if (/toysbear\.net|xiaozhuxiong|skybird/i.test(s)) return false;
  return (
    /^https?:\/\//i.test(s) ||
    s.startsWith('data:') ||
    s.startsWith('blob:') ||
    s.startsWith('vault:')
  );
};

/** 产品库带图 SKU → 看板新品卡片 */
export const catalogSkusAsLandingProducts = (): LandingProductItem[] => {
  try {
    return loadCatalogSkus()
      .filter((s) => (s.name || s.nameEn || '').trim() && (s.images || []).some(isUsableImage))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((s) => {
        const image = (s.images || []).find(isUsableImage)!;
        const specs: LandingProductSpec[] = [];
        if (s.category) specs.push({ label: '品类', value: s.category });
        if (s.moq != null) specs.push({ label: 'MOQ', value: String(s.moq) });
        if (s.factoryPrice != null) {
          specs.push({ label: '价', value: `${s.currency || 'USD'} ${s.factoryPrice}` });
        }
        return {
          id: `catalog-${s.id}`,
          title: (s.nameEn || s.name).trim(),
          image,
          source: '产品库',
          specs: specs.slice(0, 3),
        };
      });
  } catch {
    return [];
  }
};

const filterLandingItems = (
  items: LandingProductItem[] | undefined | null
): LandingProductItem[] =>
  (items || [])
    .filter((p) => (p.title || '').trim() && isUsableImage(p.image))
    .map((p) => ({ ...p, image: (p.image || '').trim() }));

/**
 * 合并产品库带图 SKU + 接口新品；产品库优先（用户刚补的图要立刻能看见）
 */
export const withShowcaseProducts = (
  items: LandingProductItem[] | undefined | null
): LandingProductItem[] => {
  const fromCatalog = catalogSkusAsLandingProducts();
  const fromApi = filterLandingItems(items);
  const seen = new Set<string>();
  const merged: LandingProductItem[] = [];
  for (const p of [...fromCatalog, ...fromApi]) {
    const key = `${p.title.trim().toLowerCase()}|${(p.image || '').slice(0, 48)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
    if (merged.length >= 12) break;
  }
  return merged;
};
