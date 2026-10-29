import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const isChunkLoadError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  return /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError|Importing a module script failed/i.test(
    msg
  );
};

/**
 * 部署后旧标签页会引用已删除的 hash chunk → 动态 import 404。
 * 自动强刷一次（session 内最多一次），避免视频等懒加载模块打不开。
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  chunkKey = 'lazy'
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (typeof window !== 'undefined' && isChunkLoadError(err)) {
        const flag = `tp_chunk_reload_${chunkKey}`;
        if (!sessionStorage.getItem(flag)) {
          sessionStorage.setItem(flag, '1');
          window.location.reload();
          // 挂起直到刷新，避免再抛到 ErrorBoundary 闪一下
          return new Promise(() => undefined) as Promise<{ default: T }>;
        }
      }
      throw err;
    }
  });
}

export { isChunkLoadError };
