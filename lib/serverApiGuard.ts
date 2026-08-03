/**
 * Serverless API 轻量防护（供 api/*.ts 静态引用）。
 * 放在 lib/ 下，避免 api/_*.ts 动态 import 在 Vercel 上 MODULE_NOT_FOUND 导致整函数崩溃。
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 180;

const clientIp = (req: any): string => {
  const xf = req?.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0].trim();
  return String(req?.socket?.remoteAddress || req?.headers?.['x-real-ip'] || 'unknown');
};

export const applySecurityHeaders = (res: { setHeader: (k: string, v: string) => void }) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  } catch {
    /* ignore */
  }
};

const rateLimitOk = (ip: string, route: string): { ok: true } | { ok: false; retryAfterSec: number } => {
  const key = `${route}|${ip}`;
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }
  if (cur.count >= MAX_PER_WINDOW) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  cur.count += 1;
  buckets.set(key, cur);
  return { ok: true };
};

/**
 * 返回 false 时调用方应结束响应。
 * 任意异常一律放行（避免防火墙把代理打挂）。
 */
export const guardApiRequest = (
  req: any,
  res: any,
  routeName: string,
  opts?: { skipBodyCheck?: boolean }
): boolean => {
  try {
    applySecurityHeaders(res);

    const method = String(req?.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'OPTIONS', 'HEAD'].includes(method)) {
      res.status(405).json({ error: 'Method not allowed' });
      return false;
    }
    if (method === 'OPTIONS') return true;

    const limited = rateLimitOk(clientIp(req), routeName);
    if (limited.ok === false) {
      const retryAfterSec = limited.retryAfterSec;
      try {
        res.setHeader('Retry-After', String(retryAfterSec));
      } catch {
        /* ignore */
      }
      res.status(429).json({
        error: 'Too many requests. Please retry later.',
        retryAfterSec,
      });
      return false;
    }

    // 上游转发代理不要扫 body：LLM 提示词常含代码片段，易误杀；且大 body stringify 有风险
    if (!opts?.skipBodyCheck) {
      const raw =
        typeof req?.body === 'string'
          ? req.body
          : req?.body != null
            ? JSON.stringify(req.body).slice(0, 4000)
            : '';
      if (raw.length > 0 && /(<script[\s>]|union\s+select|drop\s+table|%00)/i.test(raw)) {
        res.status(400).json({ error: 'Request rejected by firewall' });
        return false;
      }
    }

    return true;
  } catch (e) {
    console.warn('[apiGuard] soft-fail, allowing request', e);
    return true;
  }
};
