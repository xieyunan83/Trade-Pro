/**
 * 空闲 / 悬停时预拉取模块 chunk，切换时几乎零等待。
 */
import { ModuleType } from '../types';

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
  void load().catch(() => {
    warmed.delete(mod);
  });
};

/** 登录页 / 进入工作台后预热高频模块 */
export const prefetchCoreModules = (): void => {
  const run = () => {
    (
      [
        ModuleType.DISCOVERY,
        ModuleType.CLIENT_CRM,
        ModuleType.PROMO_GENERATOR,
        ModuleType.PRODUCT_CATALOG,
        ModuleType.PRODUCT_DESIGN_2D,
        ModuleType.PRODUCT_MATCH,
      ] as ModuleType[]
    ).forEach(prefetchModule);
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => run(), { timeout: 2500 });
  } else {
    setTimeout(run, 400);
  }
};
