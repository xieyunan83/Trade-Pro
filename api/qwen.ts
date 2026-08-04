/**
 * Vercel Serverless：同域转发
 * - 默认：阿里云千问（Authorization / X-Qwen-Origin）
 * - 若带 x-goog-api-key：转发 Google Gemini（禁止 Authorization，兼容 AIza / AQ.）
 * 用法：
 *   /api/qwen?__upstream=/compatible-mode/v1/chat/completions
 *   /api/gemini?__upstream=/v1beta/models/...:generateContent  （rewrite → 本函数）
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
};

const QWEN_FALLBACK = 'https://token-plan.cn-beijing.maas.aliyuncs.com';
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
const UPSTREAM_TIMEOUT_MS = 280_000;

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-qwen-origin, x-upstream-authorization, x-upstream-path, apikey, x-goog-api-key'
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

const resolveUpstreamPath = (req: any, geminiMode: boolean): string => {
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

  return geminiMode ? '/v1beta/models' : '/compatible-mode/v1/chat/completions';
};

const extractGoogKey = (req: any): string => {
  const hdr = req.headers?.['x-goog-api-key'];
  const raw = Array.isArray(hdr) ? hdr[0] : hdr;
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();
};

export default async function handler(req: any, res: any) {
  try {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const method = String(req.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'HEAD'].includes(method)) {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const googKey = extractGoogKey(req);
    const geminiMode = !!googKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      let origin = QWEN_FALLBACK;
      if (geminiMode) {
        origin = GEMINI_ORIGIN;
      } else {
        const hdr = req.headers['x-qwen-origin'];
        if (typeof hdr === 'string' && /^https:\/\//i.test(hdr)) {
          try {
            origin = new URL(hdr).origin;
          } catch {
            /* keep */
          }
        }
      }

      const path = resolveUpstreamPath(req, geminiMode);
      const target = new URL(path, origin + '/');

      const headers: Record<string, string> = {};
      const ct = req.headers['content-type'];
      if (ct) headers['Content-Type'] = String(ct);
      else if (method !== 'GET' && method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
      }

      if (geminiMode) {
        // 绝不带 Authorization（Bearer 会触发 ACCESS_TOKEN_TYPE_UNSUPPORTED）
        // AQ. Auth Key：优先 ?key=；AIza：优先 x-goog-api-key（避免双凭证冲突）
        if (googKey.startsWith('AQ.')) {
          if (!target.searchParams.has('key')) {
            target.searchParams.set('key', googKey);
          }
        } else {
          headers['x-goog-api-key'] = googKey;
        }
        const rev = req.headers['api-revision'] || req.headers['Api-Revision'];
        if (typeof rev === 'string' && rev.trim()) {
          headers['Api-Revision'] = rev.trim();
        } else if (/\/interactions/i.test(target.pathname)) {
          headers['Api-Revision'] = '2026-05-20';
        }
      } else {
        const auth = req.headers.authorization || req.headers['x-upstream-authorization'];
        if (auth) headers.Authorization = String(auth);
      }

      const upstream = await fetch(target.toString(), {
        method: method === 'HEAD' ? 'GET' : method,
        headers,
        body: readBody(req),
        signal: controller.signal,
      });

      const text = await upstream.text();
      applyCors(res);
      res.status(upstream.status);
      res.setHeader('X-Proxied-To', target.origin);
      res.setHeader('X-Proxy-Mode', geminiMode ? 'gemini' : 'qwen');
      res.setHeader('Cache-Control', 'no-store');
      const uct = upstream.headers.get('content-type');
      if (uct) res.setHeader('Content-Type', uct);
      res.send(text);
    } catch (e: any) {
      applyCors(res);
      const aborted = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message || e));
      res.status(aborted ? 504 : 502).json({
        error: aborted
          ? geminiMode
            ? `Gemini 上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）`
            : `阿里云上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）。请确认 Key/域名，或配置国内中转。`
          : e?.message || String(e),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    try {
      applyCors(res);
      if (!res.headersSent) {
        res.status(500).json({ error: e?.message || 'qwen proxy crashed' });
      }
    } catch {
      /* ignore */
    }
  }
}
