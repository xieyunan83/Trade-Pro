/**
 * 定价参考（证据优先）：库内观察价 → 权威公式推导 → 声明假设。
 * 无观察数据时宁可「证据不足」，禁止编造价。
 */
import type { CustomerProductProfile } from '../types';
import { normalizeCategoryLabel } from './productCatalog';
import {
  convertToCny,
  factoryBandFromObservedBuyCost,
  factoryBandFromRetail,
  factoryBandFromRetailLandedLadder,
  FX_REF_TO_CNY,
  marginRate,
  parsePriceBandNumbers,
  pickChannelProfile,
  robustBandFromValues,
  round2,
  scoreEvidenceConfidence,
  type EvidenceTier,
} from './tradePricingTheory';

export type PriceBandCny = { min: number; max: number };

export type PricingConfidence = '高' | '中' | '低';

export type PricingVerdict =
  | '偏低可冲量'
  | '落在可成交带'
  | '偏贵需减配或改包装'
  | '证据不足';

export type PricingAdvice = {
  category: string;
  sampleSize: number;
  marketRetail?: PriceBandCny;
  marketBuyCost?: PriceBandCny;
  suggestedFactory?: PriceBandCny;
  ourFactoryCny?: number;
  verdict: PricingVerdict;
  confidence: PricingConfidence;
  confidenceScore: number;
  /** observed | derived | assumed | insufficient */
  evidenceTier: EvidenceTier;
  /** 使用的公式说明（可审计） */
  formulaUsed?: string;
  reasons: string[];
  assumptions: string[];
};

export { parsePriceBandNumbers };

const profileMatchesCategory = (p: CustomerProductProfile, category: string): boolean => {
  const cat = normalizeCategoryLabel(category) || category;
  if (!cat) return true;
  const pool = [
    ...(p.categories || []),
    ...(p.sellCategories || []),
    ...(p.procureCategories || []),
    ...(p.importCategories || []),
  ];
  const nCat = cat.toLowerCase();
  return pool.some((c) => {
    const nc = (normalizeCategoryLabel(c) || c).toLowerCase();
    return nc === nCat || nc.includes(nCat) || nCat.includes(nc);
  });
};

export const aggregateMarketPriceBands = (
  profiles: CustomerProductProfile[],
  category: string
): {
  retail?: PriceBandCny;
  buyCost?: PriceBandCny;
  sampleSize: number;
  retailMethod?: string;
  buyMethod?: string;
} => {
  const matched = profiles.filter((p) => profileMatchesCategory(p, category));
  const retailVals: number[] = [];
  const buyVals: number[] = [];
  for (const p of matched) {
    if (p.priceMinCny != null && p.priceMinCny > 0) retailVals.push(p.priceMinCny);
    if (p.priceMaxCny != null && p.priceMaxCny > 0) retailVals.push(p.priceMaxCny);
    if (p.buyCostMinCny != null && p.buyCostMinCny > 0) buyVals.push(p.buyCostMinCny);
    if (p.buyCostMaxCny != null && p.buyCostMaxCny > 0) buyVals.push(p.buyCostMaxCny);
    for (const s of p.skus || []) {
      if (s.retailPriceCNY != null && s.retailPriceCNY > 0) retailVals.push(s.retailPriceCNY);
      if (s.estimatedFOBPriceCNY != null && s.estimatedFOBPriceCNY > 0) {
        buyVals.push(s.estimatedFOBPriceCNY);
      }
    }
  }
  const retailBand = robustBandFromValues(retailVals);
  const buyBand = robustBandFromValues(buyVals);
  const sampleSize = matched.filter(
    (p) =>
      p.priceMinCny != null ||
      p.priceMaxCny != null ||
      p.buyCostMinCny != null ||
      p.buyCostMaxCny != null ||
      (p.skus || []).some((s) => (s.retailPriceCNY || 0) > 0 || (s.estimatedFOBPriceCNY || 0) > 0)
  ).length;

  return {
    retail: retailBand ? { min: retailBand.min, max: retailBand.max } : undefined,
    buyCost: buyBand ? { min: buyBand.min, max: buyBand.max } : undefined,
    sampleSize,
    retailMethod: retailBand?.method,
    buyMethod: buyBand?.method,
  };
};

export const toCnyApprox = (
  lo?: number,
  hi?: number,
  currencyHint?: string
): PriceBandCny | undefined => {
  if (lo == null && hi == null) return undefined;
  const cur = currencyHint || 'CNY';
  const a = convertToCny(lo ?? hi!, cur);
  const b = convertToCny(hi ?? lo!, cur);
  return { min: Math.min(a.cny, b.cny), max: Math.max(a.cny, b.cny) };
};

/**
 * 建议出厂价：观察采购优先 → Keystone 渠道毛利反推 → 拒绝无证据臆造。
 */
