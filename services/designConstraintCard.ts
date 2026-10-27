/**
 * 设计前约束卡：从客户产品画像聚合包装/配色/价带/周期，供平面/包装设计参考。
 */
import type { CustomerProductProfile } from '../types';
import { normalizeCategoryLabel, profileHasDesignSignals } from './productCatalog';
import {
  aggregateMarketPriceBands,
  buildPricingAdvice,
  type PricingAdvice,
  type PricingConfidence,
} from './pricingAdvisor';
import { buildMarketFitAdvice } from './marketFitAdvice';

export type DesignConstraintCard = {
  category: string;
  market: string;
  sampleSize: number;
  designReadyCount: number;
  packagingStyles: string[];
  colorPalettes: string[];
  packagingSummary?: string;
  colorPreference?: string;
  retailBandLabel?: string;
  buyCostBandLabel?: string;
  typicalMoq?: string;
  buyingSeasons?: string;
  procurementHints: string[];
  designHints: string[];
  /** 库内观察 vs 行业通则兜底 */
  hintSources: Array<'library' | 'industry_heuristic'>;
  confidence: PricingConfidence;
  confidenceScore: number;
  topCustomers: Array<{ name: string; country?: string; website?: string }>;
  pricing?: PricingAdvice;
  /** 规则适市补充（无库内数据时兜底；置信须下调） */
  marketFitPackaging: string[];
  marketFitFeatures: string[];
};

