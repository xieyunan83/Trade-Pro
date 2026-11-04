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
import {
  COMMERCIAL_CRAFT_FOOTER,
  LAYOUT_SWAP_NEGATIVES,
  UNIVERSAL_IMAGE_NEGATIVES,
  composeImageGenerationPrompt,
  identityLockBlock,
  layoutProductSwapDirectiveBlock,
  lockedOnImageCopyBlock,
  mergeNegatives,
  multiImageRoleBlock,
  productCutoutCompositeBlock,
  referenceEditDirectiveBlock,
  typographySafeLayoutBlock,
} from './creativeQualityKit';

export type DesignGenerateOpts = {
  prompt: string;
  n?: number;
  size?: '1K' | '2K' | '4K';
  thinkingMode?: boolean;
  referenceImages?: string[];
  /** 额外负向（Skill / Brief） */
  negativePrompt?: string;
  /** Listing 等系列一致性 */
  series?: boolean;
  /** 末张参考图为版式/海报方案（前面为产品） */
  lastRefIsLayout?: boolean;
  /** 多 SKU 整合：每张产品图都必须入画 */
  distinctProducts?: boolean;
  /** 图面英文白名单（文案流水线产出） */
  lockedOnImageCopy?: string[];
  onImageLockBlock?: string;
  /** 用户二次创作说明：改颜色/部位/包装/功能等（有参考图时强制执行） */
  userEditBrief?: string;
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
    return '参考图总大小超限。请减少张数或换更小图后重试（系统会自动压缩）。';
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

/**
 * 云函数 body 上限约 4.5MB。支持最多 9 张（如 8 产品 + 1 版式），
 * 总 dataURL 预算约 3.2MB，单张再压到可塞进预算。
 */
export const MAX_DESIGN_REF_IMAGES = 9;
const MAX_REF_TOTAL_DATA_CHARS = 3_200_000;
const MAX_REF_SINGLE_CHARS = 480_000;

const shrinkRefForUpload = async (url: string, many: boolean): Promise<string> => {
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith('data:image/')) return url;
  let out = url;
  const edge1 = many ? 768 : 1024;
  const edge2 = many ? 560 : 768;
  const edge3 = many ? 448 : 640;
  if (out.length > 220_000) out = await compressImageDataUrl(out, edge1, many ? 0.62 : 0.72);
  if (out.length > 360_000) out = await compressImageDataUrl(out, edge2, many ? 0.55 : 0.65);
  if (out.length > MAX_REF_SINGLE_CHARS) out = await compressImageDataUrl(out, edge3, 0.5);
  return out;
};

