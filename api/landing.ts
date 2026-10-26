/**
 * 着陆页聚合（自包含，避免跨目录 import 导致 Vercel FUNCTION_INVOCATION_FAILED）
 * GET /api/landing
 * Header 可选：x-industry-token
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  memory: 512,
};

type FxQuote = {
  currency: string;
  code: string;
  bocBuy: string;
  bocSell: string;
  bocMid: string;
  cashBuy?: string;
  publishedAt: string;
};

type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  region: 'cn' | 'intl' | 'industry';
};

type ProductItem = {
  id: string;
  title: string;
  image?: string;
  url?: string;
  source: string;
};

const BOC_URL = 'https://www.bank-of-china.com/sourcedb/whpj/index.html';
const UA =
  'Mozilla/5.0 (compatible; TradeCollabHub/1.0; +https://babyworld.ltd)';

const MAJOR_FX: { name: string; code: string }[] = [
  { name: '美元', code: 'USD' },
  { name: '欧元', code: 'EUR' },
  { name: '英镑', code: 'GBP' },
  { name: '日元', code: 'JPY' },
  { name: '港币', code: 'HKD' },
  { name: '澳大利亚元', code: 'AUD' },
  { name: '加拿大元', code: 'CAD' },
  { name: '新加坡元', code: 'SGD' },
  { name: '瑞士法郎', code: 'CHF' },
  { name: '韩国元', code: 'KRW' },
  { name: '新西兰元', code: 'NZD' },
  { name: '泰国铢', code: 'THB' },
];

const applyCors = (res: any) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, x-industry-token, authorization'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
};

const stripHtml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();

const fetchText = async (url: string, accept?: string): Promise<string> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 22_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept || 'text/html,*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
};

const parseBoc = (html: string): FxQuote[] => {
  const pat =
    /<td>([^<]+)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/g;
  const byName = new Map<string, FxQuote>();
  let m: RegExpExecArray | null;
  while ((m = pat.exec(html))) {
    const currency = m[1].trim();
    const bocBuy = (m[2] || '').trim();
    const cashBuy = (m[3] || '').trim();
    const bocSell = (m[4] || '').trim();
    const bocMid = (m[6] || '').trim();
    const publishedAt = (m[7] || '').trim();
    byName.set(currency, {
      currency,
      code: MAJOR_FX.find((x) => x.name === currency)?.code || '',
      bocBuy: bocBuy || cashBuy || '—',
      bocSell: bocSell || '—',
      bocMid: bocMid || '—',
      cashBuy: cashBuy || undefined,
      publishedAt,
    });
  }
  return MAJOR_FX.map(({ name, code }) => {
    const q = byName.get(name);
    return q ? { ...q, code } : null;
  }).filter(Boolean) as FxQuote[];
};

const parseRss = (
  xml: string,
  region: 'cn' | 'intl',
  source: string,
  limit: number
): NewsItem[] => {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = stripHtml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const link = stripHtml((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
    const pub = stripHtml((block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
    if (!title || !link) continue;
    items.push({
      id: `${region}-${items.length}`,
      title,
      url: link,
      source,
      publishedAt: pub || undefined,
      region,
    });
    if (items.length >= limit) break;
  }
  return items;
};

async function buildPayload(industryToken?: string) {
  const fxErr: string[] = [];
  let quotes: FxQuote[] = [];
  try {
    const html = await fetchText(BOC_URL, 'text/html');
    quotes = parseBoc(html);
    if (!quotes.length) fxErr.push('未能解析中行牌价');
  } catch (e: any) {
    fxErr.push(e?.message || String(e));
  }

  const feeds: { url: string; region: 'cn' | 'intl'; label: string }[] = [
    {
      url: 'https://news.google.com/rss/search?q=%E7%8E%A9%E5%85%B7%E4%BA%A7%E4%B8%9A+OR+%E7%8E%A9%E5%85%B7%E5%87%BA%E5%8F%A3&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
      region: 'cn',
      label: '国内产业资讯',
    },
    {
      url: 'https://news.google.com/rss/search?q=%E6%BE%84%E6%B5%B7%E7%8E%A9%E5%85%B7&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
      region: 'cn',
      label: '产地动态',
    },
    {
      url: 'https://news.google.com/rss/search?q=toy+industry+OR+%22toy+fair%22+OR+toys+wholesale&hl=en-US&gl=US&ceid=US:en',
      region: 'intl',
      label: '国际玩具资讯',
    },
    {
      url: 'https://news.google.com/rss/search?q=Mattel+OR+Hasbro+OR+LEGO+toys+OR+tariff&hl=en-US&gl=US&ceid=US:en',
      region: 'intl',
      label: '品牌与贸易',
    },
  ];

  const news: NewsItem[] = [];
  const newsErr: string[] = [];
  await Promise.all(
    feeds.map(async (f) => {
      try {
        const xml = await fetchText(f.url, 'application/rss+xml, application/xml, text/xml,*/*');
        news.push(...parseRss(xml, f.region, f.label, 8));
      } catch (e: any) {
        newsErr.push(`${f.label}: ${e?.message || e}`);
      }
    })
  );
  const seen = new Set<string>();
  const newsDedup = news.filter((n) => {
    const k = n.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 24);

  let products: ProductItem[] = [];
  let productsError: string | undefined;
  let needsCredential = !industryToken;

  if (industryToken) {
    try {
      const res = await fetch(
        'https://mapi.toysbear.net/product/TsbProductNew/NewProductList',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${industryToken}`,
            'User-Agent': UA,
          },
          body: JSON.stringify({ SkipCount: 0, MaxResultCount: 16, pageIndex: 1, pageSize: 16 }),
        }
      );
      const data = await res.json();
      const list =
        data?.result?.items || data?.result?.item?.items || data?.result?.list || data?.items || [];
      if (Array.isArray(list) && list.length) {
        products = list.slice(0, 16).map((row: any, i: number) => ({
          id: `p-${row.id || i}`,
          title: String(row.productName || row.name || '新品'),
          image: row.imageUrl || row.imgUrl || row.mainImage || undefined,
          url: row.url || undefined,
          source: '优选行业新品',
        }));
        needsCredential = false;
      } else {
        productsError = data?.result?.msg || '行业新品暂无数据或令牌无效';
        needsCredential = true;
      }
    } catch (e: any) {
      productsError = e?.message || String(e);
      needsCredential = true;
    }

    try {
      const res = await fetch(
        'https://mapi.toysbear.net/synthesis/RealTimeInfo/RealTimeInfoPage',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${industryToken}`,
            'User-Agent': UA,
          },
          body: JSON.stringify({ SkipCount: 0, MaxResultCount: 12, pageIndex: 1, pageSize: 12 }),
        }
      );
      const data = await res.json();
      const list =
        data?.result?.items || data?.result?.item?.items || data?.result?.list || data?.items || [];
      if (Array.isArray(list)) {
        for (const row of list.slice(0, 12)) {
          newsDedup.unshift({
            id: `ind-${row.id || Math.random()}`,
            title: String(row.title || row.Title || '资讯'),
            url:
              row.url ||
              row.link ||
              `https://www.toysbear.com/toyConsultationDetail/${row.id || ''}`,
            source: '优选行业资讯',
            publishedAt: row.publishTime || row.creationTime,
            region: 'industry',
          });
        }
      }
    } catch {
      /* ignore industry news failure */
    }
  } else {
    // 公开页尽力解析
    try {
      const html = await fetchText('https://www.toysaas.com/new_arrivals', 'text/html');
      const alts = [...html.matchAll(/alt="([^"]{6,80})"/g)].map((x) => stripHtml(x[1]));
      const seenT = new Set<string>();
      for (const title of alts) {
        if (seenT.has(title) || /登录|注册|首页|Copyright/.test(title)) continue;
        seenT.add(title);
        products.push({
          id: `pub-${products.length}`,
          title,
          url: 'https://www.toysaas.com/new_arrivals',
          source: '公开优选展区',
        });
        if (products.length >= 12) break;
      }
    } catch (e: any) {
      productsError = e?.message || String(e);
    }
  }

  return {
    ok: true,
    fetchedAt: Date.now(),
    fx: {
      quotes,
      source: '中国银行外汇牌价',
      note: '买入/卖出为中行现汇价；中间价列为中行折算价。单位：人民币 / 100 外币。仅供参考。',
      error: fxErr.length ? fxErr.join('; ') : undefined,
    },
    news: {
      items: newsDedup.slice(0, 28),
      error: newsErr.length && !newsDedup.length ? newsErr.join('; ') : undefined,
    },
    products: { items: products, error: productsError, needsCredential },
  };
}

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
    const payload = await buildPayload(industryToken || undefined);
    res.status(200).json(payload);
  } catch (e: any) {
    console.error('[landing]', e);
    res.status(200).json({
      ok: false,
      error: e?.message || String(e),
      fetchedAt: Date.now(),
      fx: {
        quotes: [],
        source: '中国银行外汇牌价',
        note: '',
        error: e?.message || 'failed',
      },
      news: { items: [], error: e?.message || 'failed' },
      products: { items: [], needsCredential: true, error: e?.message || 'failed' },
    });
  }
}