const rankFreq = (items: string[], max = 8): string[] => {
  const map = new Map<string, number>();
  for (const raw of items) {
    const t = (raw || '').trim();
    if (!t || t.length > 40) continue;
    map.set(t, (map.get(t) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([k]) => k);
};

const profileMatches = (p: CustomerProductProfile, category: string, market?: string): boolean => {
  const cat = normalizeCategoryLabel(category) || category;
  if (cat) {
    const pool = [
      ...(p.categories || []),
      ...(p.sellCategories || []),
      ...(p.procureCategories || []),
      ...(p.importCategories || []),
      ...(p.productTags || []),
    ];
    const nCat = cat.toLowerCase();
    const hit = pool.some((c) => {
      const nc = (normalizeCategoryLabel(c) || c).toLowerCase();
      return nc === nCat || nc.includes(nCat) || nCat.includes(nc);
    });
    if (!hit) return false;
  }
  if (market) {
    const m = market.toLowerCase();
    const pc = (p.country || '').toLowerCase();
    if (pc && m.length >= 2) {
      // 弱过滤：有国家且明显不相关则跳过；「全球」不过滤
      if (!/全球|国际|worldwide|global/i.test(market)) {
        const tokens = m.split(/[\s,/，、]+/).filter((t) => t.length >= 2);
        if (tokens.length && !tokens.some((t) => pc.includes(t) || t.includes(pc.slice(0, 4)))) {
          // 国家对不上仍保留（品类命中优先），不强制剔除
        }
      }
    }
  }
  return true;
};

export const buildDesignConstraintCard = (opts: {
  categoryOrName: string;
  targetMarket?: string;
  profiles: CustomerProductProfile[];
  ourFactoryCny?: number;
  priceBandText?: string;
}): DesignConstraintCard => {
  const category = (opts.categoryOrName || '').trim() || '玩具';
  const market = (opts.targetMarket || '').trim() || '目标市场';
  const matched = opts.profiles.filter((p) => profileMatches(p, category, market));
  const withSignals = matched.filter((p) => profileHasDesignSignals(p));
  const pool = withSignals.length ? withSignals : matched;

  const packagingStyles = rankFreq(pool.flatMap((p) => p.packagingStyles || []));
  const colorPalettes = rankFreq(pool.flatMap((p) => p.colorPalettes || []));
  const packagingSummary = pool
    .map((p) => p.packagingSummary)
    .find((s) => s && s.length > 4);
  const colorPreference = pool.map((p) => p.colorPreference).find((s) => s && s.length > 4);
  const typicalMoq = pool.map((p) => p.typicalMoq).find((s) => s && s.length > 1);
  const buyingSeasons = pool.map((p) => p.buyingSeasons).find((s) => s && s.length > 1);
  const procurementHints = rankFreq(
    pool
      .map((p) => p.procurementCycle || '')
      .filter(Boolean)
      .flatMap((s) => s.split(/[·|;；]/).map((x) => x.trim())),
    5
  );

  const { retail, buyCost, sampleSize } = aggregateMarketPriceBands(pool, category);
  const pricing = buildPricingAdvice({
    category,
    profiles: pool,
    ourFactoryCny: opts.ourFactoryCny,
    priceBandText: opts.priceBandText,
  });

  const fit = buildMarketFitAdvice({ categoryOrName: category, targetMarket: market });

  const designHints: string[] = [];
  const hintSources: Array<'library' | 'industry_heuristic'> = [];
  if (packagingStyles.length) {
    designHints.push(`【库内观察】优先包装：${packagingStyles.slice(0, 3).join('、')}`);
    hintSources.push('library');
  } else if (fit.packaging[0]) {
    designHints.push(`【行业通则·待验证】${fit.packaging[0]}`);
    hintSources.push('industry_heuristic');
  }
  if (colorPalettes.length) {
    designHints.push(`【库内观察】主配色：${colorPalettes.slice(0, 4).join('、')}`);
    hintSources.push('library');
  } else if (colorPreference) {
    designHints.push(`【库内摘要】配色：${colorPreference.slice(0, 80)}`);
    hintSources.push('library');
  }
  if (pricing.suggestedFactory && pricing.evidenceTier !== 'insufficient') {
    designHints.push(
      `【定价·${pricing.evidenceTier}】出厂 ¥${pricing.suggestedFactory.min}–${pricing.suggestedFactory.max}（置信${pricing.confidence}）`
    );
    hintSources.push(pricing.evidenceTier === 'observed' ? 'library' : 'industry_heuristic');
  } else {
    designHints.push('【定价】证据不足，暂不给出建议出厂价');
  }
  if (typicalMoq && !/公开信息未找到/i.test(typicalMoq)) {
    designHints.push(`【库内】起订量：${typicalMoq}`);
    hintSources.push('library');
  }
  if (buyingSeasons && !/公开信息未找到/i.test(buyingSeasons)) {
    designHints.push(`【库内】旺季/周期：${buyingSeasons}`);
    hintSources.push('library');
  }
  if (!designHints.some((h) => h.includes('库内'))) {
    designHints.push(...fit.highlights.slice(0, 2).map((h) => `【行业通则·待验证】${h}`));
    hintSources.push('industry_heuristic');
  }

  // 置信：库内信号主导；纯行业通则封顶「低/中」
  let confidenceScore = pricing.confidenceScore || 20;
  confidenceScore = Math.round(
    confidenceScore * 0.55 +
      Math.min(35, withSignals.length * 6) +
      (packagingStyles.length ? 8 : 0) +
      (colorPalettes.length ? 8 : 0)
  );
  if (!hintSources.includes('library')) {
    confidenceScore = Math.min(confidenceScore, 38);
  }
  confidenceScore = Math.max(8, Math.min(92, confidenceScore));
  const confidence: PricingConfidence =
    confidenceScore >= 65 ? '高' : confidenceScore >= 40 ? '中' : '低';

  const topCustomers = pool
    .slice()
    .sort((a, b) => (b.designSignalQuality || 0) - (a.designSignalQuality || 0))
    .slice(0, 5)
    .map((p) => ({
      name: p.companyName,
      country: p.country,
      website: p.website,
    }));

  return {
    category,
    market,
    sampleSize: pool.length,
    designReadyCount: withSignals.length,
    packagingStyles,
    colorPalettes,
    packagingSummary,
    colorPreference,
    retailBandLabel: retail ? `¥${retail.min}–${retail.max}` : undefined,
    buyCostBandLabel: buyCost ? `¥${buyCost.min}–${buyCost.max}` : undefined,
    typicalMoq,
    buyingSeasons,
    procurementHints,
    designHints: designHints.slice(0, 7),
    hintSources: [...new Set(hintSources)],
    confidence,
    confidenceScore,
    topCustomers,
    pricing,
    marketFitPackaging: fit.packaging.slice(0, 3),
    marketFitFeatures: fit.features.slice(0, 3),
  };
};

/** 约束卡 → 设计备注短文本（可写入 notes / prompt）；无证据不强塞价 */
export const designConstraintToPromptNote = (card: DesignConstraintCard): string => {
  const priceBit =
    card.pricing?.suggestedFactory && card.pricing.evidenceTier !== 'insufficient'
      ? `出厂参考¥${card.pricing.suggestedFactory.min}-${card.pricing.suggestedFactory.max}(${card.pricing.evidenceTier})`
      : '定价证据不足勿臆造价签';
  const parts = [
    `【适市约束·${card.market}·${card.category}·置信${card.confidence}】`,
    card.designHints.filter((h) => h.includes('库内')).join('；') ||
      card.designHints.slice(0, 2).join('；'),
    card.packagingStyles.length ? `包装:${card.packagingStyles.slice(0, 3).join('/')}` : '',
    card.colorPalettes.length ? `配色:${card.colorPalettes.slice(0, 4).join('/')}` : '',
    priceBit,
  ].filter(Boolean);
  return parts.join(' ').slice(0, 420);
};
