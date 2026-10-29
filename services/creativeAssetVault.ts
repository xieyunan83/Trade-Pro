/**
 * 创作素材本地库（IndexedDB）
 * - 演示期：图片 / GLB / 视频下载后落本机，不依赖供应商临时外链（常 2h 过期）
 * - localStorage 只存 vault:id 元数据，避免撑爆 5MB 配额
 * - 软上限约 450MB，超出按最久未访问淘汰
 */

export const VAULT_PREFIX = 'vault:';

export type VaultKind = 'image' | 'model3d' | 'video' | 'other';

type VaultMeta = {
  id: string;
  kind: VaultKind;
  mime: string;
  size: number;
  createdAt: number;
  lastAccessAt: number;
  sourceHint?: string;
};

type VaultRow = VaultMeta & { blob: Blob };

const DB_NAME = 'trade_pro_creative_vault_v1';
const DB_VER = 1;
const STORE = 'assets';

/** 演示期软上限：约 450MB，防磁盘/配额溢出 */
export const VAULT_SOFT_QUOTA_BYTES = 450 * 1024 * 1024;
/** 单文件上限：120MB（视频/GLB） */
const MAX_SINGLE_BYTES = 120 * 1024 * 1024;

const objectUrlCache = new Map<string, string>();

const isBrowser = () => typeof indexedDB !== 'undefined';

export const isVaultRef = (url: string | undefined | null): boolean =>
  !!url && url.startsWith(VAULT_PREFIX);

export const vaultIdFromRef = (url: string): string =>
  url.startsWith(VAULT_PREFIX) ? url.slice(VAULT_PREFIX.length) : url;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('lastAccessAt', 'lastAccessAt', { unique: false });
        os.createIndex('kind', 'kind', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('打开素材库失败'));
  });

const idbReq = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 操作失败'));
  });

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const res = await fetch(dataUrl);
  return res.blob();
};

const guessMime = (kind: VaultKind, blobType: string, url: string): string => {
  if (blobType && blobType !== 'application/octet-stream') return blobType;
  if (kind === 'model3d') return 'model/gltf-binary';
  if (kind === 'video') return 'video/mp4';
  if (/\.png(\?|$)/i.test(url)) return 'image/png';
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
  if (/\.jpg|\.jpeg(\?|$)/i.test(url)) return 'image/jpeg';
  if (kind === 'image') return 'image/jpeg';
  return blobType || 'application/octet-stream';
};

export const listVaultMeta = async (): Promise<VaultMeta[]> => {
  if (!isBrowser()) return [];
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const all = await idbReq(tx.objectStore(STORE).getAll());
    return (all as VaultRow[]).map(({ blob: _b, ...m }) => m);
  } finally {
    db.close();
  }
};

export const getVaultStats = async (): Promise<{
  count: number;
  bytes: number;
  quotaBytes: number;
  byKind: Record<string, number>;
}> => {
  const rows = await listVaultMeta();
  const byKind: Record<string, number> = {};
  let bytes = 0;
  for (const r of rows) {
    bytes += r.size || 0;
    byKind[r.kind] = (byKind[r.kind] || 0) + (r.size || 0);
  }
  return { count: rows.length, bytes, quotaBytes: VAULT_SOFT_QUOTA_BYTES, byKind };
};

const putRow = async (row: VaultRow): Promise<void> => {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).put(row));
  } finally {
    db.close();
  }
};

const getRow = async (id: string): Promise<VaultRow | null> => {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const row = (await idbReq(tx.objectStore(STORE).get(id))) as VaultRow | undefined;
    return row || null;
  } finally {
    db.close();
  }
};

const deleteRow = async (id: string): Promise<void> => {
  const cached = objectUrlCache.get(id);
  if (cached) {
    try {
      URL.revokeObjectURL(cached);
    } catch {
      /* ignore */
    }
    objectUrlCache.delete(id);
  }
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
};

/** 超出软上限时淘汰最久未访问的条目，直到腾出空间 */
export const enforceVaultQuota = async (extraBytes = 0): Promise<number> => {
  const stats = await getVaultStats();
  let need = stats.bytes + extraBytes - VAULT_SOFT_QUOTA_BYTES;
  if (need <= 0) return 0;
  const rows = (await listVaultMeta()).sort((a, b) => a.lastAccessAt - b.lastAccessAt);
  let freed = 0;
  let removed = 0;
  for (const r of rows) {
    if (need <= 0) break;
    await deleteRow(r.id);
    freed += r.size;
    need -= r.size;
    removed += 1;
  }
  return removed;
};

