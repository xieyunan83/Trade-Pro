// Supabase Edge Function：流式代理阿里云（勿整包缓冲，否则长请求会 HTTP 546 WORKER_RESOURCE_LIMIT）
// 部署：npx supabase functions deploy qwen-proxy --project-ref pdsjvcgkuolgckrxhcgj
// Dashboard → qwen-proxy → Verify JWT = Off；Maximum duration 尽量调到 150s+

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

Deno.serve(async (req) => {
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
    const ct = req.headers.get('content-type');
    if (ct) headers.set('Content-Type', ct);
    headers.set('Authorization', upstreamAuth);

    // 关键式转发：不要 arrayBuffer() 整包读入，否则联网搜索大响应会触发 WORKER_RESOURCE_LIMIT
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    });

    const outHeaders = new Headers(CORS);
    const upstreamCt = upstream.headers.get('Content-Type');
    if (upstreamCt) outHeaders.set('Content-Type', upstreamCt);
    outHeaders.set('X-Proxied-To', target.origin);
    // 避免中间层再缓冲
    outHeaders.set('Cache-Control', 'no-store');

    return new Response(upstream.body, {
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
