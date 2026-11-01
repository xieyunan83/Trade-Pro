/**
 * 带进度/超时的远程文件拉取（XHR），供 3D GLB 预览与本机落库。
 * 同 URL 会话内只拉一次（单飞 + 内存缓存），避免预览与落库各下一遍。
 */

type FetchOpts = {
  timeoutMs?: number;
  onProgress?: (pct: number) => void;
};

const blobCache = new Map<string, Blob>();
const inflight = new Map<string, Promise<Blob>>();

const cacheKey = (url: string) => (url || '').trim();

/** 预览成功后可主动写入，供随后 persist 复用 */
export const rememberRemoteBlob = (url: string, blob: Blob) => {
  const key = cacheKey(url);
  if (!key || !blob || key.startsWith('blob:') || key.startsWith('data:')) return;
  blobCache.set(key, blob);
};

export const peekRemoteBlob = (url: string): Blob | undefined => blobCache.get(cacheKey(url));

const xhrFetch = (url: string, opts?: FetchOpts): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.timeout = opts?.timeoutMs ?? 180_000;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
        opts?.onProgress?.(100);
        resolve(xhr.response as Blob);
        return;
      }
      reject(new Error(`下载失败 HTTP ${xhr.status || 0}`));
    };
    xhr.onerror = () => reject(new Error('下载失败（网络或跨域限制）'));
    xhr.ontimeout = () =>
      reject(new Error(`下载超时（${Math.round((opts?.timeoutMs ?? 180_000) / 1000)} 秒）`));
    xhr.onprogress = (e) => {
      if (!opts?.onProgress) return;
      if (e.lengthComputable && e.total > 0) {
        opts.onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      } else if (e.loaded > 0) {
        // 无 Content-Length 时给不确定进度，避免一直 0%
        opts.onProgress(Math.min(90, 10 + Math.round(e.loaded / (512 * 1024))));
      }
    };
    xhr.send();
  });

export const fetchRemoteBlob = (url: string, opts?: FetchOpts): Promise<Blob> => {
  const raw = cacheKey(url);
  if (!raw) {
    return Promise.reject(new Error('地址为空'));
  }
  if (raw.startsWith('blob:') || raw.startsWith('data:')) {
    return fetch(raw).then((r) => r.blob());
  }

  const cached = blobCache.get(raw);
  if (cached) {
    opts?.onProgress?.(100);
    return Promise.resolve(cached);
  }

  const existing = inflight.get(raw);
  if (existing) {
    return existing.then((blob) => {
      opts?.onProgress?.(100);
      return blob;
    });
  }

  const task = xhrFetch(raw, opts)
    .then((blob) => {
      blobCache.set(raw, blob);
      inflight.delete(raw);
      return blob;
    })
    .catch((err) => {
      inflight.delete(raw);
      throw err;
    });

  inflight.set(raw, task);
  return task;
};
