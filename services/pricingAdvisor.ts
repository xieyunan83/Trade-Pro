/**
 * 定价参考：客户零售人民币 → 推算采购成本 → 对照我方出厂价，并给置信度。
 * 规则启发式 + 库内真实价带；不展示内部数据源名。
 */
import type { CustomerProductProfile } from '../types';
import { normalizeCategoryLabel } from './productCatalog';

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
  /** 建议我方可报出厂价带（人民币） */
  suggestedFactory?: PriceBandCny;
  ourFactoryCny?: number;
  verdict: PricingVerdict;
  confidence: PricingConfidence;
  confidenceScore: number;
  reasons: string[];
  assumptions: string[];
};

const EMPTY = /^(n\/?a|未知|公开信息未找到|none|null|待补|暂无)?$/i;

/** 从「¥12–35」「FOB $1.2-2.5」「15-40元」等解析数字区间 */
export const parsePriceBandNumbers = (raw?: string): { lo?: number; hi?: number; currencyHint?: string } => {
  const s = (raw || '').trim();
  if (!s || EMPTY.test(s)) return {};
  const currencyHint = /\$|usd|美元/i.test(s)
    ? 'USD'
    : /€|eur|欧元/i.test(s)
      ? 'EUR'
      : /¥|￥|cny|rmb|元/i.test(s)
        ? 'CNY'
        : undefined;
  const nums = [...s.replace(/,/g, '').matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const positive = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (!positive.length) return { currencyHint };
  if (positive.length === 1) return { lo: positive[0], hi: positive[0], currencyHint };
  return { lo: Math.min(...positive), hi: Math.max(...positive), currencyHint };
};

/** 粗略换算到人民币（无汇率接口时用保守近似，仅作参考） */
export const toCnyApprox = (
  lo?: number,
  hi?: number,
  currencyHint?: string
): PriceBandCny | undefined => {
  if (lo == null && hi == null) return undefined;
  const rate =
    currencyHint === 'USD' ? 7.2 : currencyHint === 'EUR' ? 7.8 : 1;
  const a = (lo ?? hi!) * rate;
  const b = (hi ?? lo!) * rate;
  return { min: Math.round(Math.min(a, b) * 100) / 100, max: Math.round(Math.max(a, b) * 100) / 100 };
};

const mergeBand = (a?: PriceBandCny, b?: PriceBandCny): PriceBandCny | undefined => {
  if (!a) return b;
  if (!b) return a;
  return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
};

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
} => {
  const matched = profiles.filter((p) => profileMatchesCategory(p, category));
  let retail: PriceBandCny | undefined;
  let buyCost: PriceBandCny | undefined;
  let n = 0;
  for (const p of matched) {
    const r =
      p.priceMinCny != null || p.priceMaxCny != null
        ? {
            min: p.priceMinCny ?? p.priceMaxCny!,
            max: p.priceMaxCny ?? p.priceMinCny!,
          }
        : undefined;
    const b =
      p.buyCostMinCny != null || p.buyCostMaxCny != null
        ? {
            min: p.buyCostMinCny ?? p.buyCostMaxCny!,
            max: p.buyCostMaxCny ?? p.buyCostMinCny!,
          }
        : undefined;
    if (r || b) n += 1;
    retail = mergeBand(retail, r);
    buyCost = mergeBand(buyCost, b);
  }
  return { retail, buyCost, sampleSize: n };
};

/**
 * 建议出厂价：优先用库内采购成本带；否则用零售÷渠道倍率粗推。
 */
