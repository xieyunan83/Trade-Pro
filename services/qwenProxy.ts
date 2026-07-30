/**
 * 阿里云千问 / 万相 / Anymail 请求路由：
 * - 本地：Vite /qwen-api、/anymail-api
 * - 线上（Vercel）：同域 /api/qwen、/api/anymail（query 传上游路径，避免多段动态路由 404）
 * - 可选：自定义 Node 中转 / Supabase（短测）
 */
import { getSupabaseConfig, isSupabaseConfigured } from './env';

export const isLocalDevHost = (): boolean =>
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]');

export const isDomesticAliyunUrl = (url: string): boolean =>
  url.startsWith('/qwen-api') ||
  url.startsWith('/api/qwen') ||
  url.includes('/functions/v1/qwen-proxy') ||
  /aliyuncs\.com|dashscope\.aliyun/i.test(url);

export const isSupabaseQwenProxyUrl = (url: string): boolean =>
  url.includes('/functions/v1/qwen-proxy');

export const isSameOriginQwenProxyUrl = (url: string): boolean =>
  url.startsWith('/qwen-api') ||
  url.startsWith('/api/qwen') ||
  url.startsWith('/api/anymail') ||
  (url.includes('/qwen-api/') && !isSupabaseQwenProxyUrl(url));

/** 本地 Vite 或线上 Vercel 同域代理（非 Supabase） */
export const isAppHostedQwenProxy = (url: string): boolean =>
  (url.startsWith('/qwen-api') ||
    url.startsWith('/api/qwen') ||
    url.includes('/qwen-api/')) &&
  !isSupabaseQwenProxyUrl(url);

export type QwenProxyVia = 'direct' | 'vite' | 'supabase' | 'custom' | 'vercel';
export type AliyunProxyMode = 'auto' | 'same-origin' | 'custom' | 'supabase';

const LS_MODE = 'trade_scout_aliyun_proxy_mode';
const LS_BASE = 'trade_scout_aliyun_proxy_base';

export const getAliyunProxyMode = (): AliyunProxyMode => {
  const m = (typeof localStorage !== 'undefined' ? localStorage.getItem(LS_MODE) : '') || 'auto';
  if (m === 'same-origin' || m === 'custom' || m === 'supabase' || m === 'auto') return m;
  return 'auto';
};

export const setAliyunProxyMode = (mode: AliyunProxyMode) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_MODE, mode);
};

export const getAliyunProxyBase = (): string => {
  if (typeof localStorage === 'undefined') return '';
  return (localStorage.getItem(LS_BASE) || '').trim().replace(/\/$/, '');
};

export const setAliyunProxyBase = (base: string) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_BASE, base.trim().replace(/\/$/, ''));
};

/** 线上：把上游 path 放进 query，单文件函数可转发任意深度路径 */
const toVercelQwenUrl = (pathWithQuery: string): string => {
  const [pathname, search = ''] = pathWithQuery.split('?');
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const qs = search ? `?${search}` : '';
  // 注意：后续可能再拼接 /chat/completions，会并入 __upstream 查询值
  return `/api/qwen?__upstream=${encodeURIComponent(path)}${qs ? `&__qs=${encodeURIComponent(qs)}` : ''}`;
};

const toVercelAnymailUrl = (cleanPath: string): string => {
  const path = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
  return `/api/anymail?__upstream=${encodeURIComponent(path)}`;
};

export const DEFAULT_TOKEN_PLAN_ORIGIN = 'https://token-plan.cn-beijing.maas.aliyuncs.com';

