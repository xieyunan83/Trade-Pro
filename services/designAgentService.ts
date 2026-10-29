/**
 * 设计 Agent 生图：优先「数据接入 · 设计 Agent」配置，否则回退万相 Key 池。
 * 不读写 CRM。
 */
import { generateWanImage } from './wanImageService';
import { loadDataProviderLocal } from './dataProviders';
import { listPoolKeys } from './apiKeyPool';
import { env } from './env';
import { MULTI_ANGLE_VIEWS } from './creativeAssetBridge';
import { resolveToDataUrlOrHttps } from './creativeAssetVault';
import { compressImageDataUrl } from './catalogExcelService';

export type DesignGenerateOpts = {
  prompt: string;
  n?: number;
  size?: '1K' | '2K' | '4K';
  thinkingMode?: boolean;
  referenceImages?: string[];
};

export type DesignGenerateResult = {
  images: string[];
  engine: string;
  /** 多角度时与 images 一一对应 */
  angles?: string[];
};

export const getDesignAgentConfigStatus = (): {
  configured: boolean;
  label: string;
  detail: string;
} => {
  const design = loadDataProviderLocal('design_agent');
  if (design.enabled && (design.apiKey || '').trim()) {
    return {
      configured: true,
      label: '生图服务已就绪',
      detail: '可开始创作',
    };
  }
  const wan = listPoolKeys('wan');
  const qwen = listPoolKeys('qwen');
  if (wan.length || qwen.length || env.wanApiKey || env.qwenApiKey) {
    return {
      configured: true,
      label: '生图服务已就绪',
      detail: '可开始创作',
    };
  }
  return {
    configured: false,
    label: '待配置',
    detail: '请联系管理员开通生图服务',
  };
};

/** 业务员界面：去掉供应商/模型细节 */
const toUserFacingDesignError = (raw: string): string => {
  const msg = (raw || '').trim() || '生成失败';
  if (/Failed to fetch|NetworkError|Load failed|网络中断|生图请求网络/i.test(msg)) {
    return '生图请求中断。请硬刷新页面后重试；仍失败请将分辨率改为 1K，或联系管理员。';
  }
  if (/超时|timeout|AbortError/i.test(msg)) {
    return '生图等待超时。请改用 1K 分辨率后重试。';
  }
  if (/401|API Key|未配置|InvalidApiKey|鉴权|被拒绝/i.test(msg)) {
    return '生图服务暂不可用，请联系管理员检查配置。';
  }
  if (/model|不支持|不可用/i.test(msg)) {
    return '当前生图模型不可用，请联系管理员调整配置后重试。';
  }
  if (/413|Payload Too Large|FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large/i.test(msg)) {
    return '参考图总大小超限。请只保留 1～2 张清晰产品图后重试。';
  }
  return msg
    .replace(/万相|Token Plan|sk-sp-[\w-]*|阿里云|dashscope|wan2\.7[\w-]*/gi, '生图服务')
    .slice(0, 220);
};

const wanOverride = () => {
  const design = loadDataProviderLocal('design_agent');
  if (design.enabled && (design.apiKey || '').trim()) {
    return {
      apiKey: design.apiKey!.trim(),
      origin: (design.apiBase || '').trim() || undefined,
      modelId: (design.extra?.modelId || '').trim() || undefined,
    };
  }
  return undefined;
};

/** 云函数 body 上限约 4.5MB；多张原图 dataURL 极易 413 FUNCTION_PAYLOAD_TOO_LARGE */
const MAX_REF_IMAGES = 2;
const MAX_REF_DATA_CHARS = 900_000; // 单张约 <0.9MB，两张留余量给 prompt

const shrinkRefForUpload = async (url: string): Promise<string> => {
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith('data:image/')) return url;
  let out = url;
  if (out.length > 280_000) out = await compressImageDataUrl(out, 1024, 0.72);
  if (out.length > 450_000) out = await compressImageDataUrl(out, 768, 0.65);
  if (out.length > MAX_REF_DATA_CHARS) out = await compressImageDataUrl(out, 640, 0.58);
  return out;
};

