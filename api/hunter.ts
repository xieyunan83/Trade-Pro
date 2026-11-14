/**
 * Vercel Serverless：同域转发 Hunter.io
 * 【硬约束】禁止任何相对/绝对 import（Vercel 打包易漏文件 → FUNCTION_INVOCATION_FAILED）。
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

const ORIGIN = 'https://api.hunter.io';
const UPSTREAM_TIMEOUT_MS = 25_000;

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

const resolveUpstreamPath = (req: any): string => {
  const raw = req.query?.__upstream;
  const fromQuery = Array.isArray(raw) ? raw[0] : raw ? String(raw) : '';
  if (fromQuery) {
    try {
      const decoded = decodeURIComponent(fromQuery);
      return decoded.startsWith('/') ? decoded : `/${decoded}`;
    } catch {
      return fromQuery.startsWith('/') ? fromQuery : `/${fromQuery}`;
    }
  }
  return '/v2/account';
};

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const checkLocalRate = (key: string, max = 90): { ok: boolean; retryAfterSec: number } => {
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
  const apiKey = String(req.query?.api_key || '').trim();
  if (!apiKey) return `hunter:ip:${ip}`;
  let h = 2166136261;
  for (let i = 0; i < apiKey.length; i++) {
    h ^= apiKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `hunter:k:${(h >>> 0).toString(16)}`;
};

export default async function handler(req: any, res: any) {
  try {
    if (handleCorsPreflight(req, res)) return;
    applyCors(req, res);

    const rl = checkLocalRate(clientKey(req), 90);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      res.setHeader('Cache-Control', 'no-store');
      res.status(429).json({
        error: `请求过于频繁，请 ${rl.retryAfterSec} 秒后再试`,
        retryAfterSec: rl.retryAfterSec,
        route: 'hunter',
      });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const path = resolveUpstreamPath(req);
      const target = new URL(path, ORIGIN + '/');

      const q = req.query || {};
      for (const [k, v] of Object.entries(q)) {
        if (k === '__upstream') continue;
        if (v == null) continue;
        target.searchParams.set(k, Array.isArray(v) ? String(v[0]) : String(v));
      }

      const upstream = await fetch(target.toString(), {
        method: 'GET',
        signal: controller.signal,
      });

      const text = await upstream.text();
      applyCors(req, res);
      res.status(upstream.status);
      res.setHeader('Cache-Control', 'no-store');
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      res.send(text);
    } catch (e: any) {
      applyCors(req, res);
      const aborted = e?.name === 'AbortError';
      res.status(aborted ? 504 : 502).json({
        errors: [
          {
            id: aborted ? 'timeout' : 'proxy_error',
            details: aborted
              ? `Hunter 上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）`
              : e?.message || 'proxy failed',
          },
        ],
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    try {
      applyCors(req, res);
      if (!res.headersSent) res.status(500).json({ error: e?.message || 'hunter proxy crashed' });
    } catch {
      /* ignore */
    }
  }
}
