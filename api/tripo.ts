/**
 * Vercel Serverless：同域转发 Tripo OpenAPI（图生 3D）。
 * 用法：/api/tripo?__upstream=/v2/openapi/task
 * 开发环境走 Vite /tripo-api 代理。
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
  // 上传图生 3D 用 multipart，禁止 JSON 解析破坏 boundary
  api: { bodyParser: false },
};

const TRIPO_ORIGIN = 'https://api.tripo3d.ai';
const UPSTREAM_TIMEOUT_MS = 280_000;

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-upstream-path, x-upstream-authorization'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
  return '/v2/openapi/task';
};

const readBodyBuffer = async (req: any): Promise<Buffer | undefined> => {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const b = req.body;
  if (b != null && b !== '') {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(b)) return b;
    if (typeof b === 'string') return Buffer.from(b);
    if (b instanceof ArrayBuffer) return Buffer.from(b);
    if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    try {
      return Buffer.from(JSON.stringify(b));
    } catch {
      return Buffer.from(String(b));
    }
  }
  // bodyParser:false 时从流读取（multipart 上传）
  if (typeof req?.[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return chunks.length ? Buffer.concat(chunks) : undefined;
  }
  return undefined;
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const path = resolveUpstreamPath(req);
      const target = new URL(path, TRIPO_ORIGIN + '/');

      const headers: Record<string, string> = {};
      const ct = req.headers['content-type'];
      if (ct) headers['Content-Type'] = String(ct);
      const auth = req.headers.authorization || req.headers['x-upstream-authorization'];
      if (auth) headers.Authorization = String(auth);

      const bodyBuf = await readBodyBuffer(req);
      const upstream = await fetch(target.toString(), {
        method: method === 'HEAD' ? 'GET' : method,
        headers,
        body: bodyBuf && method !== 'GET' && method !== 'HEAD' ? bodyBuf : undefined,
        signal: controller.signal,
      });

      const ab = await upstream.arrayBuffer();
      applyCors(res);
      res.status(upstream.status);
      res.setHeader('X-Proxied-To', TRIPO_ORIGIN);
      res.setHeader('Cache-Control', 'no-store');
      const uct = upstream.headers.get('content-type');
      if (uct) res.setHeader('Content-Type', uct);
      res.send(Buffer.from(ab));
    } catch (e: any) {
      applyCors(res);
      const aborted = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message || e));
      res.status(aborted ? 504 : 502).json({
        error: aborted
          ? `图生 3D 上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）`
          : e?.message || String(e),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    try {
      applyCors(res);
      if (!res.headersSent) {
        res.status(500).json({ error: e?.message || 'tripo proxy crashed' });
      }
    } catch {
      /* ignore */
    }
  }
}
