/**
 * 创作模块统一落库：生成结果 / 参考图 → IndexedDB，元数据仍在 localStorage。
 */
import type { DesignAsset } from './designAgentStore';
import { loadDesignAssets } from './designAgentStore';
import type { Model3dJob, VideoJob, SocialPiece } from './creativeStudioStore';
import { loadModel3dJobs, loadVideoJobs, loadSocialPieces } from './creativeStudioStore';
import type { PackagingAsset } from './packagingAgentStore';
import { loadPackagingAssets } from './packagingAgentStore';
import { loadCatalogSkus } from './productCatalogTypes';
import { loadEnterprisePacks } from './enterpriseDesignPacks';
import {
  findModel3dVaultRefForJob,
  findOriginalModel3dVaultRefForJob,
  isVaultRef,
  model3dVaultIdForJob,
  preserveOriginalModel3dInVault,
  purgeMediaUrls,
  resolveMediaUrl,
  tryPersistMediaUrl,
  type VaultKind,
} from './creativeAssetVault';

const needsPersist = (url: string | undefined): boolean => {
  if (!url) return false;
  if (isVaultRef(url)) return false;
  return (
    url.startsWith('data:') ||
    /^https?:\/\//i.test(url) ||
    url.startsWith('blob:')
  );
};

export const persistUrlField = async (
  url: string | undefined,
  kind: VaultKind,
  opts?: { id?: string; sourceHint?: string }
): Promise<string | undefined> => {
  if (!url) return url;
  if (!needsPersist(url)) return url;
  return tryPersistMediaUrl(url, kind, opts?.sourceHint, { id: opts?.id });
};

const yieldUi = () =>
  new Promise<void>((r) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(r, 0));
      return;
    }
    setTimeout(r, 0);
  });

export const persistDesignAssets = async (rows: DesignAsset[]): Promise<DesignAsset[]> => {
  const out: DesignAsset[] = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    try {
      const { shouldDeferHeavyWork } = await import('./foregroundGuard');
      let spins = 0;
      while (shouldDeferHeavyWork() && spins < 80) {
        await new Promise((r) => setTimeout(r, 200));
        spins += 1;
      }
    } catch {
      /* ignore */
    }
    out.push({
      ...a,
      url: (await persistUrlField(a.url, 'image')) || a.url,
    });
    if (i % 2 === 1) await yieldUi();
  }
  return out;
};

export const persistPackagingAssets = async (
  rows: PackagingAsset[]
): Promise<PackagingAsset[]> => {
  const out: PackagingAsset[] = [];
  for (const a of rows) {
    out.push({
      ...a,
      url: (await persistUrlField(a.url, 'image')) || a.url,
    });
  }
  return out;
};

/**
 * 3D 落库：主网格 → mesh_${id}；拆分前原模单独 → mesh_${id}_orig。
 * 必须先固化原模再写主槽，否则拆分结果会冲掉「原模」指向的同一 vault。
 * 远程 403 过期时，若本机已有对应槽则回挂。
 */
