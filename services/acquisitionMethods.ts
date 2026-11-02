/**
 * 外贸获客方法与高级检索公式库（业务员前台中性文案，不暴露供应商名）
 * 来源：三段式获客闭环 + 21 条公开检索指令，重点支持领英员工定位占位。
 */

export type AcquisitionStageId = 'screen' | 'decide' | 'harvest';

export type AcquisitionStage = {
  id: AcquisitionStageId;
  title: string;
  blurb: string;
  steps: string[];
};

export type SearchFormulaCategory =
  | 'linkedin'
  | 'social'
  | 'amazon'
  | 'local_lang'
  | 'pdf_lists';

export type SearchFormula = {
  id: string;
  category: SearchFormulaCategory;
  title: string;
  /** 可复制的公式模板，含 [占位符] */
  template: string;
  tip: string;
};

export const ACQUISITION_STAGES: AcquisitionStage[] = [
  {
    id: 'screen',
    title: '① 公开目录初筛',
    blurb: '用零成本公开企业与贸易数据，快速建目标市场底盘（公司名、官网、通用电话）。',
    steps: [
      '按目标国 + 产品词筛潜在企业名单',
      '记录公司全称、官网域名、公开电话',
      '剔除无官网或明显同行平台噪声',
    ],
  },
  {
    id: 'decide',
    title: '② 决策人穿透',
    blurb: '锁定目标企业后，先展示采购相关联系人公开信息，再按需补全邮箱 / WhatsApp。',
    steps: [
      '背调后自动补全公司联系人（姓名 / 职位 / 主页等）',
      '在决策人模块先查看已有公开信息',
      '需要邮箱时再手动搜索补全',
    ],
  },
  {
    id: 'harvest',
    title: '③ 高级检索收割',
    blurb: '用排除语法清洗 B2B 平台广告，从社媒、电商卖家与展商 PDF 精准收割买家。',
    steps: [
      '产品词 + 买家身份词 + site 限定 + 排除干扰词',
      '减号排除必须紧贴被排除词（如 -alibaba）',
      'PDF 展商名录可一次批量建档',
    ],
  },
];

