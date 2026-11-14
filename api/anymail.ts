/**
 * Vercel Serverless：同域转发 Anymail Finder
 * 【硬约束】禁止任何相对/绝对 import（Vercel 打包易漏文件 → FUNCTION_INVOCATION_FAILED）。
 * CORS / 限流内联，与 api/qwen.ts、api/_cors.ts 保持同步。
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 180,
};

const ORIGIN = 'https://api.anymailfinder.com';
const UPSTREAM_TIMEOUT_MS = 170_000;

const CORS_ALLOWED = new Set([
  'https://babyworld.ltd',
  'https://www.babyworld.ltd',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const applyCors = (req: any, res: { setHeader: (k: string, v: string) => void }): boolean => {
  const origin = String(req?.headers?.origin || '').trim().replace(/\/$/, '');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, authorization, x-goog-api-key, x-qwen-origin, x-upstream-authorization, x-upstream-path, apikey, x-industry-token'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (!origin) return true;
  const extra = String(process.env.ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (CORS_ALLOWED.has(origin) || extra.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    return true;
  }
  if (process.env.CORS_ALLOW_VERCEL_PREVIEWS === '1' && /\.vercel\.app$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    return true;
  }
  return false;
};

const handleCorsPreflight = (req: any, res: any): boolean => {
  if (String(req.method || '').toUpperCase() !== 'OPTIONS') return false;
  const ok = applyCors(req, res);
  if (!ok) {
    res.status(403).json({ ok: false, error: 'Origin not allowed' });
    return true;
  }
  res.status(204).end();
  return true;
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

const normalizeAnymailAuth = (auth: string): string =>
  String(auth).replace(/^Bearer\s+/i, '').trim();

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const checkLocalRate = (key: string, max = 120): { ok: boolean; retryAfterSec: number } => {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return { ok: true, retryAfterSec: 0 };
  }
  if (cur.count >= max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  cur.count += 1;
  return { ok: true, retryAfterSec: 0 };
};

const clientKey = (req: any): string => {
  const xf = req.headers?.['x-forwarded-for'];
  const ip =
    typeof xf === 'string' && xf.trim()
      ? xf.split(',')[0].trim()
      : Array.isArray(xf) && xf[0]
        ? String(xf[0])
        : 'unknown';
  const auth = String(req.headers?.authorization || req.headers?.['x-upstream-authorization'] || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!auth) return `anymail:ip:${ip}`;
  let h = 2166136261;
  for (let i = 0; i < auth.length; i++) {
    h ^= auth.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `anymail:k:${(h >>> 0).toString(16)}`;
};

export default async function handler(req: any, res: any) {
  try {
    if (handleCorsPreflight(req, res)) return;
    applyCors(req, res);

    const rl = checkLocalRate(clientKey(req), 120);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      res.setHeader('Cache-Control', 'no-store');
      res.status(429).json({
        error: `请求过于频繁，请 ${rl.retryAfterSec} 秒后再试`,
        retryAfterSec: rl.retryAfterSec,
        route: 'anymail',
      });
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
      applyCors(req, res);
      res.status(upstream.status);
      res.setHeader('X-Proxied-To', ORIGIN);
      res.setHeader('Cache-Control', 'no-store');
      const uct = upstream.headers.get('content-type');
      if (uct) res.setHeader('Content-Type', uct);
      res.send(text);
    } catch (e: any) {
      applyCors(req, res);
      const aborted = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message || e));
      res.status(aborted ? 504 : 502).json({
        error: aborted
          ? `Anymail 上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）`
          : e?.message || String(e),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    try {
      applyCors(req, res);
      if (!res.headersSent) res.status(500).json({ error: e?.message || 'anymail proxy crashed' });
    } catch {
      /* ignore */
    }
  }
}
