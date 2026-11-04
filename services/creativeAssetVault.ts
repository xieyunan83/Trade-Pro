/**
 * 创作素材本地库（IndexedDB）
 * - 图片 / GLB / 视频下载后落本机，不依赖供应商临时外链（常 2h 过期）
 * - localStorage 只存 vault:id 元数据，避免撑爆 5MB 配额
 * - 本机库不设总容量软上限；仅单文件有上限。清理请用界面「清空」或浏览器 IndexedDB。
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

/** 浏览器 / 桌面客户端 IndexedDB 库名（开发者工具 → Application → IndexedDB） */
export const VAULT_DB_NAME = 'trade_pro_creative_vault_v1';
const DB_NAME = VAULT_DB_NAME;
const DB_VER = 1;
const STORE = 'assets';
/** 仅存元数据，避免 list/配额扫描时 getAll() 把全部 GLB blob 拖进内存 */
export const VAULT_META_LS = 'trade_pro_creative_vault_meta_v1';
const META_LS = VAULT_META_LS;

/**
 * 展示用参考容量（仅用于进度条比例，不再作为淘汰阈值）。
 * 本机素材总库不强制限额。
 */
export const VAULT_SOFT_QUOTA_BYTES = 0;
/** 单文件上限：200MB（视频/GLB） */
const MAX_SINGLE_BYTES = 200 * 1024 * 1024;

const objectUrlCache = new Map<string, string>();
let metaMemory: VaultMeta[] | null = null;

const isBrowser = () => typeof indexedDB !== 'undefined';

const readMetaLs = (): VaultMeta[] | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(META_LS);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as VaultMeta[]) : null;
  } catch {
    return null;
  }
};

const writeMetaLs = (rows: VaultMeta[]) => {
  metaMemory = rows;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(META_LS, JSON.stringify(rows));
  } catch {
    /* quota */
  }
};

const upsertMeta = (m: VaultMeta) => {
  const rows = metaMemory || readMetaLs() || [];
  const next = rows.filter((r) => r.id !== m.id);
  next.push(m);
  writeMetaLs(next);
};

const removeMeta = (id: string) => {
  const rows = metaMemory || readMetaLs() || [];
  writeMetaLs(rows.filter((r) => r.id !== id));
};

export const isVaultRef = (url: string | undefined | null): boolean =>
  !!url && url.startsWith(VAULT_PREFIX);

export const vaultIdFromRef = (url: string): string =>
  url.startsWith(VAULT_PREFIX) ? url.slice(VAULT_PREFIX.length) : url;

/** 3D 任务本机网格的稳定 ID（与任务 id 绑定，刷新后可回挂） */
export const model3dVaultIdForJob = (jobId: string): string => `mesh_${jobId}`;

/**
 * 按任务回挂本机 GLB：优先 mesh_${jobId}，再按 sourceHint / taskId 匹配。
 * 用于远程临时链 403 过期后，仍能预览/下载已缓存文件。
 */
