/**
 * 全球市调专家 + 产品经理双角色编排：
 * 1) 出市场与产品 Brief（指导设计）
 * 2) 匹配国家 / CRM / 背调产品库客户并给专业理由
 * 3) 生成开发信组（单客 + 批量模板）
 */
import type { AnalysisResult, Client, HistoryItem, KnowledgeFile, MailGroup } from '../types';
import { callQwen } from './geminiService';
import {
  buildCompactClientBrief,
  buildCompactOurOfferBrief,
  buildYibingMailGroupPrompt,
  normalizeMailGroupResult,
} from './yibingMailGroup';
import {
  loadProductCatalog,
  matchOurProductToProfiles,
} from './productCatalog';
import {
  newGtmId,
  upsertGtmLaunchPack,
  type GtmClientMatch,
  type GtmLaunchPack,
  type GtmMarketBrief,
  type GtmPmBrief,
} from './gtmExpertStore';
import { peekCreativeHandoff } from './creativeAssetBridge';
import { findSkuByIdOrCode } from './creativeAssetBridge';
import { buildDesignConstraintCard } from './designConstraintCard';
import {
  buildPricingAdvice,
  parsePriceBandNumbers,
  toCnyApprox,
} from './pricingAdvisor';
import { loadTradeJourney } from './tradeJourney';

export type GtmProductInput = {
  productName: string;
  category?: string;
  priceBand?: string;
  skuCode?: string;
  notes?: string;
  /** 设计侧补充（卖点/形态） */
  designNotes?: string;
  /** 设计完成后的包装关键词 */
  packagingHints?: string[];
  /** 设计完成后的配色关键词 */
  colorHints?: string[];
  targetMarket?: string;
};

export type RunGtmLaunchOpts = {
  input: GtmProductInput;
  crmClients: Client[];
  history: HistoryItem[];
  knowledgeBaseFiles?: KnowledgeFile[];
  /** 为前 N 个匹配客户生成专属开发信组（默认 2，0=跳过） */
  mailTopN?: number;
  /** 跳过批量模板信（默认跳过，省一轮模型等待） */
  skipBatchMail?: boolean;
  onProgress?: (pct: number, label: string) => void;
  /** 本地匹配一完成就回调（开发信仍在写），用于先出结果再补信 */
  onPartial?: (pack: GtmLaunchPack) => void;
};

const emptySwot = () => ({
  strengths: [] as string[],
  weaknesses: [] as string[],
  opportunities: [] as string[],
  threats: [] as string[],
});

/** 从 CRM / 历史拼最小背调卡，供开发信用 */
export const clientToAnalysisStub = (
  client: Client,
  history: HistoryItem[]
): AnalysisResult => {
  const domain = (client.website || '')
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0];
  const hit = history.find((h) => {
    const hd = (h.domain || h.data?.companyInfo?.website || '')
      .toLowerCase()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
      .split('/')[0];
    return (
      (domain && hd && domain === hd) ||
      (h.data?.companyInfo?.name || '').toLowerCase() === (client.name || '').toLowerCase()
    );
  });
  if (hit?.data) return hit.data;

  return {
    companyInfo: {
      name: client.name,
      headquarters: client.country || '—',
      foundedYear: '—',
      nature: client.type || '—',
      scale: '—',
      website: client.website || '',
      description: `${client.industry || ''} ${client.productType || ''}`.trim(),
      city: '',
    },
    swot: emptySwot(),
    financialTrends: [],
    trafficAnalysis: [],
    websiteCategories: [],
    businessScope: {
      coreProducts: [client.productType, client.industry].filter(Boolean) as string[],
      relevantProducts: [],
      brandPositioning: '—',
      consumerGroup: '—',
      productVariety: 'Medium',
      priceSensitivity: client.priceRange || '—',
      websiteStructure: '—',
    },
    businessModel: {
      channels: [],
      hasDistributors: false,
      exhibitionHistory: [],
      ecommercePresence: [],
      procurementInfo: '—',
    },
    supplyChain: { role: client.type || '—', serviceType: '—' },
    targetAudience: [],
    financials: { revenueEstimate: '—', paymentTerms: '—', ipInfo: '—' },
    decisionMakers: client.contacts || [],
    searchKeyword: client.searchKeyword,
    searchCountry: client.country,
  } as AnalysisResult;
};