export const putBlobInVault = async (opts: {
  blob: Blob;
  kind: VaultKind;
  id?: string;
  sourceHint?: string;
  mime?: string;
}): Promise<string> => {
  if (opts.blob.size > MAX_SINGLE_BYTES) {
    throw new Error(
      `单文件过大（${Math.round(opts.blob.size / 1024 / 1024)}MB），上限 ${MAX_SINGLE_BYTES / 1024 / 1024}MB`
    );
  }
  await enforceVaultQuota(opts.blob.size);
  const id = opts.id || `va_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const mime = opts.mime || opts.blob.type || guessMime(opts.kind, '', '');
  await putRow({
    id,
    kind: opts.kind,
    mime,
    size: opts.blob.size,
    createdAt: now,
    lastAccessAt: now,
    sourceHint: opts.sourceHint?.slice(0, 200),
    blob: opts.blob.type ? opts.blob : new Blob([opts.blob], { type: mime }),
  });
  return `${VAULT_PREFIX}${id}`;
};

/**
 * 把远程临时链 / dataURL 拉取进本地库，返回 vault:id。
 * 已是 vault: 则原样返回；失败时抛错（调用方可保留原 URL）。
 */
export const persistMediaUrl = async (
  url: string,
  kind: VaultKind,
  sourceHint?: string
): Promise<string> => {
  const raw = (url || '').trim();
  if (!raw) return raw;
  if (isVaultRef(raw)) return raw;

  let blob: Blob;
  if (raw.startsWith('data:')) {
    blob = await dataUrlToBlob(raw);
  } else if (/^https?:\/\//i.test(raw)) {
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`拉取素材失败 HTTP ${res.status}`);
    blob = await res.blob();
  } else if (raw.startsWith('blob:')) {
    const res = await fetch(raw);
    blob = await res.blob();
  } else {
    throw new Error('无法识别的素材地址');
  }

  const mime = guessMime(kind, blob.type, raw);
  return putBlobInVault({
    blob: blob.type ? blob : new Blob([blob], { type: mime }),
    kind,
    sourceHint: sourceHint || raw.slice(0, 120),
    mime,
  });
};

/** 尝试落库；失败返回原 URL（不阻断主流程） */
export const tryPersistMediaUrl = async (
  url: string,
  kind: VaultKind,
  sourceHint?: string
): Promise<string> => {
  try {
    return await persistMediaUrl(url, kind, sourceHint);
  } catch (e) {
    console.warn('[creativeAssetVault] persist failed', e);
    return url;
  }
};

/** vault: → blob:；其它原样。会刷新 lastAccessAt */
export const resolveMediaUrl = async (url: string | undefined | null): Promise<string> => {
  const raw = (url || '').trim();
  if (!raw) return '';
  if (!isVaultRef(raw)) return raw;
  const id = vaultIdFromRef(raw);
  const cached = objectUrlCache.get(id);
  if (cached) {
    void touchAccess(id);
    return cached;
  }
  const row = await getRow(id);
  if (!row?.blob) return '';
  void touchAccess(id);
  const obj = URL.createObjectURL(row.blob);
  objectUrlCache.set(id, obj);
  return obj;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });

/**
 * 供上游 API 上传：vault: / blob: → data:image；http(s) / oss: / data: 原样。
 * 避免「参考图须为本地上传或 HTTPS」因本机 vault 引用失败。
 */
export const resolveToUploadableImage = async (url: string): Promise<string> => {
  const raw = (url || '').trim();
  if (!raw) throw new Error('参考图为空');
  if (raw.startsWith('data:image/')) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^oss:\/\//i.test(raw)) return raw;

  if (isVaultRef(raw)) {
    const id = vaultIdFromRef(raw);
    const row = await getRow(id);
    if (!row?.blob) throw new Error('本地素材库中找不到该参考图，请重新选择或上传');
    void touchAccess(id);
    const dataUrl = await blobToDataUrl(row.blob);
    if (!dataUrl.startsWith('data:image/')) {
      throw new Error('参考图不是可用的图片格式');
    }
    return dataUrl;
  }

  if (raw.startsWith('blob:')) {
    const res = await fetch(raw);
    if (!res.ok) throw new Error('读取本地参考图失败');
    const dataUrl = await blobToDataUrl(await res.blob());
    if (!dataUrl.startsWith('data:image/')) {
      throw new Error('参考图不是可用的图片格式');
    }
    return dataUrl;
  }

  throw new Error('参考图须为本地上传图片或公网 HTTPS 地址');
};

/** 同 resolveToUploadableImage；空串返回 ''，便于生图参考链 */
export const resolveToDataUrlOrHttps = async (
  url: string | undefined | null
): Promise<string> => {
  const raw = (url || '').trim();
  if (!raw) return '';
  return resolveToUploadableImage(raw);
};

const touchAccess = async (id: string) => {
  try {
    const row = await getRow(id);
    if (!row) return;
    row.lastAccessAt = Date.now();
    await putRow(row);
  } catch {
    /* ignore */
  }
};

export const resolveMediaUrls = async (
  urls: Array<string | undefined | null>
): Promise<string[]> => {
  const out: string[] = [];
  for (const u of urls) out.push(await resolveMediaUrl(u));
  return out;
};

/** 清空全部本地素材（管理员紧急清理） */
export const clearVault = async (): Promise<void> => {
  for (const [, obj] of objectUrlCache) {
    try {
      URL.revokeObjectURL(obj);
    } catch {
      /* ignore */
    }
  }
  objectUrlCache.clear();
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).clear());
  } finally {
    db.close();
  }
};

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
