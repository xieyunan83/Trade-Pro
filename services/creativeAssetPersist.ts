/**
 * 创作模块统一落库：生成结果 / 参考图 → IndexedDB，元数据仍在 localStorage。
 */
import type { DesignAsset } from './designAgentStore';
import type { Model3dJob, VideoJob } from './creativeStudioStore';
import type { PackagingAsset } from './packagingAgentStore';
import {
  isVaultRef,
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