const parseJsonLoose = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  }
};

const DUAL_EXPERT_PROMPT = `你是两位专家的联合工作台（输出必须是严格 JSON，不要 markdown）：
A) 全球玩具/礼品/母婴市调专家
B) 顶级消费产品经理（澄海出口工厂视角）

根据新品信息，给出：
1) market：目标国家/地区（5-8个，priority 1最高）、趋势、风险、对「产品视觉设计」的约束 designImplications（中文短句）
2) pm：定位、买家画像、价值主张、设计必须项 designMustHaves、Listing卖点角度、差异化

禁止出现任何 AI 供应商/模型商品名；国家名可用英文官方名+中文括号。

JSON schema:
{
  "market": {
    "productName": "",
    "categories": ["..."],
    "countries": [{"name":"United Arab Emirates（阿联酋）","priority":1,"reasons":["..."],"channels":["商超","电商"]}],
    "trends": ["..."],
    "risks": ["..."],
    "designImplications": ["..."]
  },
  "pm": {
    "positioning": "...",
    "buyerPersonas": ["..."],
    "valueProps": ["..."],
    "designMustHaves": ["..."],
    "listingAngles": ["..."],
    "competitiveDifferentiation": ["..."]
  }
}`;

const fallbackMarket = (input: GtmProductInput): GtmMarketBrief => ({
  productName: input.productName,
  categories: [input.category || '玩具与游戏'].filter(Boolean),
  countries: [
    {
      name: 'United States（美国）',
      priority: 1,
      reasons: ['线上线下玩具零售成熟', '对新奇特与授权敏感'],
      channels: ['Amazon', 'Specialty'],
    },
    {
      name: 'United Arab Emirates（阿联酋）',
      priority: 2,
      reasons: ['中东分销枢纽', '礼品与玩具进口活跃'],
      channels: ['分销商', '商超'],
    },
    {
      name: 'Germany（德国）',
      priority: 3,
      reasons: ['欧盟合规标杆市场', '品质与安全要求高'],
      channels: ['Fachhandel', '电商'],
    },
    {
      name: 'Poland（波兰）',
      priority: 4,
      reasons: ['中东欧采购跳板', '价格带友好'],
      channels: ['批发', '连锁'],
    },
    {
      name: 'Mexico（墨西哥）',
      priority: 5,
      reasons: ['拉美入口市场', '促销装需求多'],
      channels: ['进口商', 'Club'],
    },
  ],
  trends: ['可持续包装偏好上升', '短视频种草驱动选品', '多件套/礼盒提升客单'],
  risks: ['认证与包装文案合规', '同质化价格战'],
  designImplications: [
    '主图突出玩法与材质，避免杂乱背景',
    '包装预留 CE/年龄标与条码区',
    '色彩按目标国卖场习惯分版',
  ],
});

const fallbackPm = (input: GtmProductInput): GtmPmBrief => ({
  positioning: `${input.productName}：面向进口商/连锁的高周转选品，强调可陈列与可复购`,
  buyerPersonas: ['中东玩具分销商', '欧美精品/礼品买手', '拉美促销装进口商'],
  valueProps: ['工厂直供交期可控', '可 OEM/小改款', '适合货架与社媒展示'],
  designMustHaves: ['清晰主体特写', '1 张场景图', '多角度便于 3D/视频'],
  listingAngles: ['玩法演示', '安全与材质', '礼盒/开窗包装卖点'],
  competitiveDifferentiation: ['结构差异化', '包装可陈列', '价格带清晰'],
});

