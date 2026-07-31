/**
 * Vercel Serverless：同域转发 AnySearch MCP（规避浏览器 CORS）
 * Auth：优先使用客户端 Authorization（云端同步的 Key）；否则回退 process.env.ANYSEARCH_API_KEY
 * 用法：POST /api/anysearch  →  https://api.anysearch.com/mcp
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

const ORIGIN = 'https://api.anysearch.com';
const MCP_PATH = '/mcp';
const UPSTREAM_TIMEOUT_MS = 45_000;
const CLIENT_HEADER = 'trade-pro/1.0';

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-anysearch-client'
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

export default async function handler(req: any, res: any) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { guardApiRequest } = await import('./_firewall');
  if (!guardApiRequest(req, res, 'anysearch')) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'AnySearch proxy only accepts POST' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    // Prefer client Authorization (cloud-synced key); fall back to server env
    const clientAuth = req.headers.authorization || req.headers['x-upstream-authorization'];
    const serverKey = String(process.env.ANYSEARCH_API_KEY || '').trim();
    let auth = '';
    if (clientAuth) {
      const raw = String(clientAuth).replace(/^Bearer\s+/i, '').trim();
      auth = raw ? `Bearer ${raw}` : '';
    } else if (serverKey) {
      auth = `Bearer ${serverKey.replace(/^Bearer\s+/i, '')}`;
    }

    if (!auth) {
      res.status(401).json({
        error: '未配置 AnySearch API Key。请在管理后台保存到云端，或设置服务端 ANYSEARCH_API_KEY。',
      });
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Anysearch-Client':
        (typeof req.headers['x-anysearch-client'] === 'string' &&
          req.headers['x-anysearch-client']) ||
        CLIENT_HEADER,
      Authorization: auth,
    };

    const upstream = await fetch(`${ORIGIN}${MCP_PATH}`, {
      method: 'POST',
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
        ? `AnySearch 上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）`
        : e?.message || String(e),
    });
  } finally {
    clearTimeout(timer);
  }
}
