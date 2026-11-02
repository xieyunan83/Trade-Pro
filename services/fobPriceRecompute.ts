/**
 * 全库 FOB 重算：按「出口 FOB ≈ 零售 × 0.2」改写历史 products 与产品画像。
 * 用 migrationKey 做一次性迁移；公式版本变更时递增即可再次全量跑。
 */
import type { HistoryItem, ProductAnalysis } from '../types';
import {
  FOB_OVER_RETAIL,
  applyEstimatedFobFromRetail,
  estimateFobCnyFromRetailCny,
  resolveRetailPriceCny,
} from './tradePricingTheory';

const LS_KEY = 'trade_scout_fob_migration';

export const getFobMigrationKey = () => FOB_OVER_RETAIL.migrationKey;

export const isFobMigrationDone = (): boolean => {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(LS_KEY) === FOB_OVER_RETAIL.migrationKey
    );
  } catch {
    return false;
  }
};

const markFobMigrationDone = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_KEY, FOB_OVER_RETAIL.migrationKey);
    }
  } catch {
    /* ignore */
  }
};

const productNeedsFobRewrite = (p: ProductAnalysis): boolean => {
  const retailCny = resolveRetailPriceCny(p);
  if (!(retailCny > 0)) return (p.estimatedFOBPriceCNY || 0) > 0;
  return (p.estimatedFOBPriceCNY || 0) !== estimateFobCnyFromRetailCny(retailCny);
};

export const rewriteProductFob = (p: ProductAnalysis): ProductAnalysis =>
  applyEstimatedFobFromRetail(p);

export type FobRecomputeResult = {
  skipped: boolean;
  historyTouched: number;
  productsTouched: number;
};

/**
 * 重算本地历史里所有有零售价的 SKU 的 estimatedFOBPriceCNY，并 force 重建产品画像。
 */
export const recomputeAllStoredFobPrices = async (opts?: {
  history?: HistoryItem[];
  force?: boolean;
  onHistoryUpdated?: (items: HistoryItem[]) => void;
}): Promise<FobRecomputeResult> => {
  if (!opts?.force && isFobMigrationDone()) {
    return { skipped: true, historyTouched: 0, productsTouched: 0 };
  }

  const { getHistory, saveHistoryBulk } = await import('./db');
  const history = opts?.history ?? (await getHistory());
  const dirty: HistoryItem[] = [];
  const nextAll: HistoryItem[] = [];
  let historyTouched = 0;
  let productsTouched = 0;

  for (const h of history) {
    const products = h?.data?.products;
    if (!Array.isArray(products) || !products.length) {
      nextAll.push(h);
      continue;
    }

    let changed = false;
    const nextProducts = products.map((p) => {
      if (!productNeedsFobRewrite(p)) return p;
      const next = rewriteProductFob(p);
      if (next.estimatedFOBPriceCNY !== p.estimatedFOBPriceCNY || next.retailPriceCNY !== p.retailPriceCNY) {
        changed = true;
        productsTouched += 1;
      }
      return next;
    });

    if (changed) {
      historyTouched += 1;
      const item: HistoryItem = {
        ...h,
        data: { ...h.data, products: nextProducts },
      };
      dirty.push(item);
      nextAll.push(item);
    } else {
      nextAll.push(h);
    }
  }

  if (dirty.length) {
    await saveHistoryBulk(dirty);
    opts?.onHistoryUpdated?.(nextAll);
  }

  try {
    const { rebuildProductCatalogFromHistory } = await import('./productCatalog');
    await rebuildProductCatalogFromHistory(nextAll, { force: true });
  } catch (e) {
    console.warn('[fobPriceRecompute] catalog rebuild failed', e);
  }

  markFobMigrationDone();
  return { skipped: false, historyTouched, productsTouched };
};
