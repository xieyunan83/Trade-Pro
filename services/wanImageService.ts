import { env } from './env';
import { getApiConfig as getSupabaseApiConfig } from './supabase';
import { getActivePoolKey } from './apiKeyPool';
import {
  buildAliyunFetchHeaders,
  DEFAULT_TOKEN_PLAN_ORIGIN,
  isLocalDevHost,
  qwenCorsHint,
  resolveQwenRequestTarget,
} from './qwenProxy';

const LS_KEY = 'trade_scout_wan_api_key';
const LS_BASE = 'trade_scout_wan_base_url';
const LS_MODEL = 'trade_scout_wan_model_id';

const DEFAULT_WAN_MODEL = 'wan2.7-image-pro';
const WAN_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const TASK_PATH = (id: string) => `/api/v1/tasks/${encodeURIComponent(id)}`;

const sanitizeApiKey = (key: string): string =>
  (key || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  /** 总等待上限（毫秒），含异步轮询；电商长图建议 180000+ */
  timeoutMs?: number;
}

export interface WanImageResult {
  images: string[];
  raw?: unknown;
  taskId?: string;
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
  const wanPoolKey = getActivePoolKey('wan');
  const qwenKey = getActivePoolKey('qwen') || readLocal('trade_scout_qwen_api_key') || env.qwenApiKey;
  const qwenBase = readLocal('trade_scout_qwen_base_url') || env.qwenBaseUrl;

  const apiKey = sanitizeApiKey(
    override?.apiKey || wanPoolKey || localKey || cloud?.apiKey || qwenKey || ''
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

const buildUrl = (origin: string, path: string): { url: string; proxyOrigin?: string } => {
  const absolute = `${origin.replace(/\/$/, '')}${path}`;
  if (isLocalDevHost()) {
    return { url: `/qwen-api${path}`, proxyOrigin: origin };
  }
  const resolved = resolveQwenRequestTarget(absolute);
  return { url: resolved.url, proxyOrigin: resolved.proxyOrigin || origin };
};

const parseJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`万相返回非 JSON: ${res.status} ${text.slice(0, 200)}`);
  }
};

const networkFailMessage = (e: any, action: string): string => {
  const msg = String(e?.message || e || '');
  if (e?.name === 'AbortError' || /aborted|timeout/i.test(msg)) {
    return `${action}超时，请稍后重试。`;
  }
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return `${action}网络中断。请检查网络后重试。${qwenCorsHint(msg)}`;
  }
  return `${action}失败：${msg}${qwenCorsHint(msg)}`;
};

/** 仅公网 URL / data URL；blob/file 无法被上游拉取 */
const sanitizeRefImages = (imgs?: string[]): string[] =>
  (imgs || [])
    .map((s) => (s || '').trim())
    .filter((s) => /^https?:\/\//i.test(s) || s.startsWith('data:image/'))
    .slice(0, 4);

const extractImageUrls = (data: any): string[] => {
  const urls: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:'))) urls.push(v);
  };

  const bags = [data, data?.output, data?.output?.output].filter(Boolean);
  for (const bag of bags) {
    const choices = bag?.choices;
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
    const results = bag?.results;
    if (Array.isArray(results)) {
      for (const r of results) push(r?.url || r?.image);
    }
  }

  if (Array.isArray(data?.data)) {
    for (const d of data.data) push(d?.url || (d?.b64_json ? `data:image/png;base64,${d.b64_json}` : ''));
  }

  return [...new Set(urls.filter(Boolean))];
};

const throwHttpError = (status: number, data: any, config: WanImageConfig, proxiedTo: string) => {
  const msg = data?.message || data?.error?.message || data?.code || JSON.stringify(data).slice(0, 300);
  if (status === 401) {
    throw new Error(
      `万相 API Key 被拒绝 (401)。目标=${proxiedTo}；` +
        `请确认：① Key 为 Token Plan 的 sk-sp-…（与千问同一把）；` +
        `② Base 为 ${DEFAULT_TOKEN_PLAN_ORIGIN}；` +
        `③ 套餐已开通图片/万相。详情: ${msg}`
    );
  }
  if (status === 400 && /model|not.?support|不支持|not found/i.test(String(msg))) {
    throw new Error(
      `万相模型不可用 (${config.modelId})。请确认 Token Plan 已开通 wan2.7-image-pro，或改用控制台列出的图片模型。详情: ${msg}`
    );
  }
  throw new Error(`万相生成失败 (${status}): ${msg}`);
};

