/**
 * 着陆页数据核心（Node / Serverless 与本地中间件共用）
 * - 汇率：中国银行官网外汇牌价（现汇买入/卖出 + 折算价）
 * - 资讯：国内/国际公开新闻源 + 可选行业源令牌拉取
 * - 新品：行业源令牌 / 公开页尽力解析
 *
 * 前台文案不得泄露供应商商品名（见 ui-no-vendor-leak）。
 */

export type FxQuote = {
  currency: string;
  code: string;
  /** 中行现汇买入价（每 100 外币兑人民币） */
  bocBuy: string;
  /** 中行现汇卖出价 */
  bocSell: string;
  /** 中行折算价（作中间价参考） */
  bocMid: string;
  /** 现钞买入（可选） */
  cashBuy?: string;
  publishedAt: string;
};

export type LandingNewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  region: 'cn' | 'intl' | 'industry';
};

export type LandingProductSpec = {
  label: string;
  value: string;
};

export type LandingProductItem = {
  id: string;
  title: string;
  image?: string;
  url?: string;
  source: string;
  /** 展区可见参数（规格 / 件数等），前台中性展示 */
  specs?: LandingProductSpec[];
};

export type LandingPayload = {
  ok: boolean;
  fetchedAt: number;
  fx: { quotes: FxQuote[]; source: string; note: string; error?: string };
  news: { items: LandingNewsItem[]; error?: string };
  products: { items: LandingProductItem[]; error?: string; needsCredential?: boolean };
};

const BOC_URL = 'https://www.bank-of-china.com/sourcedb/whpj/index.html';

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

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_MS = 8_000;

/** 外网 RSS 不可达时的中性兜底（避免看板永久「资讯更新中」） */
export const LANDING_FALLBACK_NEWS: LandingNewsItem[] = [
  {
    id: 'fb-news-1',
    title: '全球玩具与婴童用品供应链持续向高附加值设计与合规认证倾斜',
    url: 'https://www.chinanews.com.cn/business/',
    source: '产业观察',
    region: 'cn',
  },
  {
    id: 'fb-news-2',
    title: '出口企业关注目标市场安全标准与包装回收要求更新',
    url: 'https://www.mofcom.gov.cn/',
    source: '贸易合规',
    region: 'cn',
  },
  {
    id: 'fb-news-3',
    title: '跨境选品：渠道热度、价带与交付周期成为报价关键变量',
    url: 'https://www.people.com.cn/',
    source: '市场速览',
    region: 'cn',
  },
  {
    id: 'fb-news-4',
    title: '国际展会与线上货架仍是新品测款的主要窗口',
    url: 'https://www.reuters.com/',
    source: '国际零售',
    region: 'intl',
  },
  {
    id: 'fb-news-5',
    title: '汇率波动下，建议报价单同时标注币种与有效期',
    url: 'https://www.bank-of-china.com/sourcedb/whpj/',
    source: '汇率提示',
    region: 'cn',
  },
  {
    id: 'fb-news-6',
    title: '知识产权与外观专利检索应纳入开发触达前检查清单',
    url: 'https://www.cnipa.gov.cn/',
    source: '知产提醒',
    region: 'cn',
  },
];

/** 带 curl 回退（本机走系统代理时 Node fetch 常超时；Vercel 上直连即可） */
const fetchText = async (url: string, accept?: string): Promise<string> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept || 'text/html,*/*' },
      signal: ctrl.signal,
    });
    if (res.ok) return await res.text();
    throw new Error(`HTTP ${res.status}`);
  } catch (first) {
    // Vercel 无 curl；仅本地开发用系统代理回退
    if (
      typeof process === 'undefined' ||
      !process.versions?.node ||
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME
    ) {
      throw first;
    }
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(
        'curl',
        ['-sL', '-A', UA, '--max-time', '8', '-H', `Accept: ${accept || '*/*'}`, url],
        { env: process.env, maxBuffer: 8_000_000 }
      );
      return Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout);
    } catch {
      throw first;
    }
  } finally {
    clearTimeout(timer);
  }
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