/** 双专家 Brief（市调 + 产品经理） */
export const planGtmExpertBriefs = async (
  input: GtmProductInput
): Promise<{ market: GtmMarketBrief; pm: GtmPmBrief }> => {
  const fbM = fallbackMarket(input);
  const fbP = fallbackPm(input);
  const user = [
    `productName: ${input.productName}`,
    `category: ${input.category || ''}`,
    `priceBand: ${input.priceBand || ''}`,
    `skuCode: ${input.skuCode || ''}`,
    `notes: ${input.notes || ''}`,
    `designNotes: ${input.designNotes || ''}`,
  ].join('\n');

  try {
    const raw = await callQwen(`${DUAL_EXPERT_PROMPT}\n\n---\n${user}`, {
      jsonMode: true,
      timeoutMs: 45_000,
      maxTokens: 2048,
      enableSearch: false,
      forcedSearch: false,
    });
    const parsed = parseJsonLoose<{ market?: GtmMarketBrief; pm?: GtmPmBrief }>(raw);
    if (!parsed?.market || !parsed?.pm) return { market: fbM, pm: fbP };
    return {
      market: {
        ...fbM,
        ...parsed.market,
        productName: parsed.market.productName || input.productName,
        countries: Array.isArray(parsed.market.countries) && parsed.market.countries.length
          ? parsed.market.countries
          : fbM.countries,
      },
      pm: { ...fbP, ...parsed.pm },
    };
  } catch {
    return { market: fbM, pm: fbP };
  }
};

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenOverlap = (a: string, b: string): number => {
  const ta = new Set(norm(a).split(' ').filter((t) => t.length > 1));
  const tb = new Set(norm(b).split(' ').filter((t) => t.length > 1));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  ta.forEach((t) => {
    if (tb.has(t)) hit += 1;
  });
  return hit / Math.max(ta.size, 1);
};

/**
 * CRM 仅作「已背调客户」的联系人挂接，不凭空编匹配理由。
 * 必须有产品库命中，或 CRM 标签里已有背调写入的「在售:/采购:」真标签。
 */
export const matchCrmClientsForProduct = (
  input: GtmProductInput,
  market: GtmMarketBrief,
  crmClients: Client[]
): GtmClientMatch[] => {
  const cat = norm(input.category || market.categories.join(' '));
  const name = norm(input.productName);
  const countryPool = market.countries.map((c) => norm(c.name)).filter(Boolean);

  const scored: GtmClientMatch[] = [];
  for (const c of crmClients) {
    const tags = c.tags || [];
    const realTagBlob = tags
      .filter((t) => /^(在售|采购|关键词):/i.test(t) || tags.length > 0)
      .join(' ');
    // 无背调产品标签且无产品类型 → 跳过（避免纯公司名瞎配）
    const hasRealProductSignal =
      tags.some((t) => /^(在售|采购):/.test(t)) ||
      (!!c.productType && c.productType !== 'N/A' && (c.hasBackgroundCheck || c.hasAnalyzed));
    if (!hasRealProductSignal) continue;

    const reasons: string[] = [];
    let score = 0;
    const blob = norm([c.productType, c.industry, c.searchKeyword, realTagBlob].join(' '));
    const ovName = tokenOverlap(name, blob);
    const ovCat = cat ? tokenOverlap(cat, blob) : 0;

    const sellTags = tags.filter((t) => t.startsWith('在售:')).map((t) => t.slice(3));
    const procureTags = tags.filter((t) => t.startsWith('采购:')).map((t) => t.slice(3));
    for (const t of procureTags) {
      if (cat && (norm(t).includes(cat) || cat.includes(norm(t)) || tokenOverlap(name, t) > 0.2)) {
        score += 40;
        reasons.push(`CRM 背调标签·采购品类「${t}」`);
        break;
      }
    }
    for (const t of sellTags) {
      if (cat && (norm(t).includes(cat) || cat.includes(norm(t)) || tokenOverlap(name, t) > 0.2)) {
        score += reasons.some((r) => r.includes('采购')) ? 14 : 36;
        reasons.push(`CRM 背调标签·在售品类「${t}」`);
        break;
      }
    }

    if (!reasons.length && ovCat >= 0.2) {
      score += Math.round(22 * Math.min(1, ovCat * 2));
      reasons.push(`CRM 已背调产品类型「${c.productType}」与新品品类重合`);
    }
    if (!reasons.length && ovName >= 0.25) {
      score += Math.round(18 * Math.min(1, ovName * 2));
      reasons.push(`CRM 背调关键词/标签与新品名称重合`);
    }
    if (!reasons.length) continue;

    const cCountry = norm(c.country);
    const countryHit = countryPool.some(
      (pc) => cCountry && (pc.includes(cCountry) || cCountry.includes(pc.split(' ')[0] || ''))
    );
    if (countryHit) {
      score += 12;
      reasons.push(`位于市调优先市场：${c.country}`);
    }
    if (c.status === '已成交' || c.status === '谈判中' || c.status === '已寄样') {
      score += 8;
      reasons.push(`漏斗「${c.status}」`);
    }
    if (score < 30) continue;
    scored.push({
      clientId: c.id,
      companyName: c.name,
      country: c.country,
      website: c.website,
      score: Math.min(99, score),
      reasons,
      source: 'crm',
      productType: c.productType,
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 40);
};

const mergeMatches = (
  crmHits: GtmClientMatch[],
  profileHits: GtmClientMatch[]
): GtmClientMatch[] => {
  const map = new Map<string, GtmClientMatch>();
  const keyOf = (m: GtmClientMatch) =>
    (m.website || m.companyName || '').toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '');

  for (const m of [...profileHits, ...crmHits]) {
    const k = keyOf(m) || m.clientId || m.companyName;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, m);
      continue;
    }
    map.set(k, {
      ...prev,
      ...m,
      score: Math.min(99, Math.max(prev.score, m.score) + (prev.source !== m.source ? 6 : 0)),
      reasons: [...new Set([...prev.reasons, ...m.reasons])].slice(0, 6),
      source: prev.source !== m.source ? 'both' : m.source,
      clientId: m.clientId || prev.clientId,
      historyId: m.historyId || prev.historyId,
    });
  }
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, 25);
};

