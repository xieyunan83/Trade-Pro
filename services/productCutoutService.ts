/**
 * 产品主体抠图：优先本机去棚拍底，失败再走生图抠图。
 * 用于海报/平面生成前，避免把原图白底方框带进成图。
 */
import { resolveToDataUrlOrHttps, tryPersistMediaUrl } from './creativeAssetVault';
import { REMOVE_BG_PROMPT } from './posterTemplates';

export type CutoutProgress = (msg: string) => void;

/** 保透明通道缩放 PNG（禁止走白底 JPEG 压缩） */
const shrinkPngKeepAlpha = async (dataUrl: string, maxEdge = 1024): Promise<string> => {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

const isNearStudioBg = (r: number, g: number, b: number, a: number): boolean => {
  if (a < 20) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // 白/浅灰棚拍底
  if (min >= 228 && max - min <= 28) return true;
  if (min >= 210 && max - min <= 18 && (r + g + b) / 3 >= 220) return true;
  return false;
};

/** 从四角洪水填充去掉棚拍底，得到透明底 PNG dataURL；不明显则返回 null */
export const localStudioBackgroundCutout = async (
  src: string
): Promise<string | null> => {
  const resolved = await resolveToDataUrlOrHttps(src);
  if (!resolved || !resolved.startsWith('data:image/')) return null;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('cutout image load failed'));
    el.src = resolved;
  });

  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const { data } = imageData;
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (visited[i]) return;
    const o = i * 4;
    if (!isNearStudioBg(data[o], data[o + 1], data[o + 2], data[o + 3])) return;
    visited[i] = 1;
    stack.push(i);
  };
  // 四角 + 边上采样，覆盖常见棚拍白底
  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 24))) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 24))) {
    push(0, y);
    push(w - 1, y);
  }
  push(0, 0);
  push(w - 1, 0);
  push(0, h - 1);
  push(w - 1, h - 1);

  let cleared = 0;
  while (stack.length) {
    const i = stack.pop()!;
    const o = i * 4;
    data[o + 3] = 0;
    cleared += 1;
    const x = i % w;
    const y = (i / w) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  const total = w * h;
  const ratio = cleared / total;
  // 清得太少=不是棚拍底；清得太多=误伤主体
  if (ratio < 0.08 || ratio > 0.82) return null;

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

const apiRemoveBackground = async (src: string): Promise<string | null> => {
  try {
    const { generateWanImage } = await import('./wanImageService');
    const res = await generateWanImage({
      prompt: REMOVE_BG_PROMPT,
      referenceImages: [src],
      size: '1K',
      n: 1,
      thinkingMode: false,
      watermark: false,
      timeoutMs: 90_000,
    });
    const url = res.images[0];
    if (!url) return null;
    return (await tryPersistMediaUrl(url, 'image')) || url;
  } catch (e) {
    console.warn('[cutout] api remove-bg failed', e);
    return null;
  }
};

/**
 * 单张：先本机去棚拍底，不够干净再调生图抠图。
 */
export const cutoutProductSubject = async (
  src: string,
  opts?: { allowApi?: boolean }
): Promise<string> => {
  const allowApi = opts?.allowApi !== false;
  try {
    const local = await localStudioBackgroundCutout(src);
    if (local) {
      const compressed = await shrinkPngKeepAlpha(local, 1024);
      return (await tryPersistMediaUrl(compressed, 'image')) || compressed;
    }
  } catch (e) {
    console.warn('[cutout] local failed', e);
  }
  if (allowApi) {
    const api = await apiRemoveBackground(src);
    if (api) return api;
  }
  return src;
};

/**
 * 批量抠产品图。lastIsLayout 时末张版式不抠。
 */
export const ensureProductCutouts = async (
  refs: string[],
  opts?: {
    lastIsLayout?: boolean;
    allowApi?: boolean;
    onProgress?: CutoutProgress;
  }
): Promise<string[]> => {
  if (!refs.length) return [];
  const lastIsLayout = !!opts?.lastIsLayout && refs.length >= 2;
  const productCount = lastIsLayout ? refs.length - 1 : refs.length;
  const out: string[] = [];
  for (let i = 0; i < refs.length; i++) {
    const isLayout = lastIsLayout && i === refs.length - 1;
    if (isLayout) {
      out.push(refs[i]);
      continue;
    }
    opts?.onProgress?.(`正在抠出产品主体 ${i + 1}/${productCount}…`);
    out.push(await cutoutProductSubject(refs[i], { allowApi: opts?.allowApi }));
  }
  return out;
};
