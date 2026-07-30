/**
 * Vercel Serverless：同域转发 Anymail Finder（单文件）
 * 用法：/api/anymail?__upstream=/v5.1/verify-email
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  regions: ['hkg1', 'sin1'],
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

const ORIGIN = 'https://api.anymailfinder.com';
/** 上游超时，避免函数挂死导致前端「没反应」 */
const UPSTREAM_TIMEOUT_MS = 25_000;

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

/** 官方要求 Authorization 值为 API Key；兼容客户端误带 Bearer */
const normalizeAnymailAuth = (auth: string): string =>
  String(auth).replace(/^Bearer\s+/i, '').trim();

export default async function handler(req: any, res: any) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

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
    if (auth) headers.Authorization = normalizeAnymailAuth(String(auth));

    const upstream = await fetch(target.toString(), {
      method: req.method || 'POST',
      headers,
      body: readBody(req),
      signal: controller.signal,
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
    const aborted = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message || e));
    res.status(aborted ? 504 : 502).json({
      error: aborted
        ? `Anymail 上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）`
        : e?.message || String(e),
    });
  } finally {
    clearTimeout(timer);
  }
}