export const generateOutreachMailGroup = async (opts: {
  clientBrief: string;
  offerBrief: string;
  batch?: boolean;
  batchContext?: string;
}): Promise<MailGroup> => {
  const prompt = buildYibingMailGroupPrompt({
    mode: opts.batch ? 'batch' : 'single',
    clientBrief: opts.clientBrief,
    offerBrief: opts.offerBrief,
    batchContext: opts.batchContext,
  });
  const raw = await callQwen(prompt, {
    jsonMode: true,
    timeoutMs: 50_000,
    maxTokens: 1800,
    enableSearch: false,
    forcedSearch: false,
  });
  const parsed = parseJsonLoose<Record<string, unknown>>(raw) || {};
  return normalizeMailGroupResult(parsed);
};

/**
 * 一键：双专家 Brief → 国家/客户匹配 → 开发信组
 * 体验优化：Brief 与画像并行；匹配先出结果；开发信并行撰写。
 */
export const runGtmLaunchPack = async (opts: RunGtmLaunchOpts): Promise<GtmLaunchPack> => {
  const { input, crmClients, history, onProgress, onPartial } = opts;
  const mailTopN = opts.mailTopN ?? 2;
  const skipBatchMail = opts.skipBatchMail !== false;

  onProgress?.(6, '并行：专家编排 + 加载画像库…');
  const [briefs, profiles] = await Promise.all([
    planGtmExpertBriefs(input),
    loadProductCatalog(),
  ]);
  const { market, pm } = briefs;
  onProgress?.(32, '正在按库内真数据匹配客户…');

  // 只用背调入库的真实产品画像；质量优先截断，避免 2k+ 全量慢扫
  const usableProfiles = profiles
    .filter(
      (p) =>
        (p.catalogQuality ?? 0) >= 8 &&
        ((p.skus || []).length > 0 ||
          (p.categories || []).length > 0 ||
          (p.sellCategories || []).length > 0 ||
          (p.procureCategories || []).length > 0)
    )
    .sort((a, b) => (b.catalogQuality || 0) - (a.catalogQuality || 0))
    .slice(0, 700);

  const categoryForMatch = input.category || market.categories[0] || input.productName;
  const parsedBand = parsePriceBandNumbers(input.priceBand);
  const cnyBand = toCnyApprox(parsedBand.lo, parsedBand.hi, parsedBand.currencyHint);
  const noteBlob = [input.notes, input.designNotes].filter(Boolean).join(' ');
  const packHints =
    input.packagingHints?.length
      ? input.packagingHints
      : noteBlob
        ? noteBlob.split(/[,，、/\s]+/).filter((t) => /盒|袋|吸塑|礼盒|窗|彩盒|blister|box|bag/i.test(t))
        : [];
  const colorHints =
    input.colorHints?.length
      ? input.colorHints
      : noteBlob
        ? noteBlob.split(/[,，、/\s]+/).filter((t) => /色|红|蓝|绿|粉|黑|白|金|银|彩|color|pink|blue|red/i.test(t))
        : [];

  const sku = input.skuCode ? findSkuByIdOrCode(input.skuCode) : undefined;
  const ourFactoryCny =
    sku?.factoryPrice != null && sku.factoryPrice > 0
      ? sku.currency === 'USD'
        ? sku.factoryPrice * 7.2
        : sku.currency === 'EUR'
          ? sku.factoryPrice * 7.8
          : sku.factoryPrice
      : cnyBand
        ? (cnyBand.min + cnyBand.max) / 2
        : undefined;

  const journey = loadTradeJourney();
  const designCard = buildDesignConstraintCard({
    categoryOrName: categoryForMatch,
    targetMarket:
      input.targetMarket ||
      market.countries[0]?.name ||
      journey.targetMarket ||
      undefined,
    profiles: usableProfiles,
    ourFactoryCny,
    priceBandText: input.priceBand,
  });
  const pricingAdvice = buildPricingAdvice({
    category: categoryForMatch,
    profiles: usableProfiles,
    ourFactoryCny,
    priceBandText: input.priceBand,
  });

  const profileRaw = matchOurProductToProfiles(
    {
      name: input.productName,
      category: categoryForMatch,
      countries: market.countries.slice(0, 5).map((c) => c.name),
      priceMinCny: cnyBand?.min,
      priceMaxCny: cnyBand?.max,
      packagingHints: packHints.length ? packHints : designCard.packagingStyles.slice(0, 4),
      colorHints: colorHints.length ? colorHints : designCard.colorPalettes.slice(0, 4),
      notes: noteBlob || undefined,
    },
    usableProfiles
  ).map(
    (h): GtmClientMatch => ({
      clientId: h.profile.crmClientId,
      companyName: h.profile.companyName,
      country: h.profile.country || '—',
      website: h.profile.website,
      score: h.score,
      reasons: h.reasons,
      source: 'product_profile',
      historyId: h.profile.historyId,
      productType: [
        ...(h.matchedCategories || []).slice(0, 2),
        ...(h.profile.procureCategories || []).slice(0, 1),
      ]
        .filter(Boolean)
        .join(' / '),
    })
  );

  const crmHits = matchCrmClientsForProduct(input, market, crmClients);
  let matches = mergeMatches(crmHits, profileRaw);

  const countryBoost = new Set(market.countries.map((c) => norm(c.name).slice(0, 12)));
  matches = matches
    .map((m) => {
      const cn = norm(m.country);
      if ([...countryBoost].some((b) => b && (cn.includes(b.slice(0, 6)) || b.includes(cn.slice(0, 6))))) {
        return {
          ...m,
          score: Math.min(99, m.score + 5),
          reasons: m.reasons.includes('落在市调优先国家')
            ? m.reasons
            : [...m.reasons, '落在市调优先国家'],
        };
      }
      return m;
    })
    .sort((a, b) => b.score - a.score);

  const offerBrief = buildCompactOurOfferBrief(
    '',
    [
      input.productName,
      input.category,
      input.priceBand,
      pm.positioning,
      pm.valueProps.slice(0, 3).join('; '),
      input.notes,
    ]
      .filter(Boolean)
      .join(' | ')
  );

  const packId = newGtmId();
  const packBase: GtmLaunchPack = {
    id: packId,
    createdAt: Date.now(),
    productName: input.productName,
    category: input.category,
    priceBand: input.priceBand,
    skuCode: input.skuCode,
    notes: input.notes,
    market,
    pm,
    matches,
    designCard,
    pricingAdvice,
  };
  upsertGtmLaunchPack(packBase);
  onPartial?.(packBase);
  onProgress?.(52, `已匹配 ${matches.length} 家，正在并行写开发信…`);
  // 让出主线程，先把匹配结果画到界面
  await new Promise<void>((r) => setTimeout(r, 0));

  const top = matches.slice(0, Math.max(0, mailTopN));
  const mailTasks: Array<Promise<void>> = [];

  if (!skipBatchMail) {
    mailTasks.push(
      (async () => {
        try {
          packBase.batchMailGroup = await generateOutreachMailGroup({
            batch: true,
            batchContext: `Product launch: ${input.productName}. Priority markets: ${market.countries
              .slice(0, 4)
              .map((c) => c.name)
              .join(', ')}`,
            clientBrief: `Segment: ${pm.buyerPersonas.slice(0, 3).join(' / ')}\nMarkets: ${market.countries
              .slice(0, 5)
              .map((c) => c.name)
              .join(', ')}`,
            offerBrief,
          });
        } catch {
          /* 批量模板失败不阻断 */
        }
      })()
    );
  }

  // 域名索引：避免每封信都在 2k+ 历史上线性扫描
  const historyByHost = new Map<string, HistoryItem>();
  for (const h of history) {
    const hd = (h.domain || h.data?.companyInfo?.website || '')
      .toLowerCase()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
      .split('/')[0];
    if (hd && !historyByHost.has(hd)) historyByHost.set(hd, h);
  }
  const stubFromClient = (client: Client): AnalysisResult => {
    const domain = (client.website || '')
      .toLowerCase()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
      .split('/')[0];
    const hit = (domain && historyByHost.get(domain)) || undefined;
    if (hit?.data) return hit.data;
    return clientToAnalysisStub(client, []);
  };

  for (let i = 0; i < top.length; i++) {
    const m = top[i];
    const idx = i;
    mailTasks.push(
      (async () => {
        onProgress?.(
          55 + Math.round(((idx + 1) / Math.max(top.length, 1)) * 35),
          `开发信：${m.companyName}`
        );
        try {
          const client = crmClients.find((c) => c.id === m.clientId);
          const analysis = client
            ? stubFromClient(client)
            : ({
                companyInfo: {
                  name: m.companyName,
                  headquarters: m.country,
                  foundedYear: '—',
                  nature: '—',
                  scale: '—',
                  website: m.website || '',
                  description: m.productType || '',
                },
                businessScope: {
                  coreProducts: (m.productType || '')
                    .split(/[/、,]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  relevantProducts: [],
                  brandPositioning: '—',
                  consumerGroup: '—',
                  productVariety: 'Medium',
                  priceSensitivity: '—',
                  websiteStructure: '—',
                },
                swot: emptySwot(),
                searchCountry: m.country,
              } as AnalysisResult);
          m.mailGroup = await generateOutreachMailGroup({
            clientBrief: buildCompactClientBrief(analysis),
            offerBrief,
          });
        } catch {
          /* 单客失败跳过 */
        }
      })()
    );
  }

  if (mailTasks.length) {
    await Promise.all(mailTasks);
  }

  onProgress?.(96, '归档投放包…');
  upsertGtmLaunchPack(packBase);
  onProgress?.(100, '完成');
  return packBase;
};

/** 从创作交接 / SKU 预填新品输入 */
export const suggestGtmInputFromCreative = (): Partial<GtmProductInput> => {
  const handoff = peekCreativeHandoff();
  if (handoff?.skuCode) {
    const sku = findSkuByIdOrCode(handoff.skuCode);
    const pack = (sku?.packing || '').trim();
    const colors = (sku?.colors || '').trim();
    return {
      productName: handoff.skuName || sku?.name || handoff.skuCode,
      skuCode: handoff.skuCode,
      category: sku?.category,
      notes: [handoff.note, pack && `包装:${pack}`, colors && `配色:${colors}`]
        .filter(Boolean)
        .join('；'),
      designNotes: handoff.note,
      packagingHints: pack ? [pack] : undefined,
      colorHints: colors ? colors.split(/[,，、/]+/).map((s) => s.trim()).filter(Boolean) : undefined,
      priceBand:
        sku?.factoryPrice != null
          ? `${sku.currency || 'USD'} ${sku.factoryPrice}`
          : undefined,
    };
  }
  if (handoff?.skuName) {
    return { productName: handoff.skuName, notes: handoff.note, designNotes: handoff.note };
  }
  return {};
};