const prepareReferenceImages = async (urls?: string[]): Promise<string[] | undefined> => {
  if (!urls?.length) return undefined;
  const out: string[] = [];
  let dataBudget = MAX_REF_DATA_CHARS * MAX_REF_IMAGES;
  for (const u of urls) {
    if (out.length >= MAX_REF_IMAGES) break;
    try {
      const resolved = await resolveToDataUrlOrHttps(u);
      if (!resolved) continue;
      if (!/^https?:\/\//i.test(resolved) && !resolved.startsWith('data:image/')) continue;
      const shrunk = await shrinkRefForUpload(resolved);
      if (shrunk.startsWith('data:image/')) {
        if (shrunk.length > dataBudget) {
          const tighter = await compressImageDataUrl(shrunk, 512, 0.55);
          if (tighter.length > dataBudget) continue;
          out.push(tighter);
          dataBudget -= tighter.length;
          continue;
        }
        dataBudget -= shrunk.length;
      }
      out.push(shrunk);
    } catch {
      /* 跳过坏参考 */
    }
  }
  return out.length ? out : undefined;
};

/** 去掉易触发「一张图拼多角」的措辞，保留产品描述 */
const stripMultiViewCollageLanguage = (prompt: string): string =>
  prompt
    .replace(
      /\b(multi[- ]?angle|multi[- ]?view|contact sheet|2\s*[x×]\s*2|four views?|quad[- ]?view|collage|grid of|panel set|turntable[- ]?reference)\b[^.!?\n]*/gi,
      ' '
    )
    .replace(/\b(front,?\s*(three[- ]?quarter|45°?|45 degrees?),?\s*side,?\s*back)\b/gi, ' ')
    .replace(/四视图拼版|四宫格|九宫格|拼版套图|一张图多角度/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const generateDesignImages = async (
  opts: DesignGenerateOpts
): Promise<DesignGenerateResult> => {
  const size = opts.size || '1K';
  const n = Math.min(4, Math.max(1, opts.n || 1));
  const timeoutMs = 240_000;
  const thinkingMode = opts.thinkingMode === true;
  const override = wanOverride();

  try {
    const refs = await prepareReferenceImages(opts.referenceImages);
    const result = await generateWanImage(
      {
        prompt: opts.prompt,
        size,
        n,
        thinkingMode,
        watermark: false,
        referenceImages: refs,
        timeoutMs,
      },
      override
    );
    return { images: result.images, engine: 'design' };
  } catch (e: any) {
    const raw = e?.message || String(e);
    if (/413|Payload Too Large|FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large/i.test(raw)) {
      throw new Error(
        '参考图总大小超限。请只保留 1～2 张清晰产品图后重试（已自动压缩仍过大时请换更小图）。'
      );
    }
    throw new Error(toUserFacingDesignError(raw));
  }
};

/** 同一产品连出 4 个标准视角（每张图仅一个视角）；后续视角用正面图作身份锁 */
export const generateMultiAngleDesignImages = async (
  opts: Omit<DesignGenerateOpts, 'n'> & {
    onProgress?: (done: number, total: number, label: string) => void;
  }
): Promise<DesignGenerateResult> => {
  const size = opts.size || '1K';
  const thinkingMode = false;
  const override = wanOverride();
  const images: string[] = [];
  const angles: string[] = [];
  const total = MULTI_ANGLE_VIEWS.length;
  const productBase = stripMultiViewCollageLanguage(opts.prompt.trim());
  const userRefs = await prepareReferenceImages(opts.referenceImages);
  /** 正面图锁定外形，避免四次独立抽卡变成四个不同设计 */
  let identityLockUrl: string | undefined;

  try {
    for (let i = 0; i < total; i++) {
      const view = MULTI_ANGLE_VIEWS[i];
      opts.onProgress?.(i, total, view.label);
      const refs = [
        ...(identityLockUrl ? [identityLockUrl] : []),
        ...(userRefs || []),
      ].slice(0, 4);
      const prompt = [
        productBase,
        `This request generates exactly one image for camera angle「${view.label}」only.`,
        view.prompt,
        'Never combine multiple angles into one frame.',
        identityLockUrl
          ? 'IDENTITY LOCK: Match the attached reference photograph exactly for shape, materials, silver finish, plastic accents, ear shape, leg proportions, screen size/placement and cartoon eyes. Only change camera orbit / viewing angle — do not redesign or recolor the product.'
          : 'Establish the definitive product look for this SKU; later angles will lock to this image.',
      ]
        .filter(Boolean)
        .join(' ');
      const result = await generateWanImage(
        {
          prompt,
          size,
          n: 1,
          thinkingMode,
          watermark: false,
          referenceImages: refs.length ? refs : undefined,
          timeoutMs: 180_000,
        },
        override
      );
      if (result.images[0]) {
        images.push(result.images[0]);
        angles.push(view.label);
        if (!identityLockUrl) identityLockUrl = result.images[0];
      }
      opts.onProgress?.(i + 1, total, view.label);
    }
    if (!images.length) throw new Error('多角度生图未返回图片');
    return { images, angles, engine: 'design' };
  } catch (e: any) {
    if (images.length) {
      // 部分成功也返回，便于下游继续用
      return { images, angles, engine: 'design' };
    }
    throw new Error(toUserFacingDesignError(e?.message || String(e)));
  }
};