export const parseBocFxHtml = (html: string): FxQuote[] => {
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
    const code = MAJOR_FX.find((x) => x.name === currency)?.code || '';
    byName.set(currency, {
      currency,
      code,
      bocBuy: bocBuy || cashBuy || '—',
      bocSell: bocSell || '—',
      bocMid: bocMid || '—',
      cashBuy: cashBuy || undefined,
      publishedAt,
    });
  }
  const ordered: FxQuote[] = [];
  for (const { name, code } of MAJOR_FX) {
    const q = byName.get(name);
    if (q) ordered.push({ ...q, code });
  }
  return ordered;
};

/** 中行/公开市价都失败时的参考价（每 100 外币兑人民币） */
export const LANDING_FALLBACK_FX: FxQuote[] = [
  { currency: '美元', code: 'USD', bocBuy: '718.00', bocSell: '721.00', bocMid: '719.50', publishedAt: '参考' },
  { currency: '欧元', code: 'EUR', bocBuy: '780.00', bocSell: '786.00', bocMid: '783.00', publishedAt: '参考' },
  { currency: '英镑', code: 'GBP', bocBuy: '910.00', bocSell: '918.00', bocMid: '914.00', publishedAt: '参考' },
  { currency: '日元', code: 'JPY', bocBuy: '4.70', bocSell: '4.78', bocMid: '4.74', publishedAt: '参考' },
  { currency: '港币', code: 'HKD', bocBuy: '92.00', bocSell: '92.60', bocMid: '92.30', publishedAt: '参考' },
  { currency: '澳大利亚元', code: 'AUD', bocBuy: '460.00', bocSell: '465.00', bocMid: '462.50', publishedAt: '参考' },
  { currency: '加拿大元', code: 'CAD', bocBuy: '510.00', bocSell: '515.00', bocMid: '512.50', publishedAt: '参考' },
  { currency: '新加坡元', code: 'SGD', bocBuy: '530.00', bocSell: '535.00', bocMid: '532.50', publishedAt: '参考' },
];

