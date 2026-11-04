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
  isVaultRef,
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
  kind: VaultKind
): Promise<string | undefined> => {
  if (!url) return url;
  if (!needsPersist(url)) return url;
  return tryPersistMediaUrl(url, kind);
};

export const persistDesignAssets = async (rows: DesignAsset[]): Promise<DesignAsset[]> => {
  const out: DesignAsset[] = [];
  for (const a of rows) {
    out.push({
      ...a,
      url: (await persistUrlField(a.url, 'image')) || a.url,
    });
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
 * 3D 落库：只优先缓存「主网格」一份（PBR > model > base），避免高细节多文件串行下载卡死。
 * 失败/超时保留原临时链，不阻断预览与下载。
 */
export const persistModel3dJob = async (job: Model3dJob): Promise<Model3dJob> => {
  const primary =
    (job.pbrModelUrl || job.modelUrl || job.baseModelUrl || '').trim() || undefined;

  const [sourceImage, sourceImages, primaryVault, previewImageUrl] = await Promise.all([
    persistUrlField(job.sourceImage, 'image'),
    job.sourceImages?.length
      ? Promise.all(job.sourceImages.map((u) => persistUrlField(u, 'image').then((x) => x || u)))
      : Promise.resolve(job.sourceImages),
    primary ? persistUrlField(primary, 'model3d') : Promise.resolve(undefined),
    persistUrlField(job.previewImageUrl, 'image'),
  ]);

  let modelUrl = job.modelUrl;
  let pbrModelUrl = job.pbrModelUrl;
  let baseModelUrl = job.baseModelUrl;
  if (primary && primaryVault) {
    if (job.pbrModelUrl === primary) pbrModelUrl = primaryVault;
    else if (job.modelUrl === primary) modelUrl = primaryVault;
    else if (job.baseModelUrl === primary) baseModelUrl = primaryVault;
    // 预览优先用已落库主网格
    if (!modelUrl || modelUrl === primary) modelUrl = primaryVault;
  }

  return {
    ...job,
    sourceImage: sourceImage || job.sourceImage,
    sourceImages,
    modelUrl,
    pbrModelUrl,
    baseModelUrl,
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
