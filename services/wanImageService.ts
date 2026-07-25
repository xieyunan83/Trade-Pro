import { env } from './env';
import { getApiConfig as getSupabaseApiConfig } from './supabase';

const LS_KEY = 'trade_scout_wan_api_key';
const LS_BASE = 'trade_scout_wan_base_url';
const LS_MODEL = 'trade_scout_wan_model_id';

const DEFAULT_WAN_MODEL = 'wan2.7-image';
const DEFAULT_TOKEN_PLAN_ORIGIN = 'https://token-plan.cn-beijing.maas.aliyuncs.com';

export interface WanImageConfig {
  apiKey: string;
  /** 原始完整 Origin，如 https://token-plan.cn-beijing.maas.aliyuncs.com */
  origin: string;
  modelId: string;
}

export interface GenerateWanImageOptions {
  prompt: string;
  size?: '1K' | '2K' | '4K';
  n?: number;
  watermark?: boolean;
  thinkingMode?: boolean;
  /** 可选参考图 URL（图生图 / 编辑） */
  referenceImages?: string[];
}

export interface WanImageResult {
  images: string[];
  raw?: unknown;
}

const isDevHost = () =>
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const readLocal = (key: string) =>
  typeof localStorage !== 'undefined' ? localStorage.getItem(key)?.trim() || '' : '';

/** 从 OpenAI 兼容地址或 Origin 提取阿里云 Origin */
export const extractAliyunOrigin = (raw: string): string => {
  const trimmed = (raw || '').trim().replace(/\/$/, '');
  if (!trimmed) return DEFAULT_TOKEN_PLAN_ORIGIN;
  try {
    if (trimmed.startsWith('http')) return new URL(trimmed).origin;
  } catch {
    /* fallthrough */
  }
  if (trimmed.startsWith('/')) return DEFAULT_TOKEN_PLAN_ORIGIN;
  return `https://${trimmed.split('/')[0]}`;
};

export const resolveWanImageConfig = async (): Promise<WanImageConfig> => {
  const localKey = readLocal(LS_KEY);
  const localBase = readLocal(LS_BASE);
  const localModel = readLocal(LS_MODEL);

  let cloud: Awaited<ReturnType<typeof getSupabaseApiConfig>> = null;
  if (!localKey) {
    cloud = await getSupabaseApiConfig('wan');
  }

  // 未单独配置万相时，回退到千问 Token Plan 同一套 Key / 域名
  const qwenKey = readLocal('trade_scout_qwen_api_key') || env.qwenApiKey;
  const qwenBase = readLocal('trade_scout_qwen_base_url') || env.qwenBaseUrl;

  const apiKey = (localKey || cloud?.apiKey || qwenKey || '').trim();
  const rawBase =
    localBase || cloud?.baseUrl || qwenBase || DEFAULT_TOKEN_PLAN_ORIGIN;
  const origin = extractAliyunOrigin(rawBase);
  const modelId = localModel || cloud?.modelId || env.wanModelId || DEFAULT_WAN_MODEL;

  if (!apiKey) {
    throw new Error('未配置万相 API Key。请在管理后台「万相图片生成」中填写，或先配置千问 Token Plan Key。');
  }

  return { apiKey, origin, modelId };
};

const buildRequestUrl = (origin: string): { url: string; proxyOrigin?: string } => {
  const path = '/api/v1/services/aigc/multimodal-generation/generation';
  if (isDevHost()) {
    return { url: `/qwen-api${path}`, proxyOrigin: origin };
  }
  return { url: `${origin}${path}` };
};

const extractImageUrls = (data: any): string[] => {
  const urls: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:'))) urls.push(v);
  };

  const choices = data?.output?.choices;
  if (Array.isArray(choices)) {
    for (const c of choices) {
      const content = c?.message?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          push(part?.image || part?.url || part?.image_url);
        }
      }
    }
  }

  const results = data?.output?.results;
  if (Array.isArray(results)) {
    for (const r of results) push(r?.url || r?.image);
  }

  if (Array.isArray(data?.data)) {
    for (const d of data.data) push(d?.url || d?.b64_json ? `data:image/png;base64,${d.b64_json}` : '');
  }

  return [...new Set(urls.filter(Boolean))];
};

export const generateWanImage = async (
  options: GenerateWanImageOptions
): Promise<WanImageResult> => {
  const config = await resolveWanImageConfig();
  const { url, proxyOrigin } = buildRequestUrl(config.origin);

  const content: Array<Record<string, string>> = [];
  for (const img of options.referenceImages || []) {
    if (img?.trim()) content.push({ image: img.trim() });
  }
  content.push({ text: options.prompt.trim() });

  const body = {
    model: config.modelId,
    input: {
      messages: [{ role: 'user', content }],
    },
    parameters: {
      size: options.size || '2K',
      n: Math.min(Math.max(options.n || 1, 1), 4),
      watermark: options.watermark ?? false,
      thinking_mode: options.thinkingMode ?? true,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (proxyOrigin) headers['X-Qwen-Origin'] = proxyOrigin;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`万相返回非 JSON: ${response.status} ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const msg = data?.message || data?.error?.message || text.slice(0, 300);
    if (response.status === 401) {
      throw new Error(`万相 API Key 被拒绝 (401)。请确认使用 Token Plan 的 sk-sp-... Key，且 Base 为 token-plan 域名。详情: ${msg}`);
    }
    throw new Error(`万相生成失败 (${response.status}): ${msg}`);
  }

  const images = extractImageUrls(data);
  if (images.length === 0) {
    throw new Error('万相未返回图片 URL，请检查模型是否为 wan2.7-image / wan2.7-image-pro，以及套餐是否开通万相。');
  }
  return { images, raw: data };
};

export const testWanImageApi = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const result = await generateWanImage({
      prompt: '一张简洁的蓝色商务名片背景，纯色，无文字',
      size: '1K',
      n: 1,
      thinkingMode: false,
    });
    return { success: true, message: `万相连接成功 ✅ 已生成 ${result.images.length} 张图` };
  } catch (e: any) {
    return { success: false, message: `万相测试失败: ${e.message}` };
  }
};
