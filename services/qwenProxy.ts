/**
 * 阿里云千问 / 万相 / Anymail 请求路由：
 * - 本地：Vite /qwen-api、/anymail-api
 * - 线上（Vercel）：同域 /api/qwen-api、/api/anymail-api（或 rewrite 后的 /qwen-api）
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
  url.startsWith('/api/qwen-api') ||
  url.includes('/functions/v1/qwen-proxy') ||
  /aliyuncs\.com|dashscope\.aliyun/i.test(url);

export const isSupabaseQwenProxyUrl = (url: string): boolean =>
  url.includes('/functions/v1/qwen-proxy');

export const isSameOriginQwenProxyUrl = (url: string): boolean =>
  url.startsWith('/qwen-api') ||
  url.startsWith('/api/qwen-api') ||
  (url.includes('/qwen-api/') && !isSupabaseQwenProxyUrl(url));

/** 本地 Vite 或线上 Vercel 同域代理（非 Supabase） */
export const isAppHostedQwenProxy = (url: string): boolean =>
  isSameOriginQwenProxyUrl(url) && !isSupabaseQwenProxyUrl(url);

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

/** 线上默认挂载点（Vercel） */
const prodQwenMount = () => '/api/qwen-api';
const prodAnymailMount = () => '/api/anymail-api';

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
      via: absoluteOrRelative.includes('qwen-api') ? 'vite' : 'direct',
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

  // 显式自定义 Node 中转
  if (mode === 'custom' && customBase) {
    return {
      url: `${customBase}/qwen-api${pathWithQuery}`,
      proxyOrigin: origin,
      via: 'custom',
    };
  }

  // 强制 Supabase（不推荐长任务）
  if (mode === 'supabase' && isSupabaseConfigured()) {
    const { url: sb } = getSupabaseConfig();
    return {
      url: `${sb.replace(/\/$/, '')}/functions/v1/qwen-proxy${pathWithQuery}`,
      proxyOrigin: origin,
      via: 'supabase',
    };
  }

  // auto / same-origin：线上走 Vercel 同域 API（推荐，推送 GitHub 后自动可用）
  if (mode === 'same-origin' || mode === 'auto' || !customBase) {
    return {
      url: `${prodQwenMount()}${pathWithQuery}`,
      proxyOrigin: origin,
      via: 'vercel',
    };
  }

  if (customBase) {
    return {
      url: `${customBase}/qwen-api${pathWithQuery}`,
      proxyOrigin: origin,
      via: 'custom',
    };
  }

  return {
    url: `${prodQwenMount()}${pathWithQuery}`,
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
  return ' 线上已走同域代理；若仍失败请稍后重试，或联系管理员检查 Vercel 部署是否成功。';
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
  return { url: `${prodAnymailMount()}${cleanPath}`, via: 'vercel' };
}

export function buildAnymailFetchHeaders(apiKey: string, targetUrl: string): Record<string, string> {
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
