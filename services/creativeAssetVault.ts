/**
 * 创作素材本地库（IndexedDB）
 * - 图片 / GLB / 视频下载后落本机，不依赖供应商临时外链（常 2h 过期）
 * - localStorage 只存 vault:id 元数据，避免撑爆 5MB 配额
 * - 本机库不设总容量软上限；仅单文件有上限。清理请用界面「清空」或浏览器 IndexedDB。
 */

export const VAULT_PREFIX = 'vault:';

export type VaultKind = 'image' | 'model3d' | 'video' | 'other';

export type VaultMeta = {
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

/** 拆分前原模单独槽位：避免后处理写入 mesh_${id} 时把原模冲掉 */
export const model3dOriginalVaultIdForJob = (jobId: string): string =>
  `mesh_${jobId}_orig`;

/**
 * 粗检 GLB 是否内嵌贴图。无贴图的 base / 分件色块常被误标成「彩色原模」。
 */
export const glbBlobLikelyHasTextures = async (blob: Blob): Promise<boolean> => {
  try {
    const slice = blob.slice(0, Math.min(blob.size, 2_500_000));
    const bytes = new Uint8Array(await slice.arrayBuffer());
    const head = new TextDecoder('latin1').decode(bytes);
    if (/KHR_texture_basisu|image\/png|image\/jpeg|image\/webp|mimeType"\s*:\s*"image/i.test(head)) {
      return true;
    }
    for (let i = 0; i < bytes.length - 4; i++) {
      // PNG
      if (
        bytes[i] === 0x89 &&
        bytes[i + 1] === 0x50 &&
        bytes[i + 2] === 0x4e &&
        bytes[i + 3] === 0x47
      ) {
        return true;
      }
      // JPEG
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
};

/**
 * 为本机任务挑选「最可能带贴图」的 GLB：贴图标记优先，体积只作同分决胜。
 * 不访问云端、不耗生成额度。
 */
export const findBestLocalTexturedModel3dForJob = async (job: {
  id: string;
  providerTaskId?: string;
  sourceTaskId?: string;
  segmentTaskId?: string;
  originalModelUrl?: string;
  pbrModelUrl?: string;
  modelUrl?: string;
  baseModelUrl?: string;
}): Promise<string | null> => {
  const meshId = model3dVaultIdForJob(job.id);
  const origId = model3dOriginalVaultIdForJob(job.id);
  const segmented = !!(job.segmentTaskId || '').trim();
  const hints = [job.sourceTaskId, job.providerTaskId, job.id]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  const modelId = (job.modelUrl || '').trim()
    ? isVaultRef(job.modelUrl!)
      ? vaultIdFromRef(job.modelUrl!)
      : ''
    : '';
  const pbrId = (job.pbrModelUrl || '').trim()
    ? isVaultRef(job.pbrModelUrl!)
      ? vaultIdFromRef(job.pbrModelUrl!)
      : ''
    : '';

  const candidates: string[] = [];
  const pushId = (id?: string | null) => {
    const s = (id || '').trim();
    if (!s) return;
    if (isVaultRef(s)) {
      candidates.push(vaultIdFromRef(s));
      return;
    }
    // 仅接受 vault id / 已知槽名，跳过 https
    if (/^https?:\/\//i.test(s) || s.startsWith('blob:') || s.startsWith('data:')) return;
    candidates.push(s);
  };
  pushId(origId);
  pushId(job.originalModelUrl);
  // 拆分后：仅当 pbr 不是分件主槽时才纳入
  if (!segmented || (pbrId && pbrId !== meshId && pbrId !== modelId)) {
    pushId(job.pbrModelUrl);
  }
  // 未拆分时主槽通常就是彩色成片；已拆分则主槽多半是分件，跳过
  if (!segmented) {
    pushId(meshId);
    pushId(job.modelUrl);
  }
  pushId(job.baseModelUrl);

  const meta = await listVaultMeta();
  const allModels = meta.filter((x) => x.kind === 'model3d');
  for (const m of allModels) {
    const bag = `${m.id} ${m.sourceHint || ''}`;
    if (hints.some((h) => bag.includes(h))) pushId(m.id);
    if (m.id === origId || m.id.endsWith('_orig')) pushId(m.id);
  }
  // 任务提示对不上时：仍扫一遍本机全部 GLB，避免彩色文件躺在库里却选成灰模
  for (const m of allModels) pushId(m.id);

  /**
   * 体积大 ≠ 有色：Tripo base 灰模常比带贴图 PBR 更大。
   * 评分：内嵌贴图 >> 任务相关 >> _orig / pbr，base 与主槽分件垫底。
   */
  const scoreId = (id: string, size: number, hasTex: boolean, related: boolean): number => {
    const bag = id.toLowerCase();
    let score = Math.min(size / 1_000_000, 40); // 体积最多贡献 40
    if (hasTex) score += 200;
    else score -= 60;
    if (related) score += 80;
    if (id === origId || bag.endsWith('_orig') || bag.includes('_orig')) score += 120;
    if (bag.includes('pbr')) score += 90;
    if (bag.includes('base') || id === (job.baseModelUrl || '').replace(/^vault:/, '')) {
      score -= 80;
    }
    if (segmented && (id === meshId || id === modelId)) score -= 160;
    return score;
  };

  let best: { id: string; score: number; hasTex: boolean } | null = null;
  const seen = new Set<string>();
  for (const id of candidates) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (segmented && (id === meshId || id === modelId)) continue;
    const row = await getRow(id);
    const size = row?.blob?.size || 0;
    if (size < 1024) continue;
    const hasTex = row?.blob ? await glbBlobLikelyHasTextures(row.blob) : false;
    const related =
      id === origId ||
      id === meshId ||
      hints.some((h) => id.includes(h) || (row?.sourceHint || '').includes(h));
    // 无关且无贴图的库内文件直接跳过，避免扫库误选
    if (!related && !hasTex) continue;
    // 无关但有贴图：仅作保底（相关无色时）
    const score = scoreId(id, size, hasTex, related);
    if (!best || score > best.score) best = { id, score, hasTex };
  }
  if (!best) return null;
  // 优先只返回带贴图的；全库无色才回落灰模
  if (!best.hasTex) {
    void touchAccess(best.id);
    return `${VAULT_PREFIX}${best.id}`;
  }
  void touchAccess(best.id);
  return `${VAULT_PREFIX}${best.id}`;
};

/**
 * 查找拆分前原模本机引用。
 * 优先 mesh_${id}_orig；再按 sourceTaskId / _orig 提示匹配。
 */
export const findOriginalModel3dVaultRefForJob = async (job: {
  id: string;
  providerTaskId?: string;
  sourceTaskId?: string;
  originalModelUrl?: string;
  baseModelUrl?: string;
}): Promise<string | null> => {
  const origId = model3dOriginalVaultIdForJob(job.id);
  const origRow = await getRow(origId);
  if (origRow?.blob) {
    void touchAccess(origId);
    return `${VAULT_PREFIX}${origId}`;
  }

  const declared = (job.originalModelUrl || '').trim();
  if (declared && isVaultRef(declared)) {
    const id = vaultIdFromRef(declared);
    // 若仍指向主槽 mesh_${id}，可能已被拆分结果覆盖，不能当原模
    if (id !== model3dVaultIdForJob(job.id)) {
      const row = await getRow(id);
      if (row?.blob) {
        void touchAccess(id);
        return declared;
      }
    }
  }

  const hints = [job.sourceTaskId, job.id]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  const meta = await listVaultMeta();
  const models = meta.filter((m) => m.kind === 'model3d');
  const scored = models
    .map((m) => {
      const bag = `${m.id} ${m.sourceHint || ''}`;
      let score = 0;
      if (m.id.endsWith('_orig') || bag.includes('_orig')) score += 12;
      if (hints.some((h) => bag.includes(h) && bag.includes('_orig'))) score += 10;
      if (hints.some((h) => m.id.includes(h) && m.id.includes('orig'))) score += 8;
      return { m, score };
    })
    .filter((x) => x.score >= 12)
    .sort((a, b) => b.score - a.score || b.m.lastAccessAt - a.m.lastAccessAt);

  for (const { m } of scored) {
    if (m.id === model3dVaultIdForJob(job.id)) continue;
    const row = await getRow(m.id);
    if (row?.blob) {
      void touchAccess(m.id);
      return `${VAULT_PREFIX}${m.id}`;
    }
  }
  return null;
};

/**
 * 在写入/覆盖主网格前，把当前原模固化到 mesh_${id}_orig。
 * 解决：originalModelUrl 与 modelUrl 同为 vault:mesh_${id} 时，拆分落库冲掉原模。
 */
export const preserveOriginalModel3dInVault = async (job: {
  id: string;
  providerTaskId?: string;
  sourceTaskId?: string;
  segmentTaskId?: string;
  originalModelUrl?: string;
  baseModelUrl?: string;
  modelUrl?: string;
  pbrModelUrl?: string;
}): Promise<string | null> => {
  const meshId = model3dVaultIdForJob(job.id);
  const origId = model3dOriginalVaultIdForJob(job.id);
  const hint = `${job.sourceTaskId || job.providerTaskId || job.id}_orig`;
  const alreadySegmented = !!(job.segmentTaskId || '').trim();

  // 优先带贴图的 PBR / 主网格，base 几何常无颜色（灰模）放最后
  // 已拆分后：绝不能再把主槽（多半是分件结果）误拷成「原模」
  // 不再「已有 _orig 就直接返回」：允许用更大/带贴图的源升级灰模备份
  const candidates = (
    alreadySegmented
      ? // 拆分后：原模槽 + 仍独立的 pbr（勿等于主槽）+ base；禁止用分件 model 回写
        [
          job.originalModelUrl,
          job.pbrModelUrl &&
          job.pbrModelUrl !== job.modelUrl &&
          !(isVaultRef(job.pbrModelUrl) && vaultIdFromRef(job.pbrModelUrl) === meshId)
            ? job.pbrModelUrl
            : undefined,
          job.baseModelUrl,
        ]
      : [job.originalModelUrl, job.pbrModelUrl, job.modelUrl, job.baseModelUrl]
  )
    .map((u) => (u || '').trim())
    .filter(Boolean);

  const existingOrig = await getRow(origId);
  const existingSize = existingOrig?.blob?.size || 0;

  for (const url of candidates) {
    if (isVaultRef(url)) {
      const id = vaultIdFromRef(url);
      const row = await getRow(id);
      if (!row?.blob) continue;
      if (id === origId) return `${VAULT_PREFIX}${origId}`;
      // 已拆分且候选仍指向主槽 → 主槽已是分件，跳过
      if (alreadySegmented && id === meshId) continue;
      const candidateHasTex = await glbBlobLikelyHasTextures(row.blob);
      const existingHasTex =
        existingSize > 0 && existingOrig?.blob
          ? await glbBlobLikelyHasTextures(existingOrig.blob)
          : false;
      // 已有带贴图原模时，禁止用无贴图灰模/分件「升级」覆盖
      if (existingHasTex && !candidateHasTex) continue;
      // 已有原模备份：仅当新候选明显更大或新候选有贴图而旧的没有时升级
      if (
        existingSize > 0 &&
        existingHasTex === candidateHasTex &&
        row.blob.size < existingSize * 1.08
      ) {
        continue;
      }
      await putBlobInVault({
        blob: row.blob,
        kind: 'model3d',
        id: origId,
        sourceHint: hint,
        mime: row.mime || row.blob.type || 'model/gltf-binary',
      });
      return `${VAULT_PREFIX}${origId}`;
    }
    if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) {
      // 已有备份时仍尝试用更优远程源覆盖（tryPersist 会写入同 id）
      if (existingSize > 0 && url === job.baseModelUrl && (job.pbrModelUrl || job.originalModelUrl)) {
        continue;
      }
      const saved = await tryPersistMediaUrl(url, 'model3d', hint, { id: origId });
      if (saved && isVaultRef(saved)) return saved;
    }
  }

  if (existingOrig?.blob) return `${VAULT_PREFIX}${origId}`;

  // 仅未拆分时：主槽即原模，拷一份到 _orig
  if (!alreadySegmented) {
    const primary = await getRow(meshId);
    if (primary?.blob) {
      await putBlobInVault({
        blob: primary.blob,
        kind: 'model3d',
        id: origId,
        sourceHint: hint,
        mime: primary.mime || primary.blob.type || 'model/gltf-binary',
      });
      return `${VAULT_PREFIX}${origId}`;
    }
  }

  return null;
};

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
      // 主网格回挂不要误用 _orig 槽
      if (m.id.endsWith('_orig') || bag.includes('_orig')) score -= 20;
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

const yieldBriefly = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
      return;
    }
    setTimeout(resolve, 0);
  });