const fetchAltFxQuotes = async (): Promise<FxQuote[]> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/CNY', {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rates = data?.rates || {};
    const out: FxQuote[] = [];
    for (const { name, code } of MAJOR_FX) {
      const perCny = rates[code];
      if (!perCny || !(perCny > 0)) continue;
      const mid = (100 / perCny).toFixed(2);
      out.push({
        currency: name,
        code,
        bocBuy: mid,
        bocSell: mid,
        bocMid: mid,
        publishedAt: '公开市价',
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
};

export const fetchBocFx = async (): Promise<{ quotes: FxQuote[]; error?: string }> => {
  try {
    const html = await fetchText(BOC_URL, 'text/html');
    const quotes = parseBocFxHtml(html);
    if (quotes.length) return { quotes };
  } catch {
    /* try alt */
  }
  try {
    const alt = await fetchAltFxQuotes();
    if (alt.length) return { quotes: alt, error: '中行暂不可达，已用公开市价' };
  } catch {
    /* fall through */
  }
  return {
    quotes: LANDING_FALLBACK_FX.slice(),
    error: '实时牌价暂不可用，已显示参考价',
  };
};

const parseRssItems = (
  xml: string,
  region: 'cn' | 'intl',
  sourceLabel: string,
  limit: number
): LandingNewsItem[] => {
  const items: LandingNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = stripHtml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const link = stripHtml((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
    const pub = stripHtml(
      (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || ''
    );
    if (!title || !link) continue;
    items.push({
      id: `${region}-${items.length}-${title.slice(0, 24)}`,
      title,
      url: link,
      source: sourceLabel,
      publishedAt: pub || undefined,
      region,
    });
    if (items.length >= limit) break;
  }
  return items;
};

export const fetchPublicNews = async (): Promise<{
  items: LandingNewsItem[];
  error?: string;
}> => {
  // 国内可访问源优先（Google RSS 在国内常不可达，会导致看板永久空窗）
  const feeds: { url: string; region: 'cn' | 'intl'; label: string }[] = [
    {
      url: 'https://www.chinanews.com.cn/rss/finance.xml',
      region: 'cn',
      label: '国内财经',
    },
    {
      url: 'https://www.people.com.cn/rss/finance.xml',
      region: 'cn',
      label: '国内财经·人民网',
    },
    {
      url: 'https://www.chinanews.com.cn/rss/world.xml',
      region: 'intl',
      label: '国际要闻',
    },
    {
      url: 'https://news.google.com/rss/search?q=toy+industry+OR+%22toy+fair%22&hl=en-US&gl=US&ceid=US:en',
      region: 'intl',
      label: '国际玩具资讯',
    },
  ];
  const errors: string[] = [];
  const all: LandingNewsItem[] = [];
  await Promise.all(
    feeds.map(async (f) => {
      try {
        const xml = await fetchText(f.url, 'application/rss+xml, application/xml, text/xml,*/*');
        all.push(...parseRssItems(xml, f.region, f.label, 8));
      } catch (e: any) {
        errors.push(`${f.label}: ${e?.message || e}`);
      }
    })
  );
  // 去重标题
  const seen = new Set<string>();
  let deduped = all.filter((n) => {
    const k = n.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!deduped.length) {
    deduped = LANDING_FALLBACK_NEWS;
  }
  return {
    items: deduped.slice(0, 24),
    error: errors.length && !all.length ? errors.join('; ') : undefined,
  };
};

/** 行业源（需令牌）：资讯 */
export const fetchIndustryNewsWithToken = async (
  token: string
): Promise<LandingNewsItem[]> => {
  const res = await fetch('https://mapi.toysbear.net/synthesis/RealTimeInfo/RealTimeInfoPage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': UA,
      IsHome: '1',
    },
    body: JSON.stringify({
      SkipCount: 0,
      MaxResultCount: 12,
      pageIndex: 1,
      pageSize: 12,
    }),
  });
  if (!res.ok) throw new Error(`行业资讯 HTTP ${res.status}`);
  const data = await res.json();
  const list =
    data?.result?.items ||
    data?.result?.item?.items ||
    data?.result?.list ||
    data?.items ||
    [];
  if (!Array.isArray(list)) {
    if (data?.result?.code === 401 || data?.success === false) {
      throw new Error('行业资讯令牌无效或已过期');
    }
    return [];
  }
  return list.slice(0, 12).map((row: any, i: number) => ({
    id: `ind-news-${row.id || i}`,
    title: String(row.title || row.Title || row.name || '资讯'),
    url: row.url || row.link || `https://www.toysbear.com/toyConsultationDetail/${row.id || ''}`,
    source: '优选行业资讯',
    publishedAt: row.publishTime || row.creationTime || row.CreationTime,
    region: 'industry' as const,
  }));
};

/** 行业源（需令牌）：新品 */
export const fetchIndustryProductsWithToken = async (
  token: string
): Promise<LandingProductItem[]> => {
  const res = await fetch('https://mapi.toysbear.net/product/TsbProductNew/NewProductList', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': UA,
      IsHome: '1',
    },
    body: JSON.stringify({
      SkipCount: 0,
      MaxResultCount: 16,
      pageIndex: 1,
      pageSize: 16,
    }),
  });
  if (!res.ok) throw new Error(`行业新品 HTTP ${res.status}`);
  const data = await res.json();
  const list =
    data?.result?.items ||
    data?.result?.item?.items ||
    data?.result?.list ||
    data?.items ||
    [];
  if (!Array.isArray(list)) {
    if (data?.result?.code === 401 || data?.success === false) {
      throw new Error('行业新品令牌无效或已过期');
    }
    return [];
  }
  return list.slice(0, 16).map((row: any, i: number) => ({
    id: `ind-prod-${row.id || row.productId || i}`,
    title: String(row.productName || row.name || row.Name || '新品'),
    image: row.imageUrl || row.imgUrl || row.mainImage || row.pic || undefined,
    url: row.url || undefined,
    source: '优选行业新品',
  }));
};

/** 公开页尽力解析新品标题（无需登录；结构变化时可能为空） */
export const scrapePublicNewArrivals = async (): Promise<LandingProductItem[]> => {
  const urls = [
    'https://www.toysaas.com/new_arrivals',
    'https://www.toysbear.com/newsZone',
  ];
  const out: LandingProductItem[] = [];
  for (const url of urls) {
    try {
      const html = await fetchText(url, 'text/html');
      // 常见卡片标题：alt / 短文本节点
      const alts = [...html.matchAll(/alt="([^"]{6,80})"/g)].map((x) => stripHtml(x[1]));
      const titles = [...html.matchAll(/>([\u4e00-\u9fffA-Za-z0-9][^<]{5,60})</g)]
        .map((x) => stripHtml(x[1]))
        .filter(
          (t) =>
            t.length >= 6 &&
            t.length <= 60 &&
            !/登录|注册|首页|关于|联系|Copyright|加载|更多/.test(t)
        );
      const pool = [...alts, ...titles];
      const seen = new Set<string>();
      for (const title of pool) {
        if (seen.has(title)) continue;
        seen.add(title);
        out.push({
          id: `pub-${out.length}`,
          title,
          url,
          source: '公开优选展区',
        });
        if (out.length >= 16) break;
      }
      if (out.length >= 8) break;
    } catch {
      /* continue */
    }
  }
  return out.slice(0, 16);
};

export type LandingFetchOptions = {
  industryToken?: string;
};

export const buildLandingPayload = async (
  opts?: LandingFetchOptions
): Promise<LandingPayload> => {
  // 动态引入展示样本，避免无令牌时慢速公开页爬取
  const { LANDING_SHOWCASE_PRODUCTS } = await import('./landingShowcase');

  const industryToken = opts?.industryToken?.trim();
  const [fx, news, industry] = await Promise.all([
    fetchBocFx(),
    fetchPublicNews(),
    industryToken
      ? Promise.all([
          fetchIndustryNewsWithToken(industryToken).catch(() => [] as LandingNewsItem[]),
          fetchIndustryProductsWithToken(industryToken).catch((e: any) => {
            throw e;
          }),
        ])
          .then(([n, p]) => ({ news: n, products: p as LandingProductItem[], error: undefined as string | undefined }))
          .catch((e: any) => ({
            news: [] as LandingNewsItem[],
            products: [] as LandingProductItem[],
            error: e?.message || String(e),
          }))
      : Promise.resolve({
          news: [] as LandingNewsItem[],
          products: [] as LandingProductItem[],
          error: undefined as string | undefined,
        }),
  ]);

  let products = industry.products;
  let productsError = industry.error;
  const needsCredential = !industryToken || products.length === 0;

  if (products.length < 6) {
    const seen = new Set(products.map((p) => p.title.toLowerCase()));
    for (const p of LANDING_SHOWCASE_PRODUCTS) {
      if (seen.has(p.title.toLowerCase())) continue;
      products.push(p);
      if (products.length >= 10) break;
    }
    productsError = undefined;
  }

  let newsItems = [...industry.news, ...news.items].slice(0, 28);
  if (!newsItems.length) {
    newsItems = LANDING_FALLBACK_NEWS.slice();
  }

  const fxQuotes = fx.quotes.length ? fx.quotes : LANDING_FALLBACK_FX.slice();

  return {
    ok: true,
    fetchedAt: Date.now(),
    fx: {
      quotes: fxQuotes,
      source: fx.error?.includes('公开市价')
        ? '公开市价'
        : fx.error?.includes('参考')
          ? '参考汇率'
          : '中国银行外汇牌价',
      note: '买入/卖出为现汇价参考；中间价为折算价。单位：人民币 / 100 外币。仅供参考，成交以银行柜台为准。',
      error: fx.error,
    },
    news: {
      items: newsItems,
      error: news.error || industry.error,
    },
    products: {
      items: products,
      error: productsError,
      needsCredential: needsCredential && products.filter((p) => p.image).length === 0,
    },
  };
};
