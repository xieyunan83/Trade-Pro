/**
 * GLB/GLTF 统一加载：支持 vault/blob/https，并挂 Draco / Meshopt / KTX2。
 * 优先 ArrayBuffer + parse，避免 blob: URL 被撤销导致「预览加载失败」。
 * 缺 KTX2 时压缩贴图会静默丢失 → 模型一片灰（相对 model-viewer 的常见回退）。
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { fetchRemoteBlob, peekRemoteBlob, rememberRemoteBlob } from './fetchRemoteBlob';
import { isVaultRef, resolveMediaBlob, resolveMediaUrl } from './creativeAssetVault';

const baseUrl = () => `${(import.meta as any).env?.BASE_URL || '/'}`;

let sharedDraco: DRACOLoader | null = null;
let sharedKtx2: KTX2Loader | null = null;
let ktx2SupportRenderer: THREE.WebGLRenderer | null = null;

const getDracoLoader = (): DRACOLoader => {
  if (sharedDraco) return sharedDraco;
  const draco = new DRACOLoader();
  // 同源静态资源（public/draco），不受外链 CSP 影响
  draco.setDecoderPath(`${baseUrl()}draco/`);
  draco.setDecoderConfig({ type: 'wasm' });
  sharedDraco = draco;
  return draco;
};

/** 同源优先；弱网下同源 basis.js 半截失败时回退 jsDelivr（CSP 已放行） */
const BASIS_PATHS = () => [
  `${baseUrl()}basis/`,
  'https://cdn.jsdelivr.net/npm/three@0.183.2/examples/jsm/libs/basis/',
];

const getKtx2Loader = (renderer: THREE.WebGLRenderer, pathIndex = 0): KTX2Loader => {
  // pathIndex 变化时必须重建，否则备用 CDN 路径永远不生效
  if (sharedKtx2 && (sharedKtx2 as any).__basisPathIndex !== pathIndex) {
    try {
      sharedKtx2.dispose?.();
    } catch {
      /* ignore */
    }
    sharedKtx2 = null;
    ktx2SupportRenderer = null;
  }
  if (!sharedKtx2) {
    const ktx2 = new KTX2Loader();
    const paths = BASIS_PATHS();
    ktx2.setTranscoderPath(paths[Math.min(pathIndex, paths.length - 1)]);
    (ktx2 as any).__basisPathIndex = pathIndex;
    sharedKtx2 = ktx2;
  }
  if (ktx2SupportRenderer !== renderer) {
    sharedKtx2.detectSupport(renderer);
    ktx2SupportRenderer = renderer;
  }
  return sharedKtx2;
};

/** 贴图解码失败时换备用 transcoder 路径再试一次 */
export const resetKtx2Loader = () => {
  try {
    sharedKtx2?.dispose?.();
  } catch {
    /* ignore */
  }
  sharedKtx2 = null;
  ktx2SupportRenderer = null;
};

export const createGlbLoader = async (
  renderer?: THREE.WebGLRenderer | null,
  basisPathIndex = 0
): Promise<GLTFLoader> => {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  try {
    // Meshopt 需等 wasm ready，否则几何/材质偶发异常发灰
    const ready = (MeshoptDecoder as { ready?: Promise<unknown> }).ready;
    if (ready) await ready;
    loader.setMeshoptDecoder(MeshoptDecoder);
  } catch {
    /* Meshopt 不可用时仍可加载普通 GLB */
  }
  if (renderer) {
    try {
      const ktx2 = getKtx2Loader(renderer, basisPathIndex);
      // 先拉起 Basis worker；否则首帧贴图常静默丢失 → 一片灰
      const initFn = (ktx2 as { init?: () => Promise<unknown> }).init;
      if (typeof initFn === 'function') {
        await initFn.call(ktx2);
      }
      loader.setKTX2Loader(ktx2);
    } catch (e) {
      console.warn('[glb] KTX2Loader init failed; textured models may appear grey', e);
    }
  }
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

/** 确保贴图色彩空间正确，避免看起来发灰/发白 */
export const normalizeGltfMaterials = (root: THREE.Object3D) => {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const std = mat as THREE.MeshStandardMaterial;
      const maps = [
        std.map,
        std.emissiveMap,
        (std as any).albedoMap,
      ].filter(Boolean) as THREE.Texture[];
      for (const tex of maps) {
        if (tex.colorSpace !== THREE.SRGBColorSpace) {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
        }
      }
      std.needsUpdate = true;
    }
  });
};

