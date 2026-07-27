/**
 * Vercel Serverless（Node）：同域转发阿里云
 * 浏览器 → /api/qwen-api/... → Token Plan / DashScope
 * Hobby + Fluid 最长约 300s，足以跑联网搜索
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '8mb',
    },
  },
};

const FALLBACK = 'https://token-plan.cn-beijing.maas.aliyuncs.com';

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-qwen-origin, x-upstream-authorization, apikey'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

const readBody = (req: {
  method?: string;
  body?: unknown;
}): string | undefined => {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const b = req.body;
  if (b == null || b === '') return undefined;
  if (typeof b === 'string') return b;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(b)) return b.toString('utf8');
  try {
    return JSON.stringify(b);
  } catch {
    return String(b);
  }
};

export default async function handler(req: any, res: any) {
  applyCors(res);
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

    const parts = req.query?.path;
    const suffix = Array.isArray(parts) ? parts.join('/') : parts ? String(parts) : '';
    const target = new URL(suffix ? `/${suffix}` : '/compatible-mode/v1/chat/completions', origin + '/');

    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query || {})) {
      if (k === 'path') continue;
      if (Array.isArray(v)) v.forEach((x) => q.append(k, String(x)));
      else if (v != null) q.set(k, String(v));
    }
    const qs = q.toString();
    if (qs) target.search = qs;

    const headers: Record<string, string> = {};
    const ct = req.headers['content-type'];
    if (ct) headers['Content-Type'] = String(ct);
    else if (req.method !== 'GET' && req.method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }
    const auth = req.headers.authorization || req.headers['x-upstream-authorization'];
    if (auth) headers.Authorization = String(auth);

    const body = readBody(req);
    const upstream = await fetch(target.toString(), {
      method: req.method || 'POST',
      headers,
      body,
    });

    const text = await upstream.text();
    applyCors(res);
    res.status(upstream.status);
    res.setHeader('X-Proxied-To', target.origin);
    res.setHeader('Cache-Control', 'no-store');
    const uct = upstream.headers.get('content-type');
    if (uct) res.setHeader('Content-Type', uct);
    res.send(text);
  } catch (e: any) {
    applyCors(res);
    res.status(502).json({ error: e?.message || String(e) });
  }
}