export const SEARCH_FORMULAS: SearchFormula[] = [
  {
    id: 'li-1',
    category: 'linkedin',
    title: '领英 · 进口商身份',
    template: '[产品词] importer site:linkedin.com/in',
    tip: '绕过机构主页，锁定真实个人主页。',
  },
  {
    id: 'li-2',
    category: 'linkedin',
    title: '领英 · 分销商身份',
    template: '[产品词] distributor site:linkedin.com/in',
    tip: '适合渠道型买家。',
  },
  {
    id: 'li-3',
    category: 'linkedin',
    title: '领英 · 转售商身份',
    template: '[产品词] reseller site:linkedin.com/in',
    tip: '适合电商与小批发。',
  },
  {
    id: 'li-4',
    category: 'linkedin',
    title: '领英 · 国家 + 采购经理',
    template: '[产品词] importer site:linkedin.com/in "purchasing manager" [国家]',
    tip: '职位词可用 buyer / owner / procurement。',
  },
  {
    id: 'li-5',
    category: 'linkedin',
    title: '领英 · 防干扰完整式',
    template:
      '[产品词] importer site:linkedin.com/in purchasing manager [国家] -alibaba -made-in-china',
    tip: '排除平台噪声；减号紧贴词，中间不要空格。',
  },
  {
    id: 'li-domain',
    category: 'linkedin',
    title: '领英 · 按公司域名找职员',
    template: '[职位] at [公司域名] site:linkedin.com/in',
    tip: '例：buyer at smyk.com site:linkedin.com/in —— 先占位，再挖邮箱。',
  },
  {
    id: 'soc-6',
    category: 'social',
    title: 'Facebook · 带电话商家',
    template: '[产品词] phone site:facebook.com',
    tip: '抓留下公开电话的企业页。',
  },
  {
    id: 'soc-7',
    category: 'social',
    title: 'Instagram · 带 WhatsApp 分销',
    template: '[产品词] distributor whatsapp site:instagram.com',
    tip: '简介里常有 WhatsApp。',
  },
  {
    id: 'soc-8',
    category: 'social',
    title: 'YouTube · 开箱 / 小零售',
    template: '[产品词] business inquiry site:youtube.com',
    tip: '测评博主常兼营零售。',
  },
  {
    id: 'soc-9',
    category: 'social',
    title: 'Pinterest · 贴牌买家',
    template: '[产品词] private label site:pinterest.com',
    tip: '瞄准 OEM / 自有品牌需求。',
  },
  {
    id: 'amz-10',
    category: 'amazon',
    title: '电商 · Sold by 卖家',
    template: '[产品词] site:amazon.com "sold by"',
    tip: '需求已验证，便于换供。',
  },
  {
    id: 'amz-11',
    category: 'amazon',
    title: '电商 · Contact seller',
    template: '[产品词] seller site:amazon.com "contact seller"',
    tip: '调取卖家公开联系入口。',
  },
  {
    id: 'amz-12',
    category: 'amazon',
    title: '电商 · 品牌卖家外联',
    template: '"Amazon seller" OR "Amazon store" [产品词] contact',
    tip: '跨网找品牌官网联系方式。',
  },
  {
    id: 'amz-13',
    category: 'amazon',
    title: '竞品渠道撬取',
    template: '"[竞品品牌]" distributor OR importer -site:[竞品官网]',
    tip: '剔除竞品官网本身。',
  },
  {
    id: 'lang-14',
    category: 'local_lang',
    title: '德语本土',
    template: 'Hersteller OR Lieferant [德语产品词]',
    tip: '母语搜索挖隐形买家。',
  },
  {
    id: 'lang-15',
    category: 'local_lang',
    title: '法语本土',
    template: 'fabricant OR distributeur [法语产品词]',
    tip: '制造商 / 分销商身份词。',
  },
  {
    id: 'lang-16',
    category: 'local_lang',
    title: '日语本土',
    template: '輸入業者 OR 問屋 [日语产品词]',
    tip: '进口商 / 批发商。',
  },
  {
    id: 'lang-17',
    category: 'local_lang',
    title: '葡语巴西',
    template: 'importador [葡语产品词]',
    tip: '如 calçados（鞋类）。',
  },
  {
    id: 'pdf-18',
    category: 'pdf_lists',
    title: 'PDF 展商名录',
    template: 'filetype:pdf exhibitor list [产品词]',
    tip: '一次批量下载展商列表。',
  },
  {
    id: 'pdf-19',
    category: 'pdf_lists',
    title: 'PDF 进口商报告',
    template: 'filetype:pdf market report importer [产品词]',
    tip: '含进口商名单的行业报告。',
  },
  {
    id: 'pdf-20',
    category: 'pdf_lists',
    title: 'PDF 展会目录',
    template: 'filetype:pdf "exhibitor directory" [产品词]',
    tip: '官方 Directory 电子版。',
  },
  {
    id: 'pdf-21',
    category: 'pdf_lists',
    title: 'PDF 买家 / 会员名册',
    template: 'filetype:pdf "buyer list" OR "member directory" [产品词]',
    tip: '协会会员或采购商列表。',
  },
];

export const FORMULA_CATEGORY_LABEL: Record<SearchFormulaCategory, string> = {
  linkedin: '领英定位',
  social: '社媒捞人',
  amazon: '电商 / 竞品',
  local_lang: '母语本土',
  pdf_lists: 'PDF 名录',
};

const PREFERRED_CATS_KEY = 'trade_scout_acq_formula_cats_v1';

/** 营销工具点「平台检索」时写入，客户搜索静默取证优先本组公式 */
export const setPreferredAcquisitionCategories = (
  cats?: SearchFormulaCategory[] | null
): void => {
  try {
    if (!cats?.length) {
      sessionStorage.removeItem(PREFERRED_CATS_KEY);
      return;
    }
    sessionStorage.setItem(PREFERRED_CATS_KEY, JSON.stringify(cats));
  } catch {
    /* ignore */
  }
};

export const consumePreferredAcquisitionCategories = (): SearchFormulaCategory[] | null => {
  try {
    const raw = sessionStorage.getItem(PREFERRED_CATS_KEY);
    sessionStorage.removeItem(PREFERRED_CATS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed.filter((c): c is SearchFormulaCategory =>
      ['linkedin', 'social', 'amazon', 'local_lang', 'pdf_lists'].includes(String(c))
    );
  } catch {
    return null;
  }
};

export const UNIVERSAL_SEARCH_FORMULA =
  '[产品关键词] + [买家身份词/地区词] + [限定指令/排除指令]';

/** 将模板填入变量；未填的占位符保留原文便于提示 */
export const fillSearchFormula = (
  template: string,
  vars: Record<string, string>
): string => {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const val = (v || '').trim();
    if (!val) continue;
    out = out.replace(new RegExp(`\\[${k}\\]`, 'g'), val);
  }
  return out.replace(/\s+/g, ' ').trim();
};