export function resolveQwenRequestTarget(absoluteOrRelative: string): {
  url: string;
  proxyOrigin?: string;
  via: QwenProxyVia;
} {
  if (!absoluteOrRelative) return { url: absoluteOrRelative, via: 'direct' };
  if (absoluteOrRelative.startsWith('/')) {
    return {
      url: absoluteOrRelative,
      via:
        absoluteOrRelative.includes('qwen-api') || absoluteOrRelative.startsWith('/api/qwen')
          ? 'vite'
          : 'direct',
    };
  }

  let origin = '';
  let pathWithQuery = '/compatible-mode/v1';
  try {
    const u = new URL(absoluteOrRelative);
    origin = u.origin;
    pathWithQuery = `${u.pathname.replace(/\/$/, '') || '/compatible-mode/v1'}${u.search}`;
  } catch {
    return { url: absoluteOrRelative, via: 'direct' };
  }

  if (!isDomesticAliyunUrl(absoluteOrRelative)) {
    return { url: absoluteOrRelative, via: 'direct' };
  }

  if (isLocalDevHost()) {
    return { url: `/qwen-api${pathWithQuery}`, proxyOrigin: origin, via: 'vite' };
  }

  const mode = getAliyunProxyMode();
  const customBase = getAliyunProxyBase();

  if (mode === 'custom' && customBase) {
    return {
      url: `${customBase}/qwen-api${pathWithQuery}`,
      proxyOrigin: origin,
      via: 'custom',
    };
  }

  if (mode === 'supabase' && isSupabaseConfigured()) {
    const { url: sb } = getSupabaseConfig();
    return {
      url: `${sb.replace(/\/$/, '')}/functions/v1/qwen-proxy${pathWithQuery}`,
      proxyOrigin: origin,
      via: 'supabase',
    };
  }

  // auto / same-origin：线上走 Vercel 单文件代理
  return {
    url: toVercelQwenUrl(pathWithQuery),
    proxyOrigin: origin,
    via: 'vercel',
  };
}

export function buildAliyunFetchHeaders(opts: {
  targetUrl: string;
  apiKey: string;
  proxyOrigin?: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.extra || {}),
  };

  if (isSupabaseQwenProxyUrl(opts.targetUrl)) {
    const { key } = getSupabaseConfig();
    headers.Authorization = `Bearer ${key}`;
    headers.apikey = key;
    headers['X-Upstream-Authorization'] = `Bearer ${opts.apiKey}`;
    if (opts.proxyOrigin) headers['X-Qwen-Origin'] = opts.proxyOrigin;
  } else {
    headers.Authorization = `Bearer ${opts.apiKey}`;
    if (isAppHostedQwenProxy(opts.targetUrl)) {
      headers['X-Qwen-Origin'] = opts.proxyOrigin || DEFAULT_TOKEN_PLAN_ORIGIN;
    }
  }
  return headers;
}

export function qwenCorsHint(errorMessage?: string): string {
  if (!errorMessage || !/Failed to fetch|NetworkError|Load failed|546|WORKER_RESOURCE|504|timeout/i.test(errorMessage)) {
    return '';
  }
  if (isLocalDevHost()) {
    return ' 本地请确认已 npm run dev（需要 /qwen-api 代理）。';
  }
  return ' 线上已走同域代理；若仍失败请稍后重试。';
}

const ANYMAIL_ORIGIN = 'https://api.anymailfinder.com';

export function resolveAnymailUrl(path: string): { url: string; via: QwenProxyVia } {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (isLocalDevHost()) {
    return { url: `/anymail-api${cleanPath}`, via: 'vite' };
  }

  const mode = getAliyunProxyMode();
  const customBase = getAliyunProxyBase();

  if (mode === 'custom' && customBase) {
    return { url: `${customBase}/anymail-api${cleanPath}`, via: 'custom' };
  }
  if (mode === 'supabase' && isSupabaseConfigured()) {
    const { url: sb } = getSupabaseConfig();
    return {
      url: `${sb.replace(/\/$/, '')}/functions/v1/qwen-proxy${cleanPath}`,
      via: 'supabase',
    };
  }
  return { url: toVercelAnymailUrl(cleanPath), via: 'vercel' };
}

export function buildAnymailFetchHeaders(apiKey: string, targetUrl: string): Record<string, string> {
  // 官方文档：Authorization 值为 API Key 本身（也可兼容 Bearer）
  const rawKey = apiKey.replace(/^Bearer\s+/i, '').trim();
  if (isSupabaseQwenProxyUrl(targetUrl)) {
    const { key } = getSupabaseConfig();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      apikey: key,
      'X-Upstream-Authorization': rawKey,
      'X-Qwen-Origin': ANYMAIL_ORIGIN,
    };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: rawKey,
  };
}
