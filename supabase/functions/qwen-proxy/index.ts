// Supabase Edge Function：代理阿里云 Token Plan / DashScope，解决线上 CORS（Failed to fetch）
// 部署：npx supabase functions deploy qwen-proxy --project-ref pdsjvcgkuolgckrxhcgj
// 并在 Dashboard → Edge Functions → qwen-proxy → 关闭 JWT 校验（或保持 anon key 可调用）

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-qwen-origin, x-upstream-authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const FALLBACK_ORIGIN = 'https://dashscope.aliyuncs.com';

const extractUpstreamPath = (pathname: string): string => {
  const marker = '/qwen-proxy';
  const idx = pathname.indexOf(marker);
  if (idx === -1) return '/compatible-mode/v1/chat/completions';
  const rest = pathname.slice(idx + marker.length);
  return rest && rest !== '/' ? rest : '/compatible-mode/v1/chat/completions';
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const originHeader = req.headers.get('x-qwen-origin') || FALLBACK_ORIGIN;
    let origin = originHeader.replace(/\/$/, '');
    try {
      origin = new URL(origin).origin;
    } catch {
      origin = FALLBACK_ORIGIN;
    }

    const upstreamAuth =
      req.headers.get('x-upstream-authorization') ||
      // 兼容误把阿里云 Key 放在 Authorization 的旧客户端
      (req.headers.get('authorization')?.includes('sk-') ? req.headers.get('authorization') : '') ||
      '';

    if (!upstreamAuth) {
      return new Response(JSON.stringify({ error: 'Missing X-Upstream-Authorization (Aliyun API Key)' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const reqUrl = new URL(req.url);
    const path = extractUpstreamPath(reqUrl.pathname) + reqUrl.search;
    const target = new URL(path, origin + '/');

    const headers = new Headers();
    headers.set('Content-Type', req.headers.get('content-type') || 'application/json');
    headers.set('Authorization', upstreamAuth);

    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();

    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body: body && body.byteLength ? body : undefined,
    });

    const outHeaders = new Headers(CORS);
    const ct = upstream.headers.get('Content-Type');
    if (ct) outHeaders.set('Content-Type', ct);
    outHeaders.set('X-Proxied-To', target.origin);

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: outHeaders,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: `qwen-proxy failed: ${message}` }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
