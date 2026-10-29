/**
 * 把「建站指令」解析成页面文案，禁止把整段提示词贴进 Hero 标题。
 */
import type { SiteTemplateId } from './siteBuilderTemplates';
import { analyzeReferenceFromPrompt } from './siteReferenceAnalyze';

export type PlannedSiteCopy = {
  brandName: string;
  siteTitle: string;
  heroTitle: string;
  heroBody: string;
  productsTitle: string;
  productCards: string[];
  featuresTitle: string;
  featuresBody: string;
  aboutTitle: string;
  aboutBody: string;
  ctaTitle: string;
  ctaBody: string;
  trustLine: string;
  categories: string[];
  locale: 'zh' | 'en';
  templateId: SiteTemplateId;
  styleHint: 'fashion' | 'classic' | 'minimal' | 'playful';
};

const stripUrls = (s: string) => s.replace(/https?:\/\/[^\s<>"'）】\]]+/gi, ' ').replace(/\s+/g, ' ').trim();

/** 去掉「请帮我设计网站…」这类元指令，只留业务语义 */
const stripMetaInstructions = (s: string): string =>
  s
    .replace(
      /请?(帮我|帮忙)?(设计|搭建|做一个|生成|开发)?(一个|一座)?(网站|官网|独立站|站点)[^。！？\n]*/gi,
      ' '
    )
    .replace(
      /(前端|页面|后台|管理|数据库|部署|vercel|next\.?js|react)[^。！？\n]*/gi,
      ' '
    )
    .replace(/风格请参考[^。！？\n]*/gi, ' ')
    .replace(/要求[：:][^。！？\n]*/gi, ' ')
    .replace(/参考(这个)?网站[^。！？\n]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const detectLocale = (prompt: string): 'zh' | 'en' => {
  if (/english|英文|overseas|export\s+site/i.test(prompt) && !/中文站|中文官网/.test(prompt)) {
    return 'en';
  }
  const zh = (prompt.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (prompt.match(/[a-zA-Z]/g) || []).length;
  return zh >= en ? 'zh' : 'en';
};

const detectStyle = (prompt: string): PlannedSiteCopy['styleHint'] => {
  if (/时尚|fashion|潮流|modern|当代/i.test(prompt)) return 'fashion';
  if (/极简|minimal|clean|简约/i.test(prompt)) return 'minimal';
  if (/童趣|可爱|playful|卡通|bubble/i.test(prompt)) return 'playful';
  return 'classic';
};

type Industry = {
  key: string;
  brandZh: string;
  brandEn: string;
  heroZh: [string, string];
  heroEn: [string, string];
  catsZh: string[];
  catsEn: string[];
  productsZh: string[];
  productsEn: string[];
  aboutZh: string;
  aboutEn: string;
  trustZh: string;
  trustEn: string;
};

const INDUSTRIES: Array<{ test: RegExp; data: Industry }> = [
  {
    test: /泡泡|bubble|吹泡|泡泡机|soap\s*bubble/i,
    data: {
      key: 'bubble',
      brandZh: '泡趣工场',
      brandEn: 'BubbleForge',
      heroZh: ['会玩的泡泡，认真做出口', '工厂直达 · 户外派对 · 电动泡泡机一站选品'],
      heroEn: [
        'Playful bubbles. Export-ready quality.',
        'Factory-direct bubble toys for retailers — machines, wands, and party sets.',
      ],
      catsZh: ['电动泡泡机', '手持泡泡棒', '户外派对装', 'OEM / ODM'],
      catsEn: ['Bubble machines', 'Wands & guns', 'Party outdoor sets', 'OEM / ODM'],
      productsZh: [
        '电动泡泡机 · 桌面款',
        '户外大泡泡套装',
        '儿童泡泡枪',
        '派对泡泡液礼盒',
        '灯光泡泡机',
        '商超陈列套装',
      ],
      productsEn: [
        'Desktop bubble machine',
        'Outdoor mega bubble kit',
        'Kids bubble blaster',
        'Party bubble fluid set',
        'LED bubble machine',
        'Retail display pack',
      ],
      aboutZh:
        '我们专注泡泡类玩具研发与量产，服务全球采购商：稳定开模、合规证书、灵活起订，支持贴牌与定制包材。',
      aboutEn:
        'We specialize in bubble toys for global buyers — stable tooling, compliance docs, flexible MOQ, and private-label packaging.',
      trustZh: '工厂直达 · 快速打样 · 证书齐全 · 专属跟单',
      trustEn: 'Factory-direct · Fast sampling · Certificates · Dedicated merchandiser',
    },
  },
  {
    test: /玩具|toy|kids|儿童|公仔|plush/i,
    data: {
      key: 'toy',
      brandZh: '潮玩出海',
      brandEn: 'PlayExport',
      heroZh: ['把好玩具，卖到全世界', '选品清晰 · 合规齐全 · 询盘即回复'],
      heroEn: [
        'Toys built for global shelves.',
        'Clear assortments, compliance-ready packs, and a desk that replies fast.',
      ],
      catsZh: ['热销爆款', '新品预告', 'OEM 定制', '证书合规'],
      catsEn: ['Best sellers', 'New arrivals', 'OEM custom', 'Compliance'],
      productsZh: ['热销系列 A', '热销系列 B', '礼盒套装', '季节限定', '入门畅销款', '展会主推'],
      productsEn: [
        'Hero series A',
        'Hero series B',
        'Gift set',
        'Seasonal drop',
        'Entry bestseller',
        'Fair highlight',
      ],
      aboutZh: '面向进口商与连锁渠道的玩具工厂展厅站：产品、证书、MOQ 与询盘路径一次说清。',
      aboutEn:
        'A factory showroom site for importers and chains — products, certificates, MOQ and inquiry paths in one place.',
      trustZh: '工厂直达 · MOQ 灵活 · 证书齐全 · 专属跟单',
      trustEn: 'Factory-direct · Flexible MOQ · Certificates · Dedicated desk',
    },
  },
];

const defaultIndustry = (): Industry => ({
  key: 'general',
  brandZh: '出口展厅',
  brandEn: 'TradeDesk',
  heroZh: ['让海外买家，一眼看懂你的货盘', '产品、优势与询盘入口，一页完成'],
  heroEn: [
    'Make your catalog clear to overseas buyers.',
    'Products, strengths, and a quote path — one page.',
  ],
  catsZh: ['产品线', '实力', '证书', '联系'],
  catsEn: ['Lines', 'Capability', 'Certificates', 'Contact'],
  productsZh: ['主力型号', '畅销款', '定制款', '新品', '礼盒', '配件'],
  productsEn: ['Core model', 'Bestseller', 'Custom SKU', 'New arrival', 'Gift set', 'Accessories'],
  aboutZh: '专业外贸展厅页：突出货盘与信任背书，方便采购快速询盘。',
  aboutEn: 'A B2B showcase page that highlights assortment and trust signals for fast inquiries.',
  trustZh: '工厂直达 · 快速打样 · 全球发货',
  trustEn: 'Factory-direct · Fast sampling · Global shipping',
});

const pickIndustry = (prompt: string): Industry => {
  for (const row of INDUSTRIES) {
    if (row.test.test(prompt)) return row.data;
  }
  return defaultIndustry();
};

/** 从产品库标签或提示词里抽若干产品名 */
const inferProducts = (
  prompt: string,
  labels: string[],
  industry: Industry,
  locale: 'zh' | 'en'
): string[] => {
  if (labels.length) return labels.slice(0, 8);
  const fromPrompt: string[] = [];
  const skuHits = prompt.match(/[A-Z]{1,5}[-_]?\d{2,}[A-Z0-9_-]*/g) || [];
  skuHits.slice(0, 4).forEach((s) => fromPrompt.push(s));
  const zhItems = prompt.match(/[\u4e00-\u9fff]{2,12}(机|枪|棒|套装|礼盒|玩具|系列)/g) || [];
  zhItems.slice(0, 4).forEach((s) => {
    if (!fromPrompt.includes(s)) fromPrompt.push(s);
  });
  if (fromPrompt.length >= 3) return fromPrompt.slice(0, 8);
  return locale === 'zh' ? industry.productsZh : industry.productsEn;
};

/**
 * 核心：用户指令 → 可渲染的站点文案（标题短、不回显整段 prompt）
 */
export const planSiteCopyFromPrompt = (
  prompt: string,
  productLabels: string[],
  preferredTemplate?: SiteTemplateId
): PlannedSiteCopy => {
  const raw = (prompt || '').trim();
  const ref = analyzeReferenceFromPrompt(raw);
  const locale = detectLocale(raw);
  const styleHint = detectStyle(raw);
  const industry = pickIndustry(raw);
  const cleaned = stripMetaInstructions(stripUrls(raw));

  const templateId =
    preferredTemplate ||
    ref.suggestedTemplate ||
    (styleHint === 'minimal' ? 'minimal_clean' : styleHint === 'fashion' ? 'trade_hero' : 'trade_hero');

  const brandName = locale === 'zh' ? industry.brandZh : industry.brandEn;
  const [heroTitleDefault, heroBodyDefault] =
    locale === 'zh' ? industry.heroZh : industry.heroEn;

  // 若清洗后仍很长，绝不整段当标题；只取短句或默认商业标题
  let heroTitle = heroTitleDefault;
  const shortCandidate = cleaned
    .split(/[。！？.!?\n]/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4 && x.length <= 28 && !/网站|前端|后台|数据库|参考|风格/.test(x))[0];
  if (shortCandidate && !/请|帮我|设计|搭建/.test(shortCandidate)) {
    heroTitle = shortCandidate;
  }

  let heroBody = heroBodyDefault;
  if (styleHint === 'fashion') {
    heroBody =
      locale === 'zh'
        ? '时尚陈列气质 · 清晰货盘 · 一键询盘，面向海外零售与进口商。'
        : 'Fashion-forward presentation, clear assortment, one-tap inquiry — for retailers and importers.';
  }
  if (ref.host) {
    heroBody =
      (locale === 'zh'
        ? `气质参考 ${ref.host}，内容换成你的货盘与询盘路径。`
        : `Inspired by ${ref.host}’s rhythm — your catalog and quote path.`) +
      ' ' +
      heroBody;
  }

  const productCards = inferProducts(raw, productLabels, industry, locale);
  const categories = locale === 'zh' ? industry.catsZh : industry.catsEn;

  return {
    brandName,
    siteTitle: brandName,
    heroTitle: heroTitle.slice(0, 48),
    heroBody: heroBody.slice(0, 180),
    productsTitle: locale === 'zh' ? '精选货盘' : 'Featured line',
    productCards,
    featuresTitle: locale === 'zh' ? '为什么选我们' : 'Why partner with us',
    featuresBody: locale === 'zh' ? industry.trustZh : industry.trustEn,
    aboutTitle: locale === 'zh' ? '关于工厂' : 'About the factory',
    aboutBody: locale === 'zh' ? industry.aboutZh : industry.aboutEn,
    ctaTitle: locale === 'zh' ? '获取报价' : 'Request a quote',
    ctaBody:
      locale === 'zh'
        ? '留下目标市场与数量，我们 24 小时内回复。'
        : 'Share destination market and volume — we reply within 24h.',
    trustLine: locale === 'zh' ? industry.trustZh : industry.trustEn,
    categories,
    locale,
    templateId,
    styleHint,
  };
};

export const plannedCopyToBrief = (plan: PlannedSiteCopy, originalPrompt: string): string => {
  // brief 存结构化摘要，供后续对话改版；不把整段用户指令当页面正文
  return [
    `品牌：${plan.brandName}`,
    `主标题：${plan.heroTitle}`,
    `副文案：${plan.heroBody}`,
    `品类：${plan.categories.join(' / ')}`,
    `产品：${plan.productCards.join(' · ')}`,
    `风格：${plan.styleHint}`,
    `语种：${plan.locale}`,
    `用户意图摘要：${stripMetaInstructions(stripUrls(originalPrompt)).slice(0, 160) || '外贸展厅站'}`,
  ].join('\n');
};
