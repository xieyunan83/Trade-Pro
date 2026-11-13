import { enforceApiRateLimit } from './_firewall';
import { applyStrictCors, handleCorsPreflight } from './_cors';
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

type ProductSpec = { label: string; value: string };

type ProductItem = {
  id: string;
  title: string;
  image?: string;
  url?: string;
  source: string;
  specs?: ProductSpec[];
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

/** 单源拉取要短：Vercel 上外网不稳时拖满会 FUNCTION_INVOCATION_FAILED */
const FETCH_MS = 8_000;
/** 整包软截止，超时也必须 200 + 兜底，禁止裸 500 */
const BUILD_BUDGET_MS = 14_000;

const FALLBACK_FX: FxQuote[] = [
  { currency: '美元', code: 'USD', bocBuy: '718.00', bocSell: '721.00', bocMid: '719.50', publishedAt: '参考' },
  { currency: '欧元', code: 'EUR', bocBuy: '780.00', bocSell: '786.00', bocMid: '783.00', publishedAt: '参考' },
  { currency: '英镑', code: 'GBP', bocBuy: '910.00', bocSell: '918.00', bocMid: '914.00', publishedAt: '参考' },
  { currency: '日元', code: 'JPY', bocBuy: '4.70', bocSell: '4.78', bocMid: '4.74', publishedAt: '参考' },
  { currency: '港币', code: 'HKD', bocBuy: '92.00', bocSell: '92.60', bocMid: '92.30', publishedAt: '参考' },
  { currency: '澳大利亚元', code: 'AUD', bocBuy: '460.00', bocSell: '465.00', bocMid: '462.50', publishedAt: '参考' },
  { currency: '加拿大元', code: 'CAD', bocBuy: '510.00', bocSell: '515.00', bocMid: '512.50', publishedAt: '参考' },
  { currency: '新加坡元', code: 'SGD', bocBuy: '530.00', bocSell: '535.00', bocMid: '532.50', publishedAt: '参考' },
];

const FALLBACK_NEWS: NewsItem[] = [
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

const fetchText = async (url: string, accept?: string): Promise<string> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
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

/** 带图展示样本：无令牌时直接返回，避免慢速公开页爬取拖慢首屏 */
const SHOWCASE_PRODUCTS: ProductItem[] = [
  {
    id: 'showcase-01',
    title: '6.5CM 益智磁力片积木块 139PCS 百变拼搭',
    image:
      'https://imgs.toysbear.net/PIM/TS177241421253549/HS0000002/P17724521600211348_17724521606217078648.jpg',
    source: '优选展区',
    specs: [
      { label: '片规', value: '6.5 CM' },
      { label: '件数', value: '139 PCS' },
      { label: '品类', value: '磁力积木' },
    ],
  },
  {
    id: 'showcase-02',
    title: '恐龙沙滩车 · 三角龙套装',
    image:
      'https://imgs.toysbear.net/PIM/HS0016434/HS0000003/P17775471387195420_YX18228370_1777546466861.jpg',
    source: '优选展区',
    specs: [
      { label: '件数', value: '7 PCS' },
      { label: '品类', value: '沙滩车 / 恐龙' },
    ],
  },
  {
    id: 'showcase-03',
    title: '窗盒 9 关节 11.5 寸晚装芭比娃娃套装',
    image:
      'https://imgs.toysbear.net/PIM/HS159989662501368/HS0000005/P17145339579475943_542177741815878.jpg',
    source: '优选展区',
    specs: [
      { label: '尺寸', value: '11.5 寸' },
      { label: '关节', value: '9 关节实身' },
      { label: '配件', value: '服装 / 梳妆 / 包袋' },
    ],
  },
  {
    id: 'showcase-04',
    title: '超级飞侠 60cm 游泳圈',
    image: 'https://imgs.toysbear.net/PIM/a97d8914f6ed3354/G874_1792983185217438512.jpg',
    source: '优选展区',
    specs: [
      { label: '直径', value: '60 CM' },
      { label: '品类', value: '水上玩具' },
    ],
  },
  {
    id: 'showcase-05',
    title: '我的世界积木小号桶装 200 颗 + 10 人仔',
    image:
      'https://imgs.toysbear.net/PIM/HS176579240584318/HS0000002/P17658839968159955_17658839974462440460.jpg',
    source: '优选展区',
    specs: [
      { label: '件数', value: '210 PCS' },
      { label: '组成', value: '200 颗 + 10 人仔' },
      { label: '品类', value: '磁力积木方块' },
    ],
  },
  {
    id: 'showcase-06',
    title: '电动透明太空枪泡泡枪（带灯）',
    image:
      'https://imgs.toysbear.net/PIM/HS168301368615915/HS0000005/P17109367668961343_527441388294213.jpg',
    source: '优选展区',
    specs: [
      { label: '件数', value: '12 PCS / 箱' },
      { label: '功能', value: '电动 / 灯光' },
      { label: '品类', value: '泡泡枪' },
    ],
  },
  {
    id: 'showcase-07',
    title: '惊喜娃娃泡泡棒（4 色混装）',
    image:
      'https://imgs.toysbear.net/PIM/HS168007782044923/HS0000002/P17750147234029559_17750147241031993426.jpg',
    source: '优选展区',
    specs: [
      { label: '长度', value: '36 CM' },
      { label: '配色', value: '4 色混装' },
      { label: '品类', value: '泡泡棒' },
    ],
  },
  {
    id: 'showcase-08',
    title: '1:16 四通遥控车带灯光（敞篷款）',
    image:
      'https://imgs.toysbear.net/PIM/HS168310862356946/HS0000003/P17521405372312555_696214923726917.jpg',
    source: '优选展区',
    specs: [
      { label: '比例', value: '1:16' },
      { label: '通道', value: '四通遥控' },
      { label: '功能', value: '灯光' },
    ],
  },
  {
    id: 'showcase-09',
    title: '桌游摇摆叠叠乐 · 卡通鲨鱼平衡积木',
    image:
      'https://imgs.toysbear.net/PIM/HS160810544934535/HS0000003/P17148952959545773_543662067609670.jpg',
    source: '优选展区',
    specs: [
      { label: '块数', value: '48 块' },
      { label: '玩法', value: '摇摆叠叠 / 平衡' },
      { label: '品类', value: '桌游积木' },
    ],
  },
  {
    id: 'showcase-10',
    title: '120 毫升光棒萝卜兔泡泡棒',
    image:
      'https://imgs.toysbear.net/PIM/HS171775405706656/HS0000002/P17793417591565068_17793417608886878559.jpg',
    source: '优选展区',
    specs: [
      { label: '容量', value: '120 ML' },
      { label: '品类', value: '泡泡棒 / 光棒' },
    ],
  },
];

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

/** 公开汇率接口兜底（中行站不可达时）：把 1 外币兑 CNY 换成「每 100 外币」 */
const fetchAltFxQuotes = async (): Promise<FxQuote[]> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
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
      // rates[code] = 1 CNY 可兑多少外币 → 100 外币兑多少 CNY = 100 / perCny
      const mid = (100 / perCny).toFixed(code === 'JPY' ? 2 : 2);
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
    clearTimeout(t);
  }
};