export const findModel3dVaultRefForJob = async (job: {
  id: string;
  providerTaskId?: string;
  sourceTaskId?: string;
  modelUrl?: string;
  pbrModelUrl?: string;
  baseModelUrl?: string;
}): Promise<string | null> => {
  const primaryId = model3dVaultIdForJob(job.id);
  const primary = await getRow(primaryId);
  if (primary?.blob) {
    void touchAccess(primaryId);
    return `${VAULT_PREFIX}${primaryId}`;
  }

  const hints = [job.providerTaskId, job.sourceTaskId, job.id]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  const remotes = [job.modelUrl, job.pbrModelUrl, job.baseModelUrl]
    .map((s) => (s || '').trim())
    .filter((s) => /^https?:\/\//i.test(s));

  const meta = await listVaultMeta();
  const models = meta.filter((m) => m.kind === 'model3d');
  const scored = models
    .map((m) => {
      const bag = `${m.id} ${m.sourceHint || ''}`;
      let score = 0;
      if (hints.some((h) => bag.includes(h))) score += 10;
      for (const r of remotes) {
        const head = r.slice(0, 96);
        if (m.sourceHint && (m.sourceHint.includes(head) || r.includes(m.sourceHint.slice(0, 96)))) {
          score += 8;
        }
      }
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.m.lastAccessAt - a.m.lastAccessAt);

  for (const { m } of scored) {
    const row = await getRow(m.id);
    if (row?.blob) {
      void touchAccess(m.id);
      return `${VAULT_PREFIX}${m.id}`;
    }
  }
  return null;
};

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
  if (metaMemory) return metaMemory.map((m) => ({ ...m }));
  const fromLs = readMetaLs();
  if (fromLs) {
    metaMemory = fromLs;
    return fromLs.map((m) => ({ ...m }));
  }
  // 冷启动重建索引（只此一次会扫 blob；之后走 LS）
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const all = await idbReq(tx.objectStore(STORE).getAll());
    const meta = (all as VaultRow[]).map(({ blob: _b, ...m }) => m);
    writeMetaLs(meta);
    return meta.map((m) => ({ ...m }));
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
  return { count: rows.length, bytes, quotaBytes: 0, byKind };
};

const putRow = async (row: VaultRow): Promise<void> => {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).put(row));
    const { blob: _b, ...meta } = row;
    upsertMeta(meta);
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
    removeMeta(id);
  } finally {
    db.close();
  }
};

/**
 * 兼容旧调用：本机库已取消总容量软上限，默认不淘汰。
 * 若传入 targetFreeBytes>0，则按最久未访问删除，直到腾出约该字节数（手动「清理旧文件」用）。
 */