export const persistModel3dJob = async (job: Model3dJob): Promise<Model3dJob> => {
  // 先固化原模到 _orig（即使主槽已有文件也要做，防止后续覆盖）
  const preservedOrig =
    (await preserveOriginalModel3dInVault(job)) ||
    (await findOriginalModel3dVaultRefForJob(job));

  const primary =
    (job.pbrModelUrl || job.modelUrl || job.baseModelUrl || '').trim() || undefined;
  const meshId = model3dVaultIdForJob(job.id);
  const hint = job.providerTaskId || job.sourceTaskId || job.id;
  const primaryIsLocal = !!(
    primary &&
    (isVaultRef(primary) || primary.startsWith('blob:') || primary.startsWith('data:'))
  );
  /** 拆分/后处理返回的新 https 链：绝不能被「旧的本机主槽」短路掉，否则原模/分件对调 */
  const primaryIsRemote = !!(primary && /^https?:\/\//i.test(primary));

  const existingLocal = await findModel3dVaultRefForJob(job);
  // 仅当没有新的远程主网格时，才用本机主槽短路
  if (existingLocal && !primaryIsRemote && (!primary || primaryIsLocal)) {
    const orig =
      preservedOrig ||
      (isVaultRef(job.originalModelUrl) &&
      job.originalModelUrl !== existingLocal
        ? job.originalModelUrl
        : undefined);
    return {
      ...job,
      modelUrl: isVaultRef(job.modelUrl) ? job.modelUrl : existingLocal,
      pbrModelUrl: isVaultRef(job.pbrModelUrl) ? job.pbrModelUrl : existingLocal,
      baseModelUrl: isVaultRef(job.baseModelUrl)
        ? job.baseModelUrl
        : preservedOrig || job.baseModelUrl,
      // 禁止把主槽冒充原模（拆分后主槽可能已是分件结果）
      originalModelUrl: orig || preservedOrig || job.originalModelUrl,
      previewHint: job.previewHint?.includes('本机')
        ? job.previewHint
        : '模型已就绪 · 已存本机 · 可拖动环视',
    };
  }

  const originalRaw = (job.originalModelUrl || preservedOrig || '').trim();
  const origId = `${meshId}_orig`;
  const [sourceImage, sourceImages, primaryVault, previewImageUrl, originalVault] =
    await Promise.all([
      persistUrlField(job.sourceImage, 'image'),
      job.sourceImages?.length
        ? Promise.all(job.sourceImages.map((u) => persistUrlField(u, 'image').then((x) => x || u)))
        : Promise.resolve(job.sourceImages),
      primary
        ? persistUrlField(primary, 'model3d', { id: meshId, sourceHint: hint })
        : Promise.resolve(undefined),
      persistUrlField(job.previewImageUrl, 'image'),
      preservedOrig
        ? Promise.resolve(preservedOrig)
        : originalRaw && originalRaw !== primary
          ? persistUrlField(originalRaw, 'model3d', {
              id: origId,
              sourceHint: `${hint || job.id}_orig`,
            })
          : Promise.resolve(undefined),
    ]);

  let modelUrl = job.modelUrl;
  let pbrModelUrl = job.pbrModelUrl;
  let baseModelUrl = job.baseModelUrl;
  let originalModelUrl = preservedOrig || job.originalModelUrl;
  if (primary && primaryVault && isVaultRef(primaryVault)) {
    if (job.pbrModelUrl === primary) pbrModelUrl = primaryVault;
    else if (job.modelUrl === primary) modelUrl = primaryVault;
    else if (job.baseModelUrl === primary) baseModelUrl = primaryVault;
    if (!modelUrl || modelUrl === primary || !isVaultRef(modelUrl)) modelUrl = primaryVault;
  }
  if (originalVault && isVaultRef(originalVault)) {
    originalModelUrl = originalVault;
    if (!baseModelUrl || baseModelUrl === originalRaw || baseModelUrl === job.originalModelUrl) {
      baseModelUrl = originalVault;
    }
  } else if (originalRaw && primaryVault && originalRaw === primary && isVaultRef(primaryVault)) {
    // 尚未拆分：主网格即原模，同时写一份 _orig 备份
    originalModelUrl = (await preserveOriginalModel3dInVault({
      ...job,
      originalModelUrl: primaryVault,
      modelUrl: primaryVault,
    })) || primaryVault;
  }

  return {
    ...job,
    sourceImage: sourceImage || job.sourceImage,
    sourceImages,
    modelUrl,
    pbrModelUrl,
    baseModelUrl,
    originalModelUrl: originalModelUrl || job.originalModelUrl,
    previewImageUrl: previewImageUrl || job.previewImageUrl,
  };
};

export const persistVideoJob = async (job: VideoJob): Promise<VideoJob> => {
  const sourceImages = await Promise.all(
    (job.sourceImages || []).map((u) => persistUrlField(u, 'image').then((x) => x || u))
  );
  return {
    ...job,
    sourceImages,
    draftVideoUrl: (await persistUrlField(job.draftVideoUrl, 'video')) || job.draftVideoUrl,
    videoUrl: (await persistUrlField(job.videoUrl, 'video')) || job.videoUrl,
  };
};

/** 展示用：把 vault: 解成 blob: */
export const hydrateUrl = resolveMediaUrl;

export const hydrateUrls = async (urls: string[]): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  for (const u of urls) {
    if (!u || map.has(u)) continue;
    map.set(u, await resolveMediaUrl(u));
  }
  return map;
};

