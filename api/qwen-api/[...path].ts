/**
 * Vercel Serverless：同域转发阿里云 Token Plan / DashScope
 * 浏览器 → /api/qwen-api/... → 阿里云（无 CORS，可长超时）
 */
export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '8mb',
    },
  },
};

const FALLBACK = 'https://token-plan.cn-beijing.maas.aliyuncs.com';

const cors = (res: any) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-qwen-origin, x-upstream-authorization, apikey'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

export default async function handler(req: any, res: any) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    let origin = FALLBACK;
    const hdr = req.headers['x-qwen-origin'];
    if (typeof hdr === 'string' && /^https:\/\//i.test(hdr)) {
      try {
        origin = new URL(hdr).origin;
      } catch {
        /* keep */
      }
    }

    const parts = req.query.path;
    const suffix = Array.isArray(parts) ? parts.join('/') : parts ? String(parts) : '';
    const target = new URL(suffix ? `/${suffix}` : '/', origin + '/');
    // 保留 query（除 path）
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query || {})) {
      if (k === 'path') continue;
      if (Array.isArray(v)) v.forEach((x) => q.append(k, String(x)));
      else if (v != null) q.set(k, String(v));
    }
    const qs = q.toString();
    if (qs) {
      target.search = qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': (req.headers['content-type'] as string) || 'application/json',
    };
    const auth = req.headers.authorization || req.headers['x-upstream-authorization'];
    if (auth) headers.Authorization = String(auth);

    const upstream = await fetch(target.toString(), {
      method: req.method || 'POST',
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body ?? {}),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('X-Proxied-To', target.origin);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    cors(res);
    res.send(text);
  } catch (e: any) {
    cors(res);
    res.status(502).json({ error: e?.message || String(e) });
  }
}