const parseOnce = (
  loader: GLTFLoader,
  source: GlbSource,
  onProgress?: (pct: number) => void
): Promise<GLTF> =>
  new Promise((resolve, reject) => {
    const fail = (e: unknown) => {
      const msg = String((e as any)?.message || e || 'GLB 解析失败');
      if (/DRACO|draco|KHR_draco/i.test(msg)) {
        reject(new Error('模型使用了 Draco 压缩，解码失败。请刷新页面后重试预览。'));
        return;
      }
      if (/KTX2|Basis|transcoder/i.test(msg)) {
        reject(new Error('模型贴图解码失败。请刷新页面后重试预览。'));
        return;
      }
      reject(e instanceof Error ? e : new Error(msg));
    };

    const ok = (gltf: GLTF) => {
      try {
        normalizeGltfMaterials(gltf.scene);
      } catch {
        /* ignore */
      }
      resolve(gltf);
    };

    if (source.buffer) {
      try {
        loader.parse(source.buffer, '', (gltf) => ok(gltf), (e) => fail(e));
      } catch (e) {
        fail(e);
      }
      return;
    }

    if (source.url) {
      loader.load(
        source.url,
        (gltf) => ok(gltf),
        (ev) => {
          if (ev.total > 0) onProgress?.(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
        },
        (e) => fail(e)
      );
      return;
    }

    reject(new Error('无可加载的模型数据'));
  });

export const sceneHasColorMaps = (root: THREE.Object3D): boolean => {
  let hit = false;
  root.traverse((o) => {
    if (hit) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std?.map || (std as any)?.emissiveMap) {
        hit = true;
        return;
      }
    }
  });
  return hit;
};

export const bufferLikelyHasKtx2 = (buf?: ArrayBuffer): boolean => {
  if (!buf || buf.byteLength < 32) return false;
  const head = new TextDecoder('latin1').decode(
    new Uint8Array(buf, 0, Math.min(buf.byteLength, 1_500_000))
  );
  return /KHR_texture_basisu|basisu/i.test(head);
};

/** 供预览层判断：文件内嵌了压缩贴图但场景无 map → 应回退 model-viewer */
export const glbTextureDecodeFailed = (source: GlbSource, root: THREE.Object3D): boolean =>
  bufferLikelyHasKtx2(source.buffer) && !sceneHasColorMaps(root);

export const loadGlbFromSource = async (
  source: GlbSource,
  onProgress?: (pct: number) => void,
  renderer?: THREE.WebGLRenderer | null
): Promise<GLTF> => {
  const tryLoad = async (basisIdx: number) => {
    const loader = await createGlbLoader(renderer, basisIdx);
    return parseOnce(loader, source, onProgress);
  };

  try {
    const gltf = await tryLoad(0);
    // KTX2 失败时常「静默变灰」而不抛错：有压缩贴图标记却无 map → 换 transcoder 再解
    if (
      renderer &&
      bufferLikelyHasKtx2(source.buffer) &&
      !sceneHasColorMaps(gltf.scene)
    ) {
      try {
        resetKtx2Loader();
        const again = await tryLoad(1);
        if (sceneHasColorMaps(again.scene) || !sceneHasColorMaps(gltf.scene)) {
          return again;
        }
      } catch {
        /* 仍返回首次结果 */
      }
    }
    return gltf;
  } catch (e) {
    const msg = String((e as any)?.message || e || '');
    // 同源 basis 半截失败时换备用路径再解一次
    if (renderer && /贴图解码|KTX2|Basis|transcoder|fetch/i.test(msg)) {
      try {
        resetKtx2Loader();
        return await tryLoad(1);
      } catch {
        /* fall through */
      }
    }
    throw e;
  }
};
