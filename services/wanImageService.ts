import { env } from './env';
import { getApiConfig as getSupabaseApiConfig } from './supabase';
import {
  buildAliyunFetchHeaders,
  DEFAULT_TOKEN_PLAN_ORIGIN,
  isLocalDevHost,
  resolveQwenRequestTarget,
} from './qwenProxy';

const LS_KEY = 'trade_scout_wan_api_key';
const LS_BASE = 'trade_scout_wan_base_url';
const LS_MODEL = 'trade_scout_wan_model_id';

const DEFAULT_WAN_MODEL = 'wan2.7-image';
const WAN_PATH = '/api/v1/services/aigc/multimodal-generation/generation';

const sanitizeApiKey = (key: string): string =>
  (key || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();

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

/** sk-sp- Token Plan Key 必须打到 token-plan 域名，否则必 401 */
const normalizeWanOrigin = (apiKey: string, rawBase: string): string => {
  let origin = extractAliyunOrigin(rawBase);
  if (apiKey.startsWith('sk-sp-')) {
    if (!/token-plan/i.test(origin)) {
      console.warn('[Wan] sk-sp Key 但 Origin 不是 token-plan，已自动纠正为 Token Plan 域名');
      origin = DEFAULT_TOKEN_PLAN_ORIGIN;
    }
  } else if (/token-plan/i.test(origin) && apiKey && !apiKey.startsWith('sk-sp-')) {
    console.warn('[Wan] token-plan 域名配了非 sk-sp Key，鉴权极易 401');
  }
  return origin;
};

export const resolveWanImageConfig = async (
  override?: Partial<WanImageConfig>
): Promise<WanImageConfig> => {
  const localKey = readLocal(LS_KEY);
  const localBase = readLocal(LS_BASE);
  const localModel = readLocal(LS_MODEL);

  let cloud: Awaited<ReturnType<typeof getSupabaseApiConfig>> = null;
  if (!override?.apiKey && !localKey) {
    try {
      cloud = await Promise.race([
        getSupabaseApiConfig('wan').catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
      ]);
    } catch {
      cloud = null;
    }
  }

  // 未单独配置万相时，回退到千问 Token Plan 同一套 Key / 域名
  const qwenKey = readLocal('trade_scout_qwen_api_key') || env.qwenApiKey;
  const qwenBase = readLocal('trade_scout_qwen_base_url') || env.qwenBaseUrl;

  const apiKey = sanitizeApiKey(
    override?.apiKey || localKey || cloud?.apiKey || qwenKey || ''
  );
  const rawBase =
    override?.origin ||
    localBase ||
    cloud?.baseUrl ||
    qwenBase ||
    DEFAULT_TOKEN_PLAN_ORIGIN;
  const origin = normalizeWanOrigin(apiKey, rawBase);
  const modelId = (
    override?.modelId ||
    localModel ||
    cloud?.modelId ||
    env.wanModelId ||
    DEFAULT_WAN_MODEL
  ).trim();

  if (!apiKey) {
    throw new Error(
      '未配置万相 API Key。请在管理后台「万相图片生成」中填写，或先配置千问 Token Plan Key。'
    );
  }

  return { apiKey, origin, modelId };
};

const buildRequestUrl = (origin: string): { url: string; proxyOrigin?: string } => {
  const absolute = `${origin.replace(/\/$/, '')}${WAN_PATH}`;
  if (isLocalDevHost()) {
    return { url: `/qwen-api${WAN_PATH}`, proxyOrigin: origin };
  }
  const resolved = resolveQwenRequestTarget(absolute);
  return { url: resolved.url, proxyOrigin: resolved.proxyOrigin || origin };
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
  options: GenerateWanImageOptions,
  configOverride?: Partial<WanImageConfig>
): Promise<WanImageResult> => {
  const config = await resolveWanImageConfig(configOverride);
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

  const headers = buildAliyunFetchHeaders({
    targetUrl: url,
    apiKey: config.apiKey,
    proxyOrigin: proxyOrigin || config.origin,
    extra: {
      // 双通道传上游 path，避免个别环境下 query 解码异常
      'X-Upstream-Path': WAN_PATH,
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('万相请求超时（90 秒）。请检查网络或稍后重试。');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`万相返回非 JSON: ${response.status} ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const msg = data?.message || data?.error?.message || text.slice(0, 300);
    const proxiedTo = response.headers.get('X-Proxied-To') || config.origin;
    if (response.status === 401) {
      throw new Error(
        `万相 API Key 被拒绝 (401)。目标=${proxiedTo}；` +
          `请确认：① Key 为 Token Plan 的 sk-sp-…（与千问同一把）；` +
          `② Base 为 ${DEFAULT_TOKEN_PLAN_ORIGIN}；` +
          `③ 套餐已开通图片/万相。详情: ${msg}`
      );
    }
    if (response.status === 400 && /model|not.?support|不支持|not found/i.test(String(msg))) {
      throw new Error(
        `万相模型不可用 (${config.modelId})。请确认 Token Plan 已开通 wan2.7-image，或改用控制台列出的图片模型。详情: ${msg}`
      );
    }
    throw new Error(`万相生成失败 (${response.status}): ${msg}`);
  }

  const images = extractImageUrls(data);
  if (images.length === 0) {
    throw new Error(
      '万相未返回图片 URL，请检查模型是否为 wan2.7-image / wan2.7-image-pro，以及套餐是否开通万相。'
    );
  }
  return { images, raw: data };
};

export const testWanImageApi = async (
  override?: Partial<WanImageConfig>
): Promise<{ success: boolean; message: string }> => {
  try {
    const config = await resolveWanImageConfig(override);
    if (config.apiKey.startsWith('sk-sp-') && !/token-plan/i.test(config.origin)) {
      return {
        success: false,
        message: `配置不匹配：sk-sp Key 必须使用 ${DEFAULT_TOKEN_PLAN_ORIGIN}`,
      };
    }
    if (!config.apiKey.startsWith('sk-sp-') && /token-plan/i.test(config.origin)) {
      return {
        success: false,
        message: '配置不匹配：token-plan 域名必须使用 sk-sp- 开头的 Token Plan Key',
      };
    }

    const result = await Promise.race([
      generateWanImage(
        {
          prompt: '一张简洁的蓝色商务名片背景，纯色，无文字',
          size: '1K',
          n: 1,
          thinkingMode: false,
        },
        config
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('万相连接测试超时（45 秒）')), 45_000)
      ),
    ]);
    return { success: true, message: `万相连接成功 ✅ 已生成 ${result.images.length} 张图` };
  } catch (e: any) {
    return { success: false, message: `万相测试失败: ${String(e?.message || e).slice(0, 280)}` };
  }
};
