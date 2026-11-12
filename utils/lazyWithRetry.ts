import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** 体积较大的模块：弱网下需要更长加载窗 */
const HEAVY_CHUNK_MS: Record<string, number> = {
  design3d: 60_000,
  design2d: 45_000,
  aivideo: 45_000,
  packaging: 45_000,
  match: 40_000,
  email: 40_000,
  catalog: 40_000,
};

export const isChunkTimeoutError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  return /模块加载超时|timeout/i.test(msg);
};

export const isChunkLoadError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  return /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError|Importing a module script failed/i.test(
    msg
  );
};

/** 超时或 chunk 拉取失败，都适合引导用户强刷 / 重试 */
export const isModuleLoadRecoverableError = (err: unknown): boolean =>
  isChunkLoadError(err) || isChunkTimeoutError(err);

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`模块加载超时（${Math.round(ms / 1000)}s）：${label}`));
    }, ms);
    promise.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      }
    );
  });

/** 桌面端清缓存硬刷新；浏览器则带 _boot 强刷 */
export const hardReloadApp = (): void => {
  if (typeof window === 'undefined') return;
  try {
    const desktop = window.bwDesktop;
    if (typeof desktop?.hardRefresh === 'function') {
      desktop.hardRefresh();
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_boot', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
};

/**
 * 部署后旧标签页会引用已删除的 hash chunk → 动态 import 404。
 * 自动强刷一次（session 内最多一次）。大模块单独加长超时。
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  chunkKey = 'lazy'
): LazyExoticComponent<T> {
  return lazy(async () => {
    const budget = HEAVY_CHUNK_MS[chunkKey] ?? 35_000;
    const load = () => withTimeout(factory(), budget, chunkKey);
    try {
      return await load();
    } catch (err) {
      if (typeof window !== 'undefined' && isModuleLoadRecoverableError(err)) {
        const flag = `tp_chunk_reload_${chunkKey}`;
        if (!sessionStorage.getItem(flag)) {
          sessionStorage.setItem(flag, '1');
          hardReloadApp();
          // 给导航一点时间；超时后仍抛错，避免 Suspense 永久挂起
          await new Promise((r) => window.setTimeout(r, 4_000));
          throw err;
        }
      }
      throw err;
    }
  });
}