const prepareReferenceImages = async (urls?: string[]): Promise<string[] | undefined> => {
  if (!urls?.length) return undefined;
  const capped = urls.filter(Boolean).slice(0, MAX_DESIGN_REF_IMAGES);
  const n = capped.length;
  // ≥3 张时按「均分预算」压图，禁止前 1 张吃光额度导致后几张被丢弃
  const many = n >= 3;
  const perCap = Math.floor(MAX_REF_TOTAL_DATA_CHARS / Math.max(1, n));
  const out: string[] = [];
  let dataBudget = MAX_REF_TOTAL_DATA_CHARS;
  for (const u of capped) {
    if (out.length >= MAX_DESIGN_REF_IMAGES) break;
    try {
      const resolved = await resolveToDataUrlOrHttps(u);
      if (!resolved) continue;
      if (!/^https?:\/\//i.test(resolved) && !resolved.startsWith('data:image/')) continue;
      let shrunk = await shrinkRefForUpload(resolved, many);
      if (shrunk.startsWith('data:image/')) {
        let edge = many ? 448 : 640;
        const hardCap = Math.min(perCap, dataBudget, MAX_REF_SINGLE_CHARS);
        while (shrunk.length > hardCap && edge >= 240) {
          shrunk = await compressImageDataUrl(shrunk, edge, edge <= 320 ? 0.42 : 0.5);
          edge = Math.floor(edge * 0.72);
        }
        if (shrunk.length > dataBudget) {
          shrunk = await compressImageDataUrl(shrunk, 240, 0.4);
        }
        // 仍超总预算：宁可再压也不跳过，保证用户选中的每张都尽量进请求
        if (shrunk.length > dataBudget) {
          console.warn(
            `[design] ref #${out.length + 1}/${n} still large (${shrunk.length}), forcing include`
          );
        }
        dataBudget = Math.max(0, dataBudget - shrunk.length);
      }
      out.push(shrunk);
    } catch {
      /* 跳过坏参考 */
    }
  }
  if (n >= 2 && out.length < n) {
    console.warn(`[design] prepared ${out.length}/${n} refs — some failed resolve/compress`);
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

/** 末道加固：即使上游 Brief 已含约束，仍确保身份锁与负向库在位 */
const hardenDesignPrompt = (
  prompt: string,
  hasRefs: boolean,
  opts: {
    negativePrompt?: string;
    series?: boolean;
    referenceCount?: number;
    lastRefIsLayout?: boolean;
    distinctProducts?: boolean;
    lockedOnImageCopy?: string[];
    onImageLockBlock?: string;
    userEditBrief?: string;
  }
): string => {
  const refCount = Math.max(0, opts.referenceCount || 0);
  const roleOpts = {
    lastIsLayout: !!opts.lastRefIsLayout && refCount >= 2,
    distinctProducts: !!opts.distinctProducts && !opts.lastRefIsLayout,
  };
  const textLock =
    (opts.onImageLockBlock || '').trim() ||
    lockedOnImageCopyBlock(opts.lockedOnImageCopy || []);
  const alreadyHardened =
    /NEGATIVE CONSTRAINTS/i.test(prompt) && /IDENTITY LOCK/i.test(prompt);
  if (alreadyHardened) {
    const extraNeg = mergeNegatives(
      opts.negativePrompt,
      'garbled English, invented words, Latin gibberish, fake body paragraphs on poster',
      'white product cards, rounded photo frames, boxed thumbnails, studio white backdrop behind product',
      'product covering text, toy overlapping headlines, text behind product, long prose paragraph on poster',
      opts.lastRefIsLayout ? LAYOUT_SWAP_NEGATIVES : ''
    );
    let withNeg =
      extraNeg && !prompt.includes(extraNeg.slice(0, 24))
        ? `${prompt}\nAlso avoid: ${extraNeg}`
        : prompt;
    // 有参考图时始终把用户改点钉在最前（即使 Brief 已含 IDENTITY LOCK）
    if (hasRefs) {
      const editBlock = referenceEditDirectiveBlock(opts.userEditBrief);
      if (!/USER EDIT REQUEST/i.test(withNeg)) {
        withNeg = `${editBlock}\n${withNeg}`;
      } else if (opts.userEditBrief?.trim() && !withNeg.includes(opts.userEditBrief.trim().slice(0, 40))) {
        withNeg = `${editBlock}\n${withNeg}`;
      }
    }
    // 多图：始终按真实张数重钉角色（纠正 Brief 默认「只认 Image 1」）
    if (refCount >= 2) {
      withNeg = withNeg
        .replace(/\n?REFERENCE: Image 1[^\n]*/gi, '')
        .replace(/\n?MULTI-IMAGE ROLES[^\n]*/gi, '')
        .replace(/\n?MULTI-PRODUCT INTEGRATION[^\n]*/gi, '')
        .replace(/\n?MULTI-VIEW REFERENCES[^\n]*/gi, '');
      if (opts.lastRefIsLayout) {
        const swap = layoutProductSwapDirectiveBlock(refCount - 1);
        if (!/CRITICAL TASK — LAYOUT SWAP/i.test(withNeg)) {
          withNeg = `${swap}\n${withNeg}`;
        }
      }
      withNeg = `${multiImageRoleBlock(refCount, roleOpts)}\n${withNeg}`;
    } else if (refCount === 1 && !/REFERENCE: Image 1|MULTI-IMAGE ROLES|MULTI-VIEW/i.test(withNeg)) {
      withNeg = `${withNeg}\n${multiImageRoleBlock(1, roleOpts)}`;
    }
    if (hasRefs && !/PRODUCT COMPOSITE/i.test(withNeg)) {
      withNeg = `${productCutoutCompositeBlock()}\n${withNeg}`;
    }
    if (!/TYPOGRAPHY SAFE LAYOUT/i.test(withNeg)) {
      withNeg = `${typographySafeLayoutBlock()}\n${withNeg}`;
    }
    // 始终重钉图面文字白名单，覆盖 Brief/模板里「写大段英文」的诱导
    withNeg = withNeg.replace(/\n?ON-IMAGE TEXT POLICY[\s\S]*?(?=\n[A-Z]{2,}|\nIDENTITY LOCK|\nNEGATIVE|$)/i, '\n');
    withNeg = `${textLock}\n${withNeg}`;
    if (hasRefs && !/IDENTITY LOCK/i.test(withNeg)) {
      withNeg = `${withNeg}\n${identityLockBlock(true, 'image')}`;
    }
    return withNeg;
  }
  return composeImageGenerationPrompt({
    baseToolPrompt: prompt,
    userBrief: opts.userEditBrief,
    hasReferenceImages: hasRefs,
    referenceCount: opts.referenceCount,
    lastRefIsLayout: opts.lastRefIsLayout,
    distinctProducts: opts.distinctProducts,
    lockedOnImageCopy: opts.lockedOnImageCopy,
    onImageLockBlock: opts.onImageLockBlock,
    skillNegative: opts.negativePrompt,
    series: !!opts.series,
  }).prompt;
};

export const generateDesignImages = async (
  opts: DesignGenerateOpts
): Promise<DesignGenerateResult> => {
  const size = opts.size || '1K';
  const n = Math.min(4, Math.max(1, opts.n || 1));
  const timeoutMs = 240_000;
  const thinkingMode = opts.thinkingMode === true;
  const override = wanOverride();

  try {
    const requestedRefCount = (opts.referenceImages || []).filter(Boolean).length;
    const refs = await prepareReferenceImages(opts.referenceImages);
    const hasRefs = !!(refs && refs.length);
    const refCount = refs?.length || 0;
    if (requestedRefCount >= 2 && refCount < requestedRefCount) {
      console.warn(
        `[design] only ${refCount}/${requestedRefCount} refs survived prepare — multi-view may degrade`
      );
    }
    const prompt = hardenDesignPrompt(opts.prompt, hasRefs, {
      negativePrompt: opts.negativePrompt,
      series: opts.series || n > 1,
      referenceCount: refCount,
      lastRefIsLayout: !!opts.lastRefIsLayout && refCount >= 2,
      distinctProducts: !!opts.distinctProducts,
      lockedOnImageCopy: opts.lockedOnImageCopy,
      onImageLockBlock: opts.onImageLockBlock,
      userEditBrief: opts.userEditBrief,
    });
    const result = await generateWanImage(
      {
        prompt,
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
        '参考图总大小超限。请减少张数或换更小图后重试（系统已自动压缩）。'
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
      const lockLine = identityLockUrl
        ? `${identityLockBlock(true, 'image')} Only change camera orbit / viewing angle — do not redesign or recolor the product.`
        : 'Establish the definitive product look for this SKU; later angles will lock to this image.';
      const prompt = [
        opts.userEditBrief?.trim()
          ? referenceEditDirectiveBlock(opts.userEditBrief)
          : userRefs?.length
            ? referenceEditDirectiveBlock()
            : '',
        productBase,
        `This request generates exactly one image for camera angle「${view.label}」only.`,
        view.prompt,
        'Never combine multiple angles into one frame.',
        lockLine,
        COMMERCIAL_CRAFT_FOOTER,
        `NEGATIVE CONSTRAINTS (must avoid): ${mergeNegatives(UNIVERSAL_IMAGE_NEGATIVES, opts.negativePrompt, 'multi-panel, collage, contact sheet, 2x2 grid, four views in one image, redesign between angles')}`,
      ]
        .filter(Boolean)
        .join('\n');
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
