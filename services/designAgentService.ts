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
  return msg
    .replace(/万相|Token Plan|sk-sp-[\w-]*|阿里云|dashscope|wan2\.7[\w-]*/gi, '生图服务')
    .slice(0, 220);
};

export const generateDesignImages = async (
  opts: DesignGenerateOpts
): Promise<DesignGenerateResult> => {
  const design = loadDataProviderLocal('design_agent');
  const size = opts.size || '2K';
  const n = Math.min(4, Math.max(1, opts.n || 1));
  const timeoutMs = 240_000;

  // 默认关闭深度思考：同步通道下更快更稳；调用方可显式传 true
  const thinkingMode = opts.thinkingMode === true;

  try {
    if (design.enabled && (design.apiKey || '').trim()) {
      const result = await generateWanImage(
        {
          prompt: opts.prompt,
          size,
          n,
          thinkingMode,
          watermark: false,
          referenceImages: opts.referenceImages,
          timeoutMs,
        },
        {
          apiKey: design.apiKey!.trim(),
          origin: (design.apiBase || '').trim() || undefined,
          modelId: (design.extra?.modelId || '').trim() || undefined,
        }
      );
      return {
        images: result.images,
        engine: 'design',
      };
    }

    const result = await generateWanImage({
      prompt: opts.prompt,
      size,
      n,
      thinkingMode,
      watermark: false,
      referenceImages: opts.referenceImages,
      timeoutMs,
    });
    return { images: result.images, engine: 'design' };
  } catch (e: any) {
    throw new Error(toUserFacingDesignError(e?.message || String(e)));
  }
};
