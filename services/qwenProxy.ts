/**
 * 阿里云千问 / 万相请求路由：
 * - 本地开发：Vite /qwen-api 代理（无 CORS）
 * - 线上（babyworld.ltd 等）：Supabase Edge Function qwen-proxy（无 CORS）
 * 浏览器绝不能直连 aliyuncs.com，否则会 Failed to fetch。
 */
import { getSupabaseConfig, isSupabaseConfigured } from './env';

export const isLocalDevHost = (): boolean =>
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]');

export const isDomesticAliyunUrl = (url: string): boolean =>
  url.startsWith('/qwen-api') ||
  url.includes('/functions/v1/qwen-proxy') ||
  /aliyuncs\.com|dashscope\.aliyun/i.test(url);

export type QwenProxyVia = 'direct' | 'vite' | 'supabase';

export function resolveQwenRequestTarget(absoluteOrRelative: string): {
  url: string;
  proxyOrigin?: string;
  via: QwenProxyVia;
} {
  if (!absoluteOrRelative) return { url: absoluteOrRelative, via: 'direct' };
  if (absoluteOrRelative.startsWith('/')) {
    return {
      url: absoluteOrRelative,
      via: absoluteOrRelative.startsWith('/qwen-api') ? 'vite' : 'direct',
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

  if (isSupabaseConfigured()) {
    const { url: sb } = getSupabaseConfig();
    return {
      url: `${sb.replace(/\/$/, '')}/functions/v1/qwen-proxy${pathWithQuery}`,
      proxyOrigin: origin,
      via: 'supabase',
    };
  }

  return { url: absoluteOrRelative, via: 'direct' };
}

/** 按代理类型组装 Authorization（线上必须把 Key 放进 X-Upstream-Authorization） */
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

  if (opts.targetUrl.includes('/functions/v1/qwen-proxy')) {
    const { key } = getSupabaseConfig();
    headers.Authorization = `Bearer ${key}`;
    headers.apikey = key;
    headers['X-Upstream-Authorization'] = `Bearer ${opts.apiKey}`;
    if (opts.proxyOrigin) headers['X-Qwen-Origin'] = opts.proxyOrigin;
  } else {
    headers.Authorization = `Bearer ${opts.apiKey}`;
    if (opts.targetUrl.startsWith('/qwen-api') && opts.proxyOrigin) {
      headers['X-Qwen-Origin'] = opts.proxyOrigin;
    }
  }
  return headers;
}

export function qwenCorsHint(errorMessage?: string): string {
  if (!errorMessage || !/Failed to fetch|NetworkError|Load failed/i.test(errorMessage)) return '';
  if (isLocalDevHost()) {
    return ' 本地请确认已 npm run dev（需要 /qwen-api 代理）。';
  }
  return (
    ' 线上站点无法浏览器直连阿里云（CORS）。请部署 Supabase Edge Function「qwen-proxy」后重试' +
    '（见仓库 supabase/functions/qwen-proxy）。'
  );
}
