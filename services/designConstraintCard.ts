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
  confidence: PricingConfidence;
  confidenceScore: number;
  topCustomers: Array<{ name: string; country?: string; website?: string }>;
  pricing?: PricingAdvice;
  /** 规则适市补充（无库内数据时兜底） */
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
  if (packagingStyles.length) {
    designHints.push(`优先包装形态：${packagingStyles.slice(0, 3).join('、')}`);
  } else if (fit.packaging[0]) {
    designHints.push(fit.packaging[0]);
  }
  if (colorPalettes.length) {
    designHints.push(`主配色参考：${colorPalettes.slice(0, 4).join('、')}`);
  } else if (colorPreference) {
    designHints.push(`配色偏好：${colorPreference.slice(0, 80)}`);
  }
  if (pricing.suggestedFactory) {
    designHints.push(
      `出厂价参考 ¥${pricing.suggestedFactory.min}–${pricing.suggestedFactory.max}（置信${pricing.confidence}）`
    );
  }
  if (typicalMoq) designHints.push(`起订量线索：${typicalMoq}`);
  if (buyingSeasons) designHints.push(`旺季/周期：${buyingSeasons}`);
  if (!designHints.length) {
    designHints.push(...fit.highlights.slice(0, 2));
  }

  let confidenceScore = Math.min(90, 15 + sampleSize * 10 + withSignals.length * 8);
  if (packagingStyles.length) confidenceScore += 8;
  if (colorPalettes.length) confidenceScore += 8;
  if (buyCost || retail) confidenceScore += 10;
  confidenceScore = Math.max(8, Math.min(95, Math.round(confidenceScore)));
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
    designHints: designHints.slice(0, 6),
    confidence,
    confidenceScore,
    topCustomers,
    pricing,
    marketFitPackaging: fit.packaging.slice(0, 3),
    marketFitFeatures: fit.features.slice(0, 3),
  };
};

/** 约束卡 → 设计备注短文本（可写入 notes / prompt） */
export const designConstraintToPromptNote = (card: DesignConstraintCard): string => {
  const parts = [
    `【适市约束·${card.market}·${card.category}】`,
    card.designHints.join('；'),
    card.packagingStyles.length ? `包装:${card.packagingStyles.slice(0, 3).join('/')}` : '',
    card.colorPalettes.length ? `配色:${card.colorPalettes.slice(0, 4).join('/')}` : '',
    card.pricing?.suggestedFactory
      ? `出厂参考¥${card.pricing.suggestedFactory.min}-${card.pricing.suggestedFactory.max}`
      : '',
  ].filter(Boolean);
  return parts.join(' ').slice(0, 400);
};
