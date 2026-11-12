/**
 * 空闲 / 悬停 / 进板块时预拉取模块 chunk，切换时接近零等待。
 * 全部走 idle 调度，禁止抢点击主线程。
 */
import { ModuleType } from '../types';
import {
  PLATFORM_SECTIONS,
  type PlatformSectionId,
} from './platformSections';
import { hardReloadApp, isChunkLoadError } from '../utils/lazyWithRetry';

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
const inflight = new Set<ModuleType>();

const runIdle = (fn: () => void, timeout = 2_500): void => {
  if (typeof window === 'undefined') return;
  const ric = window.requestIdleCallback;
  if (typeof ric === 'function') {
    ric(() => fn(), { timeout });
  } else {
    window.setTimeout(fn, 120);
  }
};

/** 悬停 / 焦点：立刻排队预取（仍不阻塞当前点击） */
export const prefetchModule = (mod: ModuleType): void => {
  if (!mod || warmed.has(mod) || inflight.has(mod)) return;
  const load = loaders[mod];
  if (!load) return;
  inflight.add(mod);
  runIdle(() => {
    void load()
      .then(() => {
        warmed.add(mod);
      })
      .catch((err) => {
        if (typeof window !== 'undefined' && isChunkLoadError(err)) {
          const flag = 'tp_chunk_reload_prefetch';
          if (!sessionStorage.getItem(flag)) {
            sessionStorage.setItem(flag, '1');
            hardReloadApp();
          }
        }
      })
      .finally(() => {
        inflight.delete(mod);
      });
  }, 1_500);
};

/** 进入某板块：阶梯预热该板块全部可加载子模块 */
export const prefetchSection = (sectionId: PlatformSectionId | null | undefined): void => {
  if (!sectionId) return;
  const sec = PLATFORM_SECTIONS.find((s) => s.id === sectionId);
  if (!sec) return;
  const mods = sec.items.filter((it) => !it.comingSoon && loaders[it.id]).map((it) => it.id);
  let i = 0;
  const step = () => {
    if (i >= mods.length) return;
    prefetchModule(mods[i++]);
    window.setTimeout(step, 280);
  };
  runIdle(step, 3_000);
};

/**
 * 进站后阶梯预热高频模块，再扫一遍其余。
 * 禁止进站前几秒抢主线程。
 */
export const prefetchCoreModules = (): void => {
  const hot: ModuleType[] = [
    ModuleType.DISCOVERY,
    ModuleType.CLIENT_CRM,
    ModuleType.PROMO_GENERATOR,
    ModuleType.PRODUCT_CATALOG,
    ModuleType.PRODUCT_MATCH,
    ModuleType.EMAIL_CAMPAIGN,
  ];
  const rest = (Object.keys(loaders) as ModuleType[]).filter((m) => !hot.includes(m));

  const runQueue = (mods: ModuleType[], gapMs: number, done?: () => void) => {
    let i = 0;
    const step = () => {
      if (i >= mods.length) {
        done?.();
        return;
      }
      prefetchModule(mods[i++]);
      window.setTimeout(step, gapMs);
    };
    step();
  };

  window.setTimeout(() => {
    runIdle(() => {
      runQueue(hot, 450, () => {
        runIdle(() => runQueue(rest, 700), 8_000);
      });
    }, 12_000);
  }, 2_500);
};

export const isModulePrefetched = (mod: ModuleType): boolean => warmed.has(mod);