const pushUrl = (set: Set<string>, u?: string | null) => {
  const t = (u || '').trim();
  if (t) set.add(t);
};

const collectModel3dUrls = (job: Model3dJob, set: Set<string>) => {
  pushUrl(set, job.sourceImage);
  job.sourceImages?.forEach((u) => pushUrl(set, u));
  pushUrl(set, job.modelUrl);
  pushUrl(set, job.pbrModelUrl);
  pushUrl(set, job.baseModelUrl);
  pushUrl(set, job.previewImageUrl);
  if (job.convertedUrls) {
    Object.values(job.convertedUrls).forEach((u) => pushUrl(set, u));
  }
};

const collectVideoUrls = (job: VideoJob, set: Set<string>) => {
  job.sourceImages?.forEach((u) => pushUrl(set, u));
  pushUrl(set, job.lastFrameImage);
  pushUrl(set, job.draftVideoUrl);
  pushUrl(set, job.videoUrl);
};

const collectSocialUrls = (p: SocialPiece, set: Set<string>) => {
  pushUrl(set, p.referenceImageDataUrl);
  pushUrl(set, p.productImageDataUrl);
  pushUrl(set, p.coverImageDataUrl);
};

/** 扫本机仍被引用的创作媒体 URL（删库前保活） */
export const collectReferencedCreativeMediaUrls = (): Set<string> => {
  const set = new Set<string>();
  try {
    for (const a of loadDesignAssets()) pushUrl(set, a.url);
    for (const a of loadPackagingAssets()) pushUrl(set, a.url);
    for (const j of loadModel3dJobs()) collectModel3dUrls(j, set);
    for (const j of loadVideoJobs()) collectVideoUrls(j, set);
    for (const p of loadSocialPieces()) collectSocialUrls(p, set);
    for (const sku of loadCatalogSkus()) sku.images?.forEach((u) => pushUrl(set, u));
    for (const pack of loadEnterprisePacks()) {
      pack.layoutRefs?.forEach((u) => pushUrl(set, u));
    }
  } catch (e) {
    console.warn('[persist] collectReferencedCreativeMediaUrls failed', e);
  }
  return set;
};

/**
 * 界面删除素材后调用：从 IndexedDB / blob / Cache Storage 清掉已无引用的文件，释放磁盘。
 * 须在 persist/localStorage 更新完成后再调用。
 */
export const purgeDeletedCreativeMedia = async (
  removedUrls: Array<string | undefined | null>
): Promise<number> => {
  const candidates = removedUrls.map((u) => (u || '').trim()).filter(Boolean);
  if (!candidates.length) return 0;
  const keep = collectReferencedCreativeMediaUrls();
  return purgeMediaUrls(candidates, keep);
};

export type ClearCreativeMediaReport = {
  ok: boolean;
  vaultMetaBefore: number;
  designAssetsCleared: number;
  packagingAssetsCleared: number;
  model3dJobsTouched: number;
  videoJobsTouched: number;
  socialTouched: number;
  error?: string;
};

const stripMediaUrl = (u?: string): string | undefined => {
  if (!u) return undefined;
  // 清空后一律去掉本机/临时媒体，避免马上又迁回 vault
  if (
    u.startsWith('vault:') ||
    u.startsWith('data:') ||
    u.startsWith('blob:') ||
    /^https?:\/\//i.test(u)
  ) {
    return undefined;
  }
  return u;
};

