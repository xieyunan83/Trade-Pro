import { applyStrictCors, handleCorsPreflight } from './_cors';
/**
 * Vercel Serverless：同域转发 Anymail Finder
 * 【硬约束】禁止外部 import，避免 FUNCTION_INVOCATION_FAILED（与 tavily/landing 一致）。
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 180,
};

const ORIGIN = 'https://api.anymailfinder.com';
const UPSTREAM_TIMEOUT_MS = 170_000;

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

/** 本函数内轻量限流（禁止 import _firewall） */
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
    applyStrictCors(req, res);

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
      applyStrictCors(req, res);
      res.status(upstream.status);
      res.setHeader('X-Proxied-To', ORIGIN);
      res.setHeader('Cache-Control', 'no-store');
      const uct = upstream.headers.get('content-type');
      if (uct) res.setHeader('Content-Type', uct);
      res.send(text);
    } catch (e: any) {
      applyStrictCors(req, res);
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
      applyStrictCors(req, res);
      if (!res.headersSent) res.status(500).json({ error: e?.message || 'anymail proxy crashed' });
    } catch {
      /* ignore */
    }
  }
};
