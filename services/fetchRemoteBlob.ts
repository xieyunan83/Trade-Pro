/**
 * 带进度/超时的远程文件拉取（XHR），供 3D GLB 预览与本机落库。
 * 与 fetch 一样受 CORS 约束；失败时调用方应引导用户用 <a download> 直链下载。
 */
export const fetchRemoteBlob = (
  url: string,
  opts?: {
    timeoutMs?: number;
    onProgress?: (pct: number) => void;
  }
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const raw = (url || '').trim();
    if (!raw) {
      reject(new Error('地址为空'));
      return;
    }
    if (raw.startsWith('blob:') || raw.startsWith('data:')) {
      void fetch(raw)
        .then((r) => r.blob())
        .then(resolve)
        .catch((e) => reject(e));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('GET', raw, true);
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
      }
    };
    xhr.send();
  });
