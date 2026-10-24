/**
 * 设计 Agent 生图：优先「数据接入 · 设计 Agent」配置，否则回退万相 Key 池。
 * 不读写 CRM。
 */
import { generateWanImage } from './wanImageService';
import { loadDataProviderLocal } from './dataProviders';
import { listPoolKeys } from './apiKeyPool';
import { env } from './env';

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
      label: '设计 Agent API',
      detail: design.extra?.modelId || design.apiBase || '已配置专属 Key',
    };
  }
  const wan = listPoolKeys('wan');
  const qwen = listPoolKeys('qwen');
  if (wan.length || qwen.length || env.wanApiKey || env.qwenApiKey) {
    return {
      configured: true,
      label: '万相 / 千问（回退）',
      detail: '未配专属设计 Agent 时使用现有万相生图',
    };
  }
  return {
    configured: false,
    label: '未配置',
    detail: '请到管理后台「数据接入」填写设计 Agent，或配置万相 Key',
  };
};

export const generateDesignImages = async (
  opts: DesignGenerateOpts
): Promise<DesignGenerateResult> => {
  const design = loadDataProviderLocal('design_agent');
  const size = opts.size || '2K';
  const n = Math.min(4, Math.max(1, opts.n || 1));

  if (design.enabled && (design.apiKey || '').trim()) {
    const result = await generateWanImage(
      {
        prompt: opts.prompt,
        size,
        n,
        thinkingMode: opts.thinkingMode !== false,
        watermark: false,
        referenceImages: opts.referenceImages,
        timeoutMs: 120_000,
      },
      {
        apiKey: design.apiKey!.trim(),
        origin: (design.apiBase || '').trim() || undefined,
        modelId: (design.extra?.modelId || '').trim() || undefined,
      }
    );
    return {
      images: result.images,
      engine: design.extra?.modelId || 'design_agent',
    };
  }

  const result = await generateWanImage({
    prompt: opts.prompt,
    size,
    n,
    thinkingMode: opts.thinkingMode !== false,
    watermark: false,
    referenceImages: opts.referenceImages,
    timeoutMs: 120_000,
  });
  return { images: result.images, engine: 'wan' };
};
