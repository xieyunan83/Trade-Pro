/**
 * Vercel Serverless：同域转发阿里云（单文件，避免 [...path] 多段 404）
 * 用法：/api/qwen?__upstream=/compatible-mode/v1/chat/completions
 * 部署在香港/新加坡，缩短到阿里云北京的链路。
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
/**
 * 联网搜索（客户搜索/背调）常需 2–4 分钟。
 * 须与前端 TASK_TIMEOUT / viaAppProxy 上限对齐，且低于 functions.maxDuration(300)。
 */
const UPSTREAM_TIMEOUT_MS = 280_000;

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

  const { guardApiRequest } = await import('./_firewall');
  if (!guardApiRequest(req, res, 'qwen')) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

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

    const path = resolveUpstreamPath(req);
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
      signal: controller.signal,
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
    const aborted = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message || e));
    res.status(aborted ? 504 : 502).json({
      error: aborted
        ? `阿里云上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）。请确认 Key/域名，或配置国内中转。`
        : e?.message || String(e),
    });
  } finally {
    clearTimeout(timer);
  }
}
