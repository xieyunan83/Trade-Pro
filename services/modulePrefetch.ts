/**
 * 空闲 / 悬停时预拉取模块 chunk，切换时几乎零等待。
 */
import { ModuleType } from '../types';
import { isChunkLoadError } from '../utils/lazyWithRetry';

const loaders: Partial<Record<ModuleType, () => Promise<unknown>>> = {
  [ModuleType.DISCOVERY]: () => import('../components/ClientFinder'),
  [ModuleType.CLIENT_CRM]: () => import('../components/ModuleClientCRM'),
  [ModuleType.PRODUCT_MATCH]: () => import('../components/ModuleProductMatch'),
  [ModuleType.EMAIL_CAMPAIGN]: () => import('../components/ModuleEmailCampaign'),
  [ModuleType.IMAGE_GENERATOR]: () => import('../components/ModuleImageGenerator'),
  [ModuleType.PRODUCT_CATALOG]: () => import('../components/ModuleProductCatalog'),
  [ModuleType.PRODUCT_QUOTE]: () => import('../components/ModuleProductQuote'),
  [ModuleType.PRODUCT_DESIGN_2D]: () => import('../components/ModuleProductDesign2D'),
  [ModuleType.PRODUCT_DESIGN_3D]: () => import('../components/ModuleProductDesign3D'),
  [ModuleType.PRODUCT_AI_VIDEO]: () => import('../components/ModuleProductAiVideo'),
  [ModuleType.PRODUCT_PACKAGING]: () => import('../components/ModuleProductPackaging'),
  [ModuleType.SITE_BUILDER]: () => import('../components/ModuleSiteBuilder'),
  [ModuleType.SOCIAL_CONTENT]: () => import('../components/ModuleSocialContent'),
  [ModuleType.WHATSAPP]: () => import('../components/ModuleContactTools'),
  [ModuleType.PROMO_GENERATOR]: () => import('../components/ModulePromoGenerator'),
};

const warmed = new Set<ModuleType>();

export const prefetchModule = (mod: ModuleType): void => {
  if (warmed.has(mod)) return;
  const load = loaders[mod];
  if (!load) return;
  warmed.add(mod);
  void load().catch((err) => {
    warmed.delete(mod);
    if (typeof window !== 'undefined' && isChunkLoadError(err)) {
      const flag = 'tp_chunk_reload_prefetch';
      if (!sessionStorage.getItem(flag)) {
        sessionStorage.setItem(flag, '1');
        window.location.reload();
      }
    }
  });
};

/** 进入工作台后很晚再预热；禁止进站前几秒抢主线程 */
export const prefetchCoreModules = (): void => {
  const run = () => {
    const mods: ModuleType[] = [
      ModuleType.DISCOVERY,
      ModuleType.CLIENT_CRM,
      ModuleType.PROMO_GENERATOR,
    ];
    let i = 0;
    const step = () => {
      if (i >= mods.length) return;
      prefetchModule(mods[i++]);
      window.setTimeout(step, 800);
    };
    step();
  };
  // 进站至少 6 秒后再预热，把 CPU 留给菜单点击
  window.setTimeout(() => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => run(), { timeout: 20_000 });
    } else {
      run();
    }
  }, 6000);
};
