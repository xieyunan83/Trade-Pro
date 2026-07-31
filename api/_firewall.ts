/**
 * Serverless API 轻量防火墙：限流、安全头、基础攻击特征拦截。
 * 各 api/*.ts 在业务逻辑前调用 guardApiRequest。
 */

type GuardResult =
  | { ok: true }
  | { ok: false; status: number; body: { error: string; retryAfterSec?: number } };

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;

const clientIp = (req: any): string => {
  const xf = req?.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0].trim();
  return req?.socket?.remoteAddress || req?.headers?.['x-real-ip'] || 'unknown';
};

export const applySecurityHeaders = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
};

const rateLimit = (ip: string, route: string): GuardResult => {
  const key = `${route}|${ip}`;
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }
  if (cur.count >= MAX_PER_WINDOW) {
    return {
      ok: false,
      status: 429,
      body: {
        error: 'Too many requests. Please retry later.',
        retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)),
      },
    };
  }
  cur.count += 1;
  buckets.set(key, cur);
  return { ok: true };
};

const bodyLooksHostile = (req: any): boolean => {
  try {
    const raw =
      typeof req.body === 'string'
        ? req.body
        : req.body != null
          ? JSON.stringify(req.body)
          : '';
    if (raw.length > 8_000_000) return true;
    const sample = raw.slice(0, 4000).toLowerCase();
    return /(<script|union\s+select|drop\s+table|\.\.\/\.\.\/|%00)/i.test(sample);
  } catch {
    return false;
  }
};

/**
 * 在 CORS / OPTIONS 处理之后、业务逻辑之前调用。
 * 返回 false 时调用方应直接结束响应。
 */
export const guardApiRequest = (
  req: any,
  res: any,
  routeName: string
): boolean => {
  applySecurityHeaders(res);

  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'OPTIONS', 'HEAD'].includes(method)) {
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }

  if (method === 'OPTIONS') return true;

  const ip = clientIp(req);
  const limited = rateLimit(ip, routeName);
  if (!limited.ok) {
    if (limited.body.retryAfterSec) {
      res.setHeader('Retry-After', String(limited.body.retryAfterSec));
    }
    res.status(limited.status).json(limited.body);
    return false;
  }

  if (bodyLooksHostile(req)) {
    res.status(400).json({ error: 'Request rejected by firewall' });
    return false;
  }

  return true;
};
