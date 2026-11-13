/**
 * GLB/GLTF 统一加载：支持 vault/blob/https，并挂 Draco（Tripo 等常见压缩）。
 * 优先 ArrayBuffer + parse，避免 blob: URL 被撤销导致「预览加载失败」。
 */
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { fetchRemoteBlob, peekRemoteBlob, rememberRemoteBlob } from './fetchRemoteBlob';
import { isVaultRef, resolveMediaBlob, resolveMediaUrl } from './creativeAssetVault';

let sharedDraco: DRACOLoader | null = null;

const getDracoLoader = (): DRACOLoader => {
  if (sharedDraco) return sharedDraco;
  const draco = new DRACOLoader();
  // 同源静态资源（public/draco），不受外链 CSP 影响
  draco.setDecoderPath(`${(import.meta as any).env?.BASE_URL || '/'}draco/`);
  draco.setDecoderConfig({ type: 'wasm' });
  sharedDraco = draco;
  return draco;
};

export const createGlbLoader = (): GLTFLoader => {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  return loader;
};

export type GlbSource = {
  buffer?: ArrayBuffer;
  url?: string;
  blob?: Blob;
  /** 远程拉取时用于落库 */
  remoteUrl?: string;
};

/** 把任意模型地址解析成可 parse 的 ArrayBuffer（优先）或 URL */
export const resolveGlbSource = async (
  raw: string,
  onPullProgress?: (pct: number) => void
): Promise<GlbSource> => {
  const u = (raw || '').trim();
  if (!u) throw new Error('无模型地址');

  if (u.startsWith('blob:') || u.startsWith('data:')) {
    const blob = await resolveMediaBlob(u);
    if (blob) {
      onPullProgress?.(100);
      return { buffer: await blob.arrayBuffer(), blob };
    }
    return { url: u };
  }

  if (isVaultRef(u)) {
    const blob = await resolveMediaBlob(u);
    if (!blob) throw new Error('本机素材库里找不到该 GLB，请重新生成或导入');
    // 粗检：明显是图片则不是网格
    const mime = (blob.type || '').toLowerCase();
    if (mime.startsWith('image/')) {
      throw new Error('本机槽位里是图片而非 GLB，请重新生成或导入模型文件');
    }
    if (blob.size < 64) {
      throw new Error('本机 GLB 文件过小或已损坏，请重新生成');
    }
    onPullProgress?.(100);
    return { buffer: await blob.arrayBuffer(), blob };
  }

  if (/^https?:\/\//i.test(u)) {
    let blob = peekRemoteBlob(u);
    if (!blob) {
      blob = await fetchRemoteBlob(u, {
        timeoutMs: 180_000,
        onProgress: onPullProgress,
      });
      rememberRemoteBlob(u, blob);
    } else {
      onPullProgress?.(100);
    }
    return { buffer: await blob.arrayBuffer(), blob, remoteUrl: u };
  }

  // 兜底：尝试 resolve 成 blob URL
  const resolved = await resolveMediaUrl(u);
  if (!resolved) throw new Error('不支持的模型地址');
  return { url: resolved };
};

export const loadGlbFromSource = (
  source: GlbSource,
  onProgress?: (pct: number) => void
): Promise<GLTF> =>
  new Promise((resolve, reject) => {
    const loader = createGlbLoader();
    const fail = (e: unknown) => {
      const msg = String((e as any)?.message || e || 'GLB 解析失败');
      if (/DRACO|draco|KHR_draco/i.test(msg)) {
        reject(new Error('模型使用了 Draco 压缩，解码失败。请刷新页面后重试预览。'));
        return;
      }
      reject(e instanceof Error ? e : new Error(msg));
    };

    if (source.buffer) {
      try {
        loader.parse(
          source.buffer,
          '',
          (gltf) => resolve(gltf),
          (e) => fail(e)
        );
      } catch (e) {
        fail(e);
      }
      return;
    }

    if (source.url) {
      loader.load(
        source.url,
        (gltf) => resolve(gltf),
        (ev) => {
          if (ev.total > 0) onProgress?.(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
        },
        (e) => fail(e)
      );
      return;
    }

    reject(new Error('无可加载的模型数据'));
  });