/**
 * 真正「清空素材」：清 IndexedDB vault + 创作模块本地媒体引用。
 * 只清 vault 不够——画布/任务里还挂着链接时，进模块会立刻再迁回库。
 */
export const clearAllCreativeLocalMedia = async (): Promise<ClearCreativeMediaReport> => {
  const report: ClearCreativeMediaReport = {
    ok: false,
    vaultMetaBefore: 0,
    designAssetsCleared: 0,
    packagingAssetsCleared: 0,
    model3dJobsTouched: 0,
    videoJobsTouched: 0,
    socialTouched: 0,
  };
  try {
    const { clearVault, markCreativeVaultClearedSession, getVaultStats } = await import(
      './creativeAssetVault'
    );
    try {
      const before = await getVaultStats();
      report.vaultMetaBefore = before.count;
    } catch {
      /* ignore */
    }

    const vaultRes = await clearVault();
    report.vaultMetaBefore = Math.max(report.vaultMetaBefore, vaultRes.removedMeta);
    markCreativeVaultClearedSession();

    const { saveDesignAssets, loadDesignAssets } = await import('./designAgentStore');
    const design = loadDesignAssets();
    report.designAssetsCleared = design.length;
    saveDesignAssets([]);

    const { savePackagingAssets, loadPackagingAssets } = await import('./packagingAgentStore');
    const pack = loadPackagingAssets();
    report.packagingAssetsCleared = pack.length;
    savePackagingAssets([]);

    const {
      loadModel3dJobs,
      saveModel3dJobs,
      loadVideoJobs,
      saveVideoJobs,
      loadSocialPieces,
      saveSocialPieces,
    } = await import('./creativeStudioStore');

    const models = loadModel3dJobs().map((j) => {
      report.model3dJobsTouched += 1;
      return {
        ...j,
        sourceImage: stripMediaUrl(j.sourceImage),
        sourceImages: (j.sourceImages || []).map((u) => stripMediaUrl(u) || '').filter(Boolean),
        modelUrl: stripMediaUrl(j.modelUrl),
        pbrModelUrl: stripMediaUrl(j.pbrModelUrl),
        baseModelUrl: stripMediaUrl(j.baseModelUrl),
        originalModelUrl: stripMediaUrl(j.originalModelUrl),
        originalPreviewImageUrl: stripMediaUrl(j.originalPreviewImageUrl),
        previewImageUrl: stripMediaUrl(j.previewImageUrl),
        uvAtlasUrl: stripMediaUrl(j.uvAtlasUrl),
        convertedUrls: undefined,
        previewHint: '本机素材已清空，请重新生成',
        status: j.status === 'ready' ? ('failed' as const) : j.status,
        error: j.status === 'ready' ? '本机素材已清空' : j.error,
      };
    });
    saveModel3dJobs(models);

    const videos = loadVideoJobs().map((j) => {
      report.videoJobsTouched += 1;
      return {
        ...j,
        sourceImages: [],
        lastFrameImage: undefined,
        draftVideoUrl: stripMediaUrl(j.draftVideoUrl),
        videoUrl: stripMediaUrl(j.videoUrl),
        previewHint: '本机素材已清空，请重新生成',
        status: j.status === 'ready' ? ('failed' as const) : j.status,
        error: j.status === 'ready' ? '本机素材已清空' : j.error,
      };
    });
    saveVideoJobs(videos);

    const social = loadSocialPieces().map((p) => {
      report.socialTouched += 1;
      return {
        ...p,
        referenceImageDataUrl: stripMediaUrl(p.referenceImageDataUrl),
        productImageDataUrl: stripMediaUrl(p.productImageDataUrl),
        coverImageDataUrl: stripMediaUrl(p.coverImageDataUrl),
      };
    });
    saveSocialPieces(social);

    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('trade-pro-creative-media-cleared', { detail: report })
        );
      }
    } catch {
      /* ignore */
    }

    report.ok = true;
    return report;
  } catch (e: any) {
    report.ok = false;
    report.error = e?.message || String(e);
    return report;
  }
};
