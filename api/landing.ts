/**
 * 着陆页聚合：中行汇率 + 行业/公开资讯 + 新品
 * GET /api/landing
 * Header 可选：x-industry-token（行业源访问令牌，管理后台配置）
 */
import { buildLandingPayload } from '../services/landingDataCore';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, x-industry-token, authorization'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
};

export default async function handler(req: any, res: any) {
  try {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'GET only' });
      return;
    }
    const tokenHdr = req.headers?.['x-industry-token'];
    const industryToken = typeof tokenHdr === 'string' ? tokenHdr.trim() : '';
    const payload = await buildLandingPayload({ industryToken: industryToken || undefined });
    res.status(200).json(payload);
  } catch (e: any) {
    res.status(500).json({
      ok: false,
      error: e?.message || String(e),
      fetchedAt: Date.now(),
      fx: { quotes: [], source: '', note: '', error: 'failed' },
      news: { items: [] },
      products: { items: [] },
    });
  }
}