/**
 * 冷启动重建元数据索引。
 * 禁止 getAll()：会把整库 blob（几百 MB）一次性拖进内存，桌面端直接假死。
 * 改用游标逐条抽 meta，并每几条让出主线程。
 */
const rebuildVaultMetaIndex = async (): Promise<VaultMeta[]> => {
  const db = await openDb();
  const meta: VaultMeta[] = [];
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    let sinceYield = 0;
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor();
      req.onerror = () => reject(req.error || new Error('素材索引扫描失败'));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        try {
          const row = cursor.value as VaultRow;
          const { blob: _b, ...m } = row;
          if (m?.id) meta.push(m);
        } catch {
          /* skip corrupt */
        }
        sinceYield += 1;
        if (sinceYield >= 4) {
          sinceYield = 0;
          void yieldBriefly().then(() => {
            try {
              cursor.continue();
            } catch (e) {
              reject(e);
            }
          });
          return;
        }
        cursor.continue();
      };
    });
  } finally {
    db.close();
  }
  writeMetaLs(meta);
  return meta.map((m) => ({ ...m }));
};

export const listVaultMeta = async (): Promise<VaultMeta[]> => {
  if (!isBrowser()) return [];
  if (metaMemory) return metaMemory.map((m) => ({ ...m }));
  const fromLs = readMetaLs();
  if (fromLs) {
    metaMemory = fromLs;
    return fromLs.map((m) => ({ ...m }));
  }
  return rebuildVaultMetaIndex();
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

/** 按 vault id 取 Blob（素材浏览器贴图检测等） */
export const getRowBlobForVaultId = async (id: string): Promise<Blob | null> => {
  const row = await getRow((id || '').trim());
  return row?.blob || null;
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
  // 元数据空但库里可能还有文件：先重建索引再删
  let rows = await listVaultMeta();
  if (!rows.length) {
    try {
      rows = await rebuildVaultMetaIndex();
    } catch {
      rows = [];
    }
  }
  const sorted = [...rows].sort((a, b) => (a.lastAccessAt || 0) - (b.lastAccessAt || 0));
  let need = targetFreeBytes;
  let removed = 0;
  for (const r of sorted) {
    if (need <= 0) break;
    await deleteRow(r.id);
    need -= r.size || 0;
    removed += 1;
  }
  if (removed > 0) notifyVaultChanged();
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

/** vault: → Blob（不建 object URL，供 GLB ArrayBuffer 解析） */
export const resolveMediaBlob = async (url: string | undefined | null): Promise<Blob | null> => {
  const raw = (url || '').trim();
  if (!raw) return null;
  if (raw.startsWith('blob:') || raw.startsWith('data:')) {
    try {
      const res = await fetch(raw);
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }
  if (!isVaultRef(raw)) return null;
  const id = vaultIdFromRef(raw);
  const row = await getRow(id);
  if (!row?.blob) return null;
  void touchAccess(id);
  return row.blob;
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

/** 清空全部本地素材（IndexedDB + 元数据 + blob 缓存） */
export const clearVault = async (): Promise<{ removedMeta: number }> => {
  const before = (metaMemory || readMetaLs() || []).length;
  for (const [, obj] of objectUrlCache) {
    try {
      URL.revokeObjectURL(obj);
    } catch {
      /* ignore */
    }
  }
  objectUrlCache.clear();
  writeMetaLs([]);
  metaMemory = [];

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(META_LS);
      localStorage.setItem(META_LS, '[]');
    } catch {
      /* ignore */
    }
  }

  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('清空素材库事务失败'));
      tx.onabort = () => reject(tx.error || new Error('清空素材库事务中断'));
      tx.objectStore(STORE).clear();
    });
  } finally {
    db.close();
  }

  // 再确认：避免 clear 后游标重建把空库又扫成旧 meta（旧 LS 残留）
  writeMetaLs([]);
  metaMemory = [];
  notifyVaultChanged();
  return { removedMeta: before };
};

/** 本会话内已手动清空：禁止模块启动时把外链再迁回 vault */
const CLEARED_SESSION_KEY = 'trade_pro_creative_cleared_session';

export const markCreativeVaultClearedSession = () => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(CLEARED_SESSION_KEY, String(Date.now()));
    }
  } catch {
    /* ignore */
  }
};

export const shouldSkipCreativeRemigration = (): boolean => {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    return !!sessionStorage.getItem(CLEARED_SESSION_KEY);
  } catch {
    return false;
  }
};

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