export const buildPricingAdvice = (opts: {
  category: string;
  profiles: CustomerProductProfile[];
  /** 我方出厂价（人民币；若为美元请先换算） */
  ourFactoryCny?: number;
  /** 用户填写的价格带原文 */
  priceBandText?: string;
}): PricingAdvice => {
  const category = (opts.category || '').trim() || '未指定品类';
  const { retail, buyCost, sampleSize } = aggregateMarketPriceBands(opts.profiles, category);

  const parsed = parsePriceBandNumbers(opts.priceBandText);
  const userBand = toCnyApprox(parsed.lo, parsed.hi, parsed.currencyHint);

  const ourFactoryCny =
    opts.ourFactoryCny != null && opts.ourFactoryCny > 0
      ? opts.ourFactoryCny
      : userBand
        ? (userBand.min + userBand.max) / 2
        : undefined;

  const assumptions: string[] = [];
  let suggestedFactory: PriceBandCny | undefined;

  if (buyCost) {
    // 对方采购价 ≈ 我方可成交出厂上沿；建议带取其 75%–100%
    suggestedFactory = {
      min: Math.round(buyCost.min * 0.75 * 100) / 100,
      max: Math.round(buyCost.max * 1.0 * 100) / 100,
    };
    assumptions.push('建议出厂价参考库内客户采购/FOB 成本带（取约 75%–100%）');
  } else if (retail) {
    // 零售 → 出厂：保守除以 3.5–5（渠道加价）
    suggestedFactory = {
      min: Math.round((retail.min / 5) * 100) / 100,
      max: Math.round((retail.max / 3.5) * 100) / 100,
    };
    assumptions.push('暂无采购成本，按终端零售÷3.5～5 粗推出厂带（渠道加价假设）');
  } else {
    assumptions.push('库内缺少该品类价带，建议先补全客户设计信号后再定价');
  }

  const reasons: string[] = [];
  let verdict: PricingVerdict = '证据不足';
  let confidenceScore = Math.min(90, 20 + sampleSize * 12);
  if (buyCost) confidenceScore += 15;
  if (retail) confidenceScore += 10;
  if (ourFactoryCny != null) confidenceScore += 5;

  if (ourFactoryCny != null && suggestedFactory) {
    const mid = (suggestedFactory.min + suggestedFactory.max) / 2;
    if (ourFactoryCny < suggestedFactory.min * 0.85) {
      verdict = '偏低可冲量';
      reasons.push(
        `我方约 ¥${ourFactoryCny} 低于建议带 ¥${suggestedFactory.min}–${suggestedFactory.max}，有冲量空间`
      );
    } else if (ourFactoryCny > suggestedFactory.max * 1.15) {
      verdict = '偏贵需减配或改包装';
      reasons.push(
        `我方约 ¥${ourFactoryCny} 高于建议带，可考虑减配、改包装或换渠道定位`
      );
    } else {
      verdict = '落在可成交带';
      reasons.push(
        `我方约 ¥${ourFactoryCny} 落在建议带 ¥${suggestedFactory.min}–${suggestedFactory.max}附近（中位约 ¥${Math.round(mid)}）`
      );
    }
  } else if (suggestedFactory) {
    verdict = '落在可成交带';
    reasons.push(
      `建议出厂参考 ¥${suggestedFactory.min}–${suggestedFactory.max}（基于 ${sampleSize} 家库内画像）`
    );
  } else {
    reasons.push('库内价带不足，无法给出可靠定价建议');
    confidenceScore = Math.min(confidenceScore, 25);
  }

  if (retail) {
    reasons.push(`终端零售参考 ¥${retail.min}–${retail.max}`);
  }
  if (buyCost) {
    reasons.push(`客户采购成本参考 ¥${buyCost.min}–${buyCost.max}`);
  }

  confidenceScore = Math.max(5, Math.min(95, Math.round(confidenceScore)));
  const confidence: PricingConfidence =
    confidenceScore >= 65 ? '高' : confidenceScore >= 40 ? '中' : '低';

  return {
    category,
    sampleSize,
    marketRetail: retail,
    marketBuyCost: buyCost,
    suggestedFactory,
    ourFactoryCny,
    verdict,
    confidence,
    confidenceScore,
    reasons: reasons.slice(0, 6),
    assumptions,
  };
};
