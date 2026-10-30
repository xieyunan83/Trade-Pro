/**
 * Vercel：社交平台 Graph / REST 同域代理（LinkedIn / Meta / X）
 * /api/social?__origin=https://api.linkedin.com&__upstream=/v2/ugcPosts
 */
import { enforceApiRateLimit } from './_firewall';
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

const ALLOWED_ORIGINS = new Set([
  'https://api.linkedin.com',
  'https://www.linkedin.com',
  'https://graph.facebook.com',
  'https://graph.instagram.com',
  'https://api.twitter.com',
  'https://api.x.com',
]);

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-restli-protocol-version, linkedin-version, x-social-origin'
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
  try {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (!enforceApiRateLimit(req, res, 'social')) return;

    const originRaw = String(req.query?.__origin || req.headers['x-social-origin'] || '').trim();
    let origin = originRaw.replace(/\/$/, '');
    try {
      origin = new URL(origin).origin;
    } catch {
      res.status(400).json({ error: '缺少合法 __origin' });
      return;
    }
    if (!ALLOWED_ORIGINS.has(origin)) {
      res.status(403).json({ error: `不允许代理到 ${origin}` });
      return;
    }

    const rawPath = req.query?.__upstream;
    const path = Array.isArray(rawPath)
      ? `/${rawPath.join('/')}`
      : String(rawPath || '/').startsWith('/')
        ? String(rawPath || '/')
        : `/${rawPath || ''}`;

    const target = new URL(path, origin + '/');
    const headers: Record<string, string> = {};
    const ct = req.headers['content-type'];
    if (ct) headers['Content-Type'] = String(ct);
    const auth = req.headers.authorization;
    if (auth) headers.Authorization = String(auth);
    const restli = req.headers['x-restli-protocol-version'];
    if (restli) headers['X-Restli-Protocol-Version'] = String(restli);
    const liVer = req.headers['linkedin-version'];
    if (liVer) headers['Linkedin-Version'] = String(liVer);

    const upstream = await fetch(target.toString(), {
      method: String(req.method || 'GET').toUpperCase(),
      headers,
      body: readBody(req),
    });
    const text = await upstream.text();
    applyCors(res);
    res.status(upstream.status);
    const uct = upstream.headers.get('content-type');
    if (uct) res.setHeader('Content-Type', uct);
    res.setHeader('Cache-Control', 'no-store');
    res.send(text);
  } catch (e: any) {
    applyCors(res);
    res.status(502).json({ error: e?.message || 'social proxy failed' });
  }
}
