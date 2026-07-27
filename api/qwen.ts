/**
 * Vercel Serverless：同域转发阿里云（单文件，避免 [...path] 多段 404）
 * 用法：/api/qwen?__upstream=/compatible-mode/v1/chat/completions
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
    'authorization, content-type, x-qwen-origin, x-upstream-authorization, x-upstream-path, apikey'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

const readBody = (req: { method?: string; body?: unknown }): string | undefined => {
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

const resolveUpstreamPath = (req: any): string => {
  const hdr = req.headers?.['x-upstream-path'];
  if (typeof hdr === 'string' && hdr.startsWith('/')) return hdr;

  const raw = req.query?.__upstream;
  const fromQuery = Array.isArray(raw) ? raw.join('/') : raw ? String(raw) : '';
  if (fromQuery) {
    try {
      const decoded = decodeURIComponent(fromQuery);
      return decoded.startsWith('/') ? decoded : `/${decoded}`;
    } catch {
      return fromQuery.startsWith('/') ? fromQuery : `/${fromQuery}`;
    }
  }

  // 兼容旧式 /api/qwen-api/... 被 rewrite 到 ?path=
  const legacy = req.query?.path;
  if (legacy) {
    const s = Array.isArray(legacy) ? legacy.join('/') : String(legacy);
    return s.startsWith('/') ? s : `/${s}`;
  }

  return '/compatible-mode/v1/chat/completions';
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

    let path = resolveUpstreamPath(req);
    // 若 OpenAI 客户端把 /chat/completions 拼进了 query 值，已包含在 path 中
    if (!path.includes('/chat/completions') && !path.includes('/services/') && req.method === 'POST') {
      // keep as-is for models list etc.
    }

    const target = new URL(path, origin + '/');

    const headers: Record<string, string> = {};
    const ct = req.headers['content-type'];
    if (ct) headers['Content-Type'] = String(ct);
    else if (req.method !== 'GET' && req.method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }
    const auth = req.headers.authorization || req.headers['x-upstream-authorization'];
    if (auth) headers.Authorization = String(auth);

    const upstream = await fetch(target.toString(), {
      method: req.method || 'POST',
      headers,
      body: readBody(req),
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
