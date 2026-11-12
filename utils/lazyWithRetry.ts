import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const isChunkLoadError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  return /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError|Importing a module script failed|timeout|超时/i.test(
    msg
  );
};

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

/**
 * 部署后旧标签页会引用已删除的 hash chunk → 动态 import 404。
 * 自动强刷一次（session 内最多一次）。
 * 禁止返回永不 resolve 的 Promise 却未真正刷新——Electron 若 reload 无效会整页永久「片刻…」。
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  chunkKey = 'lazy'
): LazyExoticComponent<T> {
  return lazy(async () => {
    const load = () => withTimeout(factory(), 28_000, chunkKey);
    try {
      return await load();
    } catch (err) {
      if (typeof window !== 'undefined' && isChunkLoadError(err)) {
        const flag = `tp_chunk_reload_${chunkKey}`;
        if (!sessionStorage.getItem(flag)) {
          sessionStorage.setItem(flag, '1');
          try {
            const url = new URL(window.location.href);
            url.searchParams.set('_boot', String(Date.now()));
            window.location.replace(url.toString());
          } catch {
            window.location.reload();
          }
          // 给导航一点时间；超时后仍抛错，避免 Suspense 永久挂起拖死其它模块
          await new Promise((r) => window.setTimeout(r, 4_000));
          throw err;
        }
      }
      throw err;
    }
  });
}

export { isChunkLoadError };