/** @deprecated 前台不再跳外网搜索引擎；仅保留兼容 */
export const googleSearchUrl = (query: string): string =>
  `https://www.google.com/search?q=${encodeURIComponent(query)}`;

/**
 * 把营销工具五类公式填成可执行的公开网页检索式（供客户搜索 / 背调静默取证）。
 * 未填必填占位（如缺公司域名）的公式会跳过。
 */
export const buildAcquisitionFormulaQueries = (opts: {
  productKeyword: string;
  country?: string;
  categories?: SearchFormulaCategory[];
  domain?: string;
  companyName?: string;
  competitorBrand?: string;
  competitorSite?: string;
  limit?: number;
}): string[] => {
  const kw = (opts.productKeyword || '').trim();
  if (!kw) return [];
  const country = (opts.country || '').trim();
  const domain = (opts.domain || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();
  const cats = opts.categories?.length
    ? opts.categories
    : (['linkedin', 'social', 'amazon', 'local_lang', 'pdf_lists'] as SearchFormulaCategory[]);
  const vars: Record<string, string> = {
    产品词: kw,
    国家: country || '',
    职位: 'buyer',
    公司域名: domain || '',
    竞品品牌: (opts.competitorBrand || kw).trim(),
    竞品官网: (opts.competitorSite || 'alibaba.com').trim(),
    德语产品词: kw,
    法语产品词: kw,
    日语产品词: kw,
    葡语产品词: kw,
  };

  const out: string[] = [];
  for (const f of SEARCH_FORMULAS) {
    if (!cats.includes(f.category)) continue;
    // 按域名找职员：无域名则跳过
    if (f.id === 'li-domain' && !domain) continue;
    // 竞品式：无竞品品牌时用产品词顶上，仍可用
    const q = fillSearchFormula(f.template, vars);
    if (!q || /\[[^\]]+\]/.test(q)) continue;
    out.push(q);
  }

  // 公司已知时补几条社媒/主页定位（背调侧）
  const hostOrName = domain || (opts.companyName || '').trim();
  if (hostOrName) {
    out.push(`"${hostOrName}" site:linkedin.com/company`);
    out.push(`"${hostOrName}" site:facebook.com`);
    out.push(`buyer OR purchasing OR procurement at ${domain || hostOrName} site:linkedin.com/in`);
  }

  return [...new Set(out.map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(
    0,
    Math.max(6, Math.min(opts.limit ?? 20, 28))
  );
};

const DEFAULT_LI_TITLES = [
  'purchasing manager',
  'buyer',
  'procurement',
  'owner',
  'import manager',
];

/** 针对单家目标公司：生成领英员工定位检索式（供公开网页检索，非爬取私密页） */
export const buildCompanyLinkedInQueries = (opts: {
  companyName?: string;
  domain?: string;
  productKeyword?: string;
  country?: string;
  titles?: string[];
}): string[] => {
  const domain = (opts.domain || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();
  const name = (opts.companyName || '').trim();
  const product = (opts.productKeyword || '').trim();
  const country = (opts.country || '').trim();
  const titles = opts.titles?.length ? opts.titles : DEFAULT_LI_TITLES;
  const queries: string[] = [];

  // 只按「公司名 / 域名」定位员工；禁止用产品词全球搜采购经理（会串到别的玩具店）
  for (const title of titles.slice(0, 4)) {
    if (domain) {
      queries.push(`"${title}" "${domain}" site:linkedin.com/in`);
      queries.push(`"${title}" at "${domain}" site:linkedin.com/in`);
    }
    if (name) {
      queries.push(`"${title}" "${name}" site:linkedin.com/in`);
      queries.push(`"${title}" at "${name}" site:linkedin.com/in`);
    }
  }

  if (name) {
    queries.push(`"${name}" (purchasing OR buyer OR procurement OR owner OR CEO) site:linkedin.com/in`);
  }
  if (domain) {
    queries.push(`"${domain}" (purchasing OR buyer OR procurement OR owner OR CEO) site:linkedin.com/in`);
  }

  // product/country 仅作弱约束，且必须与公司名同框，避免串公司
  if (product && name) {
    queries.push(`"${name}" "${product}" (buyer OR purchasing) site:linkedin.com/in`);
  }
  if (country && name) {
    queries.push(`"${name}" ${country} (buyer OR purchasing OR owner) site:linkedin.com/in`);
  }

  return [...new Set(queries.map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(
    0,
    8
  );
};