const fetchFxQuotes = async (): Promise<{ quotes: FxQuote[]; error?: string }> => {
  try {
    const html = await fetchText(BOC_URL, 'text/html');
    const quotes = parseBoc(html);
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
  return { quotes: FALLBACK_FX.slice(), error: '实时牌价暂不可用，已显示参考价' };
};

const fetchNewsFeeds = async (): Promise<{ items: NewsItem[]; error?: string }> => {
  // 国内可访问源优先（Google RSS 在国内常不可达）
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
  const news: NewsItem[] = [];
  const newsErr: string[] = [];
  await Promise.all(
    feeds.map(async (f) => {
      try {
        const xml = await fetchText(f.url, 'application/rss+xml, application/xml, text/xml,*/*');
        news.push(...parseRss(xml, f.region, f.label, 10));
      } catch (e: any) {
        newsErr.push(`${f.label}: ${e?.message || e}`);
      }
    })
  );
  const seen = new Set<string>();
  let items = news.filter((n) => {
    const k = n.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!items.length) items = FALLBACK_NEWS.slice();
  return {
    items: items.slice(0, 24),
    error: newsErr.length && !news.length ? newsErr.join('; ') : undefined,
  };
};

const fetchIndustryBundle = async (
  token: string
): Promise<{ products: ProductItem[]; industryNews: NewsItem[]; error?: string }> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const [prodRes, newsRes] = await Promise.all([
      fetch('https://mapi.toysbear.net/product/TsbProductNew/NewProductList', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': UA,
        },
        body: JSON.stringify({ SkipCount: 0, MaxResultCount: 16, pageIndex: 1, pageSize: 16 }),
        signal: ctrl.signal,
      }),
      fetch('https://mapi.toysbear.net/synthesis/RealTimeInfo/RealTimeInfoPage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': UA,
        },
        body: JSON.stringify({ SkipCount: 0, MaxResultCount: 12, pageIndex: 1, pageSize: 12 }),
        signal: ctrl.signal,
      }),
    ]);
    let products: ProductItem[] = [];
    let error: string | undefined;
    try {
      const data = await prodRes.json();
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
      } else {
        error = data?.result?.msg || '行业新品暂无数据或令牌无效';
      }
    } catch (e: any) {
      error = e?.message || String(e);
    }
    const industryNews: NewsItem[] = [];
    try {
      const data = await newsRes.json();
      const list =
        data?.result?.items || data?.result?.item?.items || data?.result?.list || data?.items || [];
      if (Array.isArray(list)) {
        for (const row of list.slice(0, 12)) {
          industryNews.push({
            id: `ind-${row.id || industryNews.length}`,
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
      /* ignore */
    }
    return { products, industryNews, error };
  } catch (e: any) {
    return { products: [], industryNews: [], error: e?.message || String(e) };
  } finally {
    clearTimeout(t);
  }
};

const emptyIndustry = () => ({
  products: [] as ProductItem[],
  industryNews: [] as NewsItem[],
  error: undefined as string | undefined,
});

const softRace = async <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const buildFallbackPayload = (err?: string) => ({
  ok: true,
  fetchedAt: Date.now(),
  fx: {
    quotes: FALLBACK_FX.slice(),
    source: '参考汇率',
    note: '实时牌价暂不可用，已显示参考价。单位：人民币 / 100 外币。仅供参考。',
    error: err,
  },
  news: { items: FALLBACK_NEWS.slice(), error: err },
  products: { items: SHOWCASE_PRODUCTS.slice(0, 10), needsCredential: false },
});

async function buildPayload(industryToken?: string) {
  const [fxResult, newsResult, industryResult] = await Promise.all([
    softRace(fetchFxQuotes(), BUILD_BUDGET_MS, {
      quotes: FALLBACK_FX.slice(),
      error: '汇率拉取超时，已用参考价',
    }),
    softRace(fetchNewsFeeds(), BUILD_BUDGET_MS, {
      items: FALLBACK_NEWS.slice(),
      error: '资讯拉取超时，已用备选摘要',
    }),
    industryToken
      ? softRace(fetchIndustryBundle(industryToken), 10_000, emptyIndustry())
      : Promise.resolve(emptyIndustry()),
  ]);

  let products = industryResult.products.slice();
  let productsError = industryResult.error;
  let needsCredential = !industryToken || products.length === 0;

  if (products.length < 6) {
    const seen = new Set(products.map((p) => p.title.toLowerCase()));
    for (const p of SHOWCASE_PRODUCTS) {
      if (seen.has(p.title.toLowerCase())) continue;
      products.push(p);
      if (products.length >= 10) break;
    }
    needsCredential = false;
    productsError = undefined;
  }

  let newsItems = [...industryResult.industryNews, ...newsResult.items].slice(0, 28);
  if (!newsItems.length) newsItems = FALLBACK_NEWS.slice();

  const fxQuotes = fxResult.quotes.length ? fxResult.quotes : FALLBACK_FX.slice();

  return {
    ok: true,
    fetchedAt: Date.now(),
    fx: {
      quotes: fxQuotes,
      source: fxResult.error?.includes('公开市价')
        ? '公开市价'
        : fxResult.error?.includes('参考')
          ? '参考汇率'
          : '中国银行外汇牌价',
      note: '买入/卖出为现汇价参考；中间价为折算价。单位：人民币 / 100 外币。仅供参考。',
      error: fxResult.error,
    },
    news: {
      items: newsItems,
      error: newsResult.error || industryResult.error,
    },
    products: { items: products, error: productsError, needsCredential },
  };
}

export default async function handler(req: any, res: any) {
  try {
    if (handleCorsPreflight(req, res)) return;
    applyStrictCors(req, res);
    if (!enforceApiRateLimit(req, res, 'landing')) return;
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'GET only' });
      return;
    }
    const tokenHdr = req.headers?.['x-industry-token'];
    const industryToken = typeof tokenHdr === 'string' ? tokenHdr.trim() : '';
    const payload = await softRace(
      buildPayload(industryToken || undefined),
      BUILD_BUDGET_MS + 2_000,
      buildFallbackPayload('看板拉取超时，已显示备选内容')
    );
    res.status(200).json(payload);
  } catch (e: any) {
    console.error('[landing]', e);
    try {
      res.status(200).json(buildFallbackPayload(e?.message || String(e)));
    } catch {
      /* 最后防线：连 json 都失败时仍避免未捕获崩进程 */
      res.statusCode = 200;
      res.setHeader?.('Content-Type', 'application/json');
      res.end?.(JSON.stringify(buildFallbackPayload('landing failed')));
    }
  }
}