export const enforceVaultQuota = async (targetFreeBytes = 0): Promise<number> => {
  if (!targetFreeBytes || targetFreeBytes <= 0) return 0;
  const rows = await listVaultMeta();
  const sorted = [...rows].sort((a, b) => a.lastAccessAt - b.lastAccessAt);
  let need = targetFreeBytes;
  let removed = 0;
  for (const r of sorted) {
    if (need <= 0) break;
    await deleteRow(r.id);
    need -= r.size || 0;
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
  // 不再因总库软上限自动删旧文件
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

const fetchBlobWithTimeout = async (url: string, timeoutMs: number): Promise<Blob> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`拉取素材失败 HTTP ${res.status}`);
    return await res.blob();
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(`拉取素材超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

const persistTimeoutMs = (kind: VaultKind): number => {
  if (kind === 'model3d') return 180_000;
  if (kind === 'video') return 120_000;
  return 30_000;
};

/**
 * 把远程临时链 / dataURL 拉取进本地库，返回 vault:id。
 * 已是 vault: 则原样返回；失败时抛错（调用方可保留原 URL）。
 * 远程拉取带超时，避免 3D GLB 永久卡住「生成中 100%」。
 */
export const persistMediaUrl = async (
  url: string,
  kind: VaultKind,
  sourceHint?: string,
  opts?: { id?: string }
): Promise<string> => {
  const raw = (url || '').trim();
  if (!raw) return raw;
  if (isVaultRef(raw)) return raw;

  let blob: Blob;
  if (raw.startsWith('data:')) {
    blob = await dataUrlToBlob(raw);
  } else if (raw.startsWith('blob:')) {
    blob = await fetchBlobWithTimeout(raw, persistTimeoutMs(kind));
  } else if (/^https?:\/\//i.test(raw)) {
    // 大 GLB 用 XHR（超时更长）；失败则抛给 tryPersist 保留原链
    if (kind === 'model3d') {
      const { fetchRemoteBlob } = await import('./fetchRemoteBlob');
      blob = await fetchRemoteBlob(raw, { timeoutMs: persistTimeoutMs(kind) });
    } else {
      blob = await fetchBlobWithTimeout(raw, persistTimeoutMs(kind));
    }
  } else {
    throw new Error('无法识别的素材地址');
  }

  const mime = guessMime(kind, blob.type, raw);
  return putBlobInVault({
    blob: blob.type ? blob : new Blob([blob], { type: mime }),
    kind,
    id: opts?.id,
    sourceHint: sourceHint || raw.slice(0, 120),
    mime,
  });
};

/** 尝试落库；失败返回原 URL（不阻断主流程） */
export const tryPersistMediaUrl = async (
  url: string,
  kind: VaultKind,
  sourceHint?: string,
  opts?: { id?: string }
): Promise<string> => {
  try {
    return await persistMediaUrl(url, kind, sourceHint, opts);
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

  // 同源静态资源（如 /enterprise-templates/*.jpg）→ 拉成 data URL 供生图
  if (raw.startsWith('/') || raw.startsWith('./')) {
    if (typeof window === 'undefined') {
      throw new Error('服务端无法解析相对路径参考图');
    }
    const abs = new URL(raw, window.location.origin).href;
    const res = await fetch(abs);
    if (!res.ok) throw new Error('读取模板版式图失败');
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
    // 只刷新元数据时间戳，切勿 get+put 整行（会把几十 MB GLB 再写一遍 IDB）
    const rows = metaMemory || readMetaLs() || [];
    const hit = rows.find((r) => r.id === id);
    if (hit) {
      upsertMeta({ ...hit, lastAccessAt: Date.now() });
    }
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

const extFromBlobType = (blob: Blob): string => {
  const t = (blob.type || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('webm')) return 'webm';
  if (t.includes('gltf') || t.includes('model')) return 'glb';
  return 'png';
};

const normalizeDownloadName = (filename: string, blob: Blob): string => {
  let name = (filename || 'download').trim() || 'download';
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    name = `${name}.${extFromBlobType(blob)}`;
  }
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(blob);
  });

/** Windows/macOS 桌面端 / 浏览器：系统「另存为」。桌面端必须先走 IPC，避免 Electron 内 FSA 弹窗卡死。 */
const saveBlobViaPickerOrDesktop = async (blob: Blob, name: string): Promise<boolean> => {
  const w = typeof window !== 'undefined' ? (window as any) : null;

  // 1) 桌面客户端：原生 dialog（挂在 BrowserWindow 上），禁止走 showSaveFilePicker
  const saveBytes = w?.bwDesktop?.saveBytes;
  if (typeof saveBytes === 'function') {
    try {
      const base64 = await blobToBase64(blob);
      const res = await saveBytes({
        filename: name,
        base64,
        mime: blob.type || 'application/octet-stream',
      });
      if (res?.canceled) return true;
      if (res?.ok) return true;
    } catch (e) {
      console.warn('[vault] bwDesktop.saveBytes failed', e);
    }
    // 桌面端 IPC 失败时不要再开 FSA（易弹到窗后导致假死），交给锚点/will-download
    return false;
  }

  // 2) 纯浏览器：File System Access API
  if (w && typeof w.showSaveFilePicker === 'function') {
    try {
      const ext = (name.split('.').pop() || 'png').toLowerCase();
      const mime = blob.type || 'application/octet-stream';
      const handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: [
          {
            description: '导出文件',
            accept: { [mime]: [`.${ext}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e: any) {
      if (e?.name === 'AbortError') return true; // 用户取消，视为已处理
      console.warn('[vault] showSaveFilePicker failed', e);
    }
  }

  return false;
};

const triggerAnchorDownload = (blob: Blob, name: string) => {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  // 部分 Windows/Electron 对 programmatic click 更敏感，用 MouseEvent
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  a.remove();
  setTimeout(() => {
    try {
      URL.revokeObjectURL(href);
    } catch {
      /* ignore */
    }
  }, 4_000);
};

/**
 * 安全下载本机/云端素材。
 * - 禁止把 vault: 交给系统打开（macOS/Windows 都会弹「未设定用来打开此 URL」）
 * - Windows 桌面端优先「另存为」对话框（Electron 上 <a download> 经常无反应）
 * - 只读导出，不删除、不改写 vault 库内容
 */