export const buildPricingAdvice = (opts: {
  category: string;
  profiles: CustomerProductProfile[];
  ourFactoryCny?: number;
  priceBandText?: string;
  channelHint?: string;
}): PricingAdvice => {
  const category = (opts.category || '').trim() || '未指定品类';
  const channel = pickChannelProfile(opts.channelHint || category);
  const agg = aggregateMarketPriceBands(opts.profiles, category);
  const { retail, buyCost, sampleSize } = agg;

  const parsed = parsePriceBandNumbers(opts.priceBandText);
  let usedAssumedFx = false;
  let userBand: PriceBandCny | undefined;
  if (parsed.lo != null || parsed.hi != null) {
    const cur = parsed.currencyHint || 'CNY';
    if (cur !== 'CNY') usedAssumedFx = true;
    userBand = toCnyApprox(parsed.lo, parsed.hi, cur);
  }

  const ourFactoryCny =
    opts.ourFactoryCny != null && opts.ourFactoryCny > 0
      ? opts.ourFactoryCny
      : userBand
        ? (userBand.min + userBand.max) / 2
        : undefined;

  const assumptions: string[] = [];
  const reasons: string[] = [];
  let suggestedFactory: PriceBandCny | undefined;
  let evidenceTier: EvidenceTier = 'insufficient';
  let formulaUsed: string | undefined;
  let usedLandedLadder = false;

  if (buyCost) {
    const band = factoryBandFromObservedBuyCost(buyCost.min, buyCost.max);
    suggestedFactory = { min: band.min, max: band.max };
    evidenceTier = band.tier;
    formulaUsed = band.formula;
    assumptions.push(band.formula);
    if (agg.buyMethod) assumptions.push(`采购样本聚合：${agg.buyMethod}`);
  } else if (retail) {
    const keystone = factoryBandFromRetail(retail.min, retail.max, channel);
    const ladder = factoryBandFromRetailLandedLadder(retail.min, retail.max, channel);
    suggestedFactory = { min: keystone.min, max: keystone.max };
    evidenceTier = 'derived';
    formulaUsed = keystone.formula;
    assumptions.push(keystone.formula);
    assumptions.push(
      `交叉校验（规划阶梯，未并入建议带）：¥${ladder.min}–${ladder.max}；${ladder.formula}`
    );
    if (agg.retailMethod) assumptions.push(`零售样本聚合：${agg.retailMethod}`);
    usedLandedLadder = true;
  } else {
    assumptions.push('库内无该品类观察零售/采购价，拒绝臆造建议出厂价');
  }

  if (usedAssumedFx) {
    const fxKey = (parsed.currencyHint || 'USD').toUpperCase();
    assumptions.push(FX_REF_TO_CNY[fxKey]?.note || '外币按参考中间价折算');
  }

  let conf = scoreEvidenceConfidence({
    tier: evidenceTier,
    sampleSize,
    hasObservedBuy: !!buyCost,
    hasObservedRetail: !!retail,
    usedAssumedFx,
    usedLandedLadder: usedLandedLadder && !buyCost,
  });

  let verdict: PricingVerdict = '证据不足';

  if (sampleSize < 2 && evidenceTier !== 'observed') {
    // 样本过少且非直接观察：不输出建议价，防幻觉
    suggestedFactory = undefined;
    evidenceTier = 'insufficient';
    conf = { score: Math.min(conf.score, 28), label: '低' };
    reasons.push('样本不足（需≥2 家有价画像，或至少有观察采购/FOB），暂不给出建议价');
  } else if (ourFactoryCny != null && suggestedFactory && evidenceTier !== 'insufficient') {
    const mid = (suggestedFactory.min + suggestedFactory.max) / 2;
    const m = marginRate(mid, ourFactoryCny);
    if (ourFactoryCny < suggestedFactory.min * 0.85) {
      verdict = '偏低可冲量';
      reasons.push(
        `我方约 ¥${round2(ourFactoryCny)} 低于建议带 ¥${suggestedFactory.min}–${suggestedFactory.max}`
      );
    } else if (ourFactoryCny > suggestedFactory.max * 1.15) {
      verdict = '偏贵需减配或改包装';
      reasons.push(
        `我方约 ¥${round2(ourFactoryCny)} 高于建议带；可减配、改包装或换渠道`
      );
    } else {
      verdict = '落在可成交带';
      reasons.push(
        `我方约 ¥${round2(ourFactoryCny)} 落在建议带（中位约 ¥${round2(mid)}）`
      );
    }
    if (m != null) {
      reasons.push(`相对建议中位的示意毛利率约 ${(m * 100).toFixed(0)}%（Margin=(P−C)/P）`);
    }
  } else if (suggestedFactory && evidenceTier !== 'insufficient') {
    verdict = '落在可成交带';
    reasons.push(
      `建议出厂 ¥${suggestedFactory.min}–${suggestedFactory.max}（样本 ${sampleSize}，证据=${evidenceTier}）`
    );
  } else if (!reasons.length) {
    reasons.push('证据不足：无库内观察价，不输出臆造价');
  }

  if (retail) reasons.push(`终端零售观察带 ¥${retail.min}–${retail.max}`);
  if (buyCost) reasons.push(`采购/FOB 观察带 ¥${buyCost.min}–${buyCost.max}`);
  reasons.push(`渠道假设：${channel.label}`);

  const insufficient = evidenceTier === 'insufficient' || !suggestedFactory;

  return {
    category,
    sampleSize,
    marketRetail: retail,
    marketBuyCost: buyCost,
    suggestedFactory: insufficient ? undefined : suggestedFactory,
    ourFactoryCny,
    verdict: insufficient ? '证据不足' : verdict,
    confidence: conf.label,
    confidenceScore: conf.score,
    evidenceTier: insufficient ? 'insufficient' : evidenceTier,
    formulaUsed: insufficient ? undefined : formulaUsed,
    reasons: reasons.slice(0, 8),
    assumptions: assumptions.slice(0, 8),
  };
};
