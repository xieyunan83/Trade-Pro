/**
 * 今日看板 · 新品推荐
 * 演示期停用外链展区图（多源失效导致裂图）；仅展示接口返回且带图的真实条目。
 */
import type { LandingProductItem } from './landingDataCore';

/** 已清空：避免失效外链影响演示 */
export const LANDING_SHOWCASE_PRODUCTS: LandingProductItem[] = [];

/** 只保留带有效图片的条目；无图则不硬凑展示样本 */
export const withShowcaseProducts = (
  items: LandingProductItem[] | undefined | null
): LandingProductItem[] => {
  const list = (items || []).filter((p) => (p.title || '').trim());
  const withImg = list.filter((p) => {
    const img = (p.image || '').trim();
    if (!img) return false;
    // 停用已知易裂外链域，演示期不展示
    if (/toysbear\.net|xiaozhuxiong|skybird/i.test(img)) return false;
    return /^https?:\/\//i.test(img) || img.startsWith('data:') || img.startsWith('blob:');
  });
  return withImg.slice(0, 12);
};