export const downloadMediaFile = async (
  url: string | undefined | null,
  filename: string
): Promise<void> => {
  const raw = (url || '').trim();
  if (!raw) throw new Error('没有可下载的文件');

  let blob: Blob | null = null;

  if (isVaultRef(raw)) {
    const id = vaultIdFromRef(raw);
    const row = await getRow(id);
    if (!row?.blob) throw new Error('本机素材库找不到该文件，请确认未清理本地缓存');
    void touchAccess(id);
    blob = row.blob;
  } else if (raw.startsWith('data:')) {
    const res = await fetch(raw);
    if (!res.ok) throw new Error('读取内嵌文件失败');
    blob = await res.blob();
  } else if (raw.startsWith('blob:') || /^https?:\/\//i.test(raw)) {
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
    blob = await res.blob();
  } else {
    const resolved = await resolveMediaUrl(raw);
    if (!resolved || resolved.startsWith('vault:')) {
      throw new Error('无法解析该素材地址');
    }
    const res = await fetch(resolved);
    if (!res.ok) throw new Error('下载失败');
    blob = await res.blob();
  }

  if (!blob || blob.size <= 0) throw new Error('下载内容为空');

  const name = normalizeDownloadName(filename, blob);
  const saved = await saveBlobViaPickerOrDesktop(blob, name);
  if (saved) return;

  // 3) 浏览器兜底（勿 window.open vault:）
  triggerAnchorDownload(blob, name);
};

/** 通知角标等 UI 刷新本机素材用量 */
export const notifyVaultChanged = (): void => {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('trade-pro-vault-changed'));
    }
  } catch {
    /* ignore */
  }
};

/** 按 vault:id / vault 引用删除一条，并释放 blob: 缓存 */
export const deleteVaultRef = async (urlOrId: string | undefined | null): Promise<boolean> => {
  const raw = (urlOrId || '').trim();
  if (!raw) return false;
  const id = isVaultRef(raw) ? vaultIdFromRef(raw) : raw.startsWith('va_') ? raw : '';
  if (!id) {
    if (raw.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(raw);
      } catch {
        /* ignore */
      }
      return true;
    }
    return false;
  }
  try {
    await deleteRow(id);
    return true;
  } catch (e) {
    console.warn('[vault] delete failed', id, e);
    return false;
  }
};

/**
 * 删除一批媒体 URL 对应的本机缓存（IndexedDB + blob 内存）。
 * keepUrls：其它地方仍在引用的 URL，不会删（避免裂图）。
 * 同时尽量清理 Cache Storage 里同 URL 的条目。
 */
export const purgeMediaUrls = async (
  candidateUrls: Array<string | undefined | null>,
  keepUrls?: Iterable<string>
): Promise<number> => {
  const keep = new Set<string>();
  if (keepUrls) {
    for (const u of keepUrls) {
      if (u?.trim()) keep.add(u.trim());
    }
  }
  const seen = new Set<string>();
  let removed = 0;
  for (const raw of candidateUrls) {
    const u = (raw || '').trim();
    if (!u || keep.has(u) || seen.has(u)) continue;
    seen.add(u);
    if (await deleteVaultRef(u)) removed += 1;
  }
  // 浏览器 / 桌面 Chromium：清 Cache Storage 中同 URL（不整站 clearCache，避免逼着重下整站）
  if (typeof caches !== 'undefined' && seen.size) {
    try {
      const keys = await caches.keys();
      for (const name of keys) {
        const cache = await caches.open(name);
        for (const u of seen) {
          if (keep.has(u)) continue;
          if (!/^https?:\/\//i.test(u)) continue;
          try {
            await cache.delete(u);
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      console.warn('[vault] cache storage purge skipped', e);
    }
  }
  if (removed > 0) notifyVaultChanged();
  return removed;
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
  writeMetaLs([]);
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).clear());
  } finally {
    db.close();
  }
  notifyVaultChanged();
};

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