/**
 * 异步提交生图任务（短请求），避免同步长连接被网关掐断导致浏览器 Failed to fetch。
 */
const submitAsyncTask = async (
  config: WanImageConfig,
  body: Record<string, unknown>
): Promise<string> => {
  const { url, proxyOrigin } = buildUrl(config.origin, WAN_PATH);
  const headers = buildAliyunFetchHeaders({
    targetUrl: url,
    apiKey: config.apiKey,
    proxyOrigin: proxyOrigin || config.origin,
    extra: {
      'X-DashScope-Async': 'enable',
      'X-Upstream-Path': WAN_PATH,
    },
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    throw new Error(networkFailMessage(e, '提交生图任务'));
  }

  const data = await parseJson(response);
  if (!response.ok) {
    throwHttpError(
      response.status,
      data,
      config,
      response.headers.get('X-Proxied-To') || config.origin
    );
  }

  const taskId = data?.output?.task_id || data?.task_id;
  if (!taskId) {
    // 个别账号仍走同步：直接带图返回
    const syncImages = extractImageUrls(data);
    if (syncImages.length) return `__sync__:${syncImages.join('\n')}`;
    throw new Error('生图任务已受理但未返回 task_id，请稍后重试');
  }
  return String(taskId);
};

const pollTask = async (
  config: WanImageConfig,
  taskId: string,
  timeoutMs: number
): Promise<{ images: string[]; raw: unknown }> => {
  const path = TASK_PATH(taskId);
  const { url, proxyOrigin } = buildUrl(config.origin, path);
  const headers = buildAliyunFetchHeaders({
    targetUrl: url,
    apiKey: config.apiKey,
    proxyOrigin: proxyOrigin || config.origin,
    extra: { 'X-Upstream-Path': path },
  });

  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < timeoutMs) {
    attempt += 1;
    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', headers });
    } catch (e: any) {
      // 轮询偶发断线：短暂等待后继续，不立刻失败
      if (attempt < 3 || Date.now() - started < timeoutMs - 5_000) {
        await sleep(2_000);
        continue;
      }
      throw new Error(networkFailMessage(e, '查询生图进度'));
    }

    const data = await parseJson(response);
    if (!response.ok && !data?.output) {
      throwHttpError(
        response.status,
        data,
        config,
        response.headers.get('X-Proxied-To') || config.origin
      );
    }

    const out = data?.output || data;
    const status = String(out?.task_status || out?.status || '').toUpperCase();

    if (status === 'SUCCEEDED' || status === 'SUCCESS') {
      const images = extractImageUrls(data);
      if (!images.length) {
        throw new Error('生图完成但未返回图片地址，请重试');
      }
      return { images, raw: data };
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
      throw new Error(out?.message || out?.code || data?.message || `生图失败（${status || 'FAILED'}）`);
    }

    await sleep(attempt < 4 ? 1_500 : 2_500);
  }

  throw new Error(
    `生图等待超时（${Math.round(timeoutMs / 1000)} 秒）。可关掉「深度思考」或降低分辨率后重试。`
  );
};

export const generateWanImage = async (
  options: GenerateWanImageOptions,
  configOverride?: Partial<WanImageConfig>
): Promise<WanImageResult> => {
  const config = await resolveWanImageConfig(configOverride);
  const refs = sanitizeRefImages(options.referenceImages);
  // 有参考图时 thinking_mode 官方无效，强制关闭以免异常
  const thinkingMode = refs.length > 0 ? false : options.thinkingMode !== false;
  const timeoutMs = options.timeoutMs ?? 180_000;

  const content: Array<Record<string, string>> = [];
  for (const img of refs) content.push({ image: img });
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
      thinking_mode: thinkingMode,
    },
  };

  const taskId = await submitAsyncTask(config, body);
  if (taskId.startsWith('__sync__:')) {
    const images = taskId.slice('__sync__:'.length).split('\n').filter(Boolean);
    return { images, raw: { sync: true } };
  }

  const polled = await pollTask(config, taskId, timeoutMs);
  return { images: polled.images, raw: polled.raw, taskId };
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
          timeoutMs: 90_000,
        },
        config
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('万相连接测试超时（90 秒）')), 90_000)
      ),
    ]);
    return { success: true, message: `万相连接成功 ✅ 已生成 ${result.images.length} 张图` };
  } catch (e: any) {
    return { success: false, message: `万相测试失败: ${String(e?.message || e).slice(0, 280)}` };
  }
};
