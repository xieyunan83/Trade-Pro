/**
 * Vercel Serverless：同域转发 Anymail Finder（单文件）
 * 用法：/api/anymail?__upstream=/v0.2/search/person.json
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

const ORIGIN = 'https://api.anymailfinder.com';

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

  const legacy = req.query?.path;
  if (legacy) {
    const s = Array.isArray(legacy) ? legacy.join('/') : String(legacy);
    return s.startsWith('/') ? s : `/${s}`;
  }

  return '/';
};

export default async function handler(req: any, res: any) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const path = resolveUpstreamPath(req);
    const target = new URL(path, ORIGIN + '/');

    const headers: Record<string, string> = {};
    const ct = req.headers['content-type'];
    if (ct) headers['Content-Type'] = String(ct);
    else if (req.method !== 'GET' && req.method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }
    const auth = req.headers.authorization || req.headers['x-upstream-authorization'];
    if (auth) headers.Authorization = String(auth).replace(/^Bearer\s+/i, '').trim();

    const upstream = await fetch(target.toString(), {
      method: req.method || 'POST',
      headers,
      body: readBody(req),
    });

    const text = await upstream.text();
    applyCors(res);
    res.status(upstream.status);
    res.setHeader('X-Proxied-To', ORIGIN);
    res.setHeader('Cache-Control', 'no-store');
    const uct = upstream.headers.get('content-type');
    if (uct) res.setHeader('Content-Type', uct);
    res.send(text);
  } catch (e: any) {
    applyCors(res);
    res.status(502).json({ error: e?.message || String(e) });
  }
}
