/**
 * 外贸/零售定价权威公式与常数（可审计）。
 *
 * 依据（方法论，非实时行情）：
 * - ICC Incoterms® 2020：FOB / CIF / DDP 风险与费用分界
 * - 现价透明市场：出口 FOB 常见约为终端零售的 ~0.2 倍（中心倍率；建议带 0.15–0.28）
 * - Margin vs Markup：Margin=(P−C)/P；Markup=(P−C)/C（不可混用）
 * - 历史 Keystone / 渠道阶梯仅作交叉参考，默认推算以 FOB≈零售×0.2 为准
 *
 * 本模块只提供「可复现计算」；无证据时不得伪造价。
 */

/** 现价透明环境下：出口 FOB 相对终端零售的倍率 */
export const FOB_OVER_RETAIL = {
  /** 中心倍率：FOB ≈ 零售 × 0.2 */
  center: 0.2,
  /** 建议带下限 */
  min: 0.15,
  /** 建议带上限 */
  max: 0.28,
  /** 迁移版本：变更公式时递增，触发全库重算 */
  migrationKey: 'fob_retail_x0.2_v1',
} as const;

export type EvidenceTier = 'observed' | 'derived' | 'assumed' | 'insufficient';

export type ChannelProfile = {
  id: string;
  label: string;
  /** 零售商目标毛利率（占 MSRP） */
  retailerMarginMin: number;
  retailerMarginMax: number;
  /**
   * 规划用：MSRP / Landed 倍率区间（玩具业常见 4–5；特通渠道更宽）
   * 仅作无采购证据时的反推，置信度必须下调
   */
  msrpOverLandedMin: number;
  msrpOverLandedMax: number;
};

/** 渠道档案（保守区间，避免单点幻觉） */
export const CHANNEL_PROFILES: Record<string, ChannelProfile> = {
  specialty: {
    id: 'specialty',
    label: '专业/精品零售',
    retailerMarginMin: 0.45,
    retailerMarginMax: 0.55,
    msrpOverLandedMin: 3.5,
    msrpOverLandedMax: 5.0,
  },
  mass: {
    id: 'mass',
    label: '商超/量贩',
    retailerMarginMin: 0.3,
    retailerMarginMax: 0.45,
    msrpOverLandedMin: 3.0,
    msrpOverLandedMax: 4.5,
  },
  toy_default: {
    id: 'toy_default',
    label: '玩具通用（规划）',
    retailerMarginMin: 0.45,
    retailerMarginMax: 0.55,
    msrpOverLandedMin: 4.0,
    msrpOverLandedMax: 5.0,
  },
};

export const pickChannelProfile = (hint?: string): ChannelProfile => {
  const h = (hint || '').toLowerCase();
  if (/walmart|target|tesco|carrefour|商超|量贩|超市|mass/i.test(h)) return CHANNEL_PROFILES.mass;
  if (/specialty|精品|玩具专卖|indie|独立/i.test(h)) return CHANNEL_PROFILES.specialty;
  return CHANNEL_PROFILES.toy_default;
};

/** Keystone：批发 = 零售 × (1 − 零售毛利率)；默认 50% → 批发 = 零售/2 */
export const wholesaleFromRetail = (
  retail: number,
  retailerMargin = 0.5
): number => {
  const m = Math.min(0.7, Math.max(0.15, retailerMargin));
  return retail * (1 - m);
};

/** 零售 = 批发 / (1 − 零售毛利率)；Keystone 时 = 批发 × 2 */
export const retailFromWholesale = (
  wholesale: number,
  retailerMargin = 0.5
): number => {
  const m = Math.min(0.7, Math.max(0.15, retailerMargin));
  return wholesale / (1 - m);
};

/**
 * 由终端零售反推出口 FOB / 出厂建议带。
 * 现价透明市场默认：FOB ≈ 零售 × 0.2，建议带 ×0.15–0.28。
 */
export const factoryBandFromRetail = (
  retailMin: number,
  retailMax: number,
  channel: ChannelProfile = CHANNEL_PROFILES.toy_default
): { min: number; max: number; tier: EvidenceTier; formula: string } => {
  const lo = Math.min(retailMin, retailMax);
  const hi = Math.max(retailMin, retailMax);
  return {
    min: round2(lo * FOB_OVER_RETAIL.min),
    max: round2(hi * FOB_OVER_RETAIL.max),
    tier: 'derived',
    formula: `现价透明市场：出口FOB≈零售×${FOB_OVER_RETAIL.center}（建议带×${FOB_OVER_RETAIL.min}–${FOB_OVER_RETAIL.max}；${channel.label}）`,
  };
};

/** 有明确零售人民币价时，推算单点 FOB（取中心倍率 0.2） */
export const estimateFobCnyFromRetailCny = (retailCny: number): number => {
  if (!(retailCny > 0) || !Number.isFinite(retailCny)) return 0;
  return Math.max(1, Math.round(retailCny * FOB_OVER_RETAIL.center));
};

/** 从 retailPriceCNY 或零售价原文解析人民币零售价 */
export const resolveRetailPriceCny = (p: {
  retailPrice?: string;
  retailPriceCNY?: number | null;
}): number => {
  const direct = Number(p.retailPriceCNY);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const parsed = parsePriceBandNumbers(p.retailPrice);
  const n = parsed.lo ?? parsed.hi;
  if (!(n != null && n > 0)) return 0;
  const cur =
    parsed.currencyHint ||
    (/\$|usd|美元/i.test(p.retailPrice || '') ? 'USD' : /€|eur|欧元/i.test(p.retailPrice || '') ? 'EUR' : 'CNY');
  return convertToCny(n, cur).cny;
};

/** 强制按零售×0.2 写回 estimatedFOBPriceCNY；无零售则清零 */
export const applyEstimatedFobFromRetail = <
  T extends {
    retailPrice?: string;
    retailPriceCNY?: number;
    estimatedFOBPriceCNY?: number;
  },
>(
  p: T
): T => {
  const retailCny = resolveRetailPriceCny(p);
  if (!(retailCny > 0)) {
    return { ...p, estimatedFOBPriceCNY: 0 };
  }
  return {
    ...p,
    retailPriceCNY: p.retailPriceCNY && p.retailPriceCNY > 0 ? p.retailPriceCNY : Math.round(retailCny),
    estimatedFOBPriceCNY: estimateFobCnyFromRetailCny(retailCny),
  };
};

/**
 * 由库内「采购/FOB」观察值得到可报出厂带：直接取观察带的 85%–100%
 * （对方已给出的采购成本最接近可成交价）
 */
export const factoryBandFromObservedBuyCost = (
  buyMin: number,
  buyMax: number
): { min: number; max: number; tier: EvidenceTier; formula: string } => ({
  min: round2(Math.min(buyMin, buyMax) * 0.85),
  max: round2(Math.max(buyMin, buyMax) * 1.0),
  tier: 'observed',
  formula: '出厂建议带 = 库内观察采购/FOB 成本 × 85–100%（优先观察值，非臆造）',
});

/**
 * 交叉校验带：与透明市场 FOB/零售中心倍率对齐（×0.15–0.28）。
 * 保留函数名供定价顾问引用；不再走旧 Keystone/Landed 阶梯。
 */
export const factoryBandFromRetailLandedLadder = (
  retailMin: number,
  retailMax: number,
  channel: ChannelProfile = CHANNEL_PROFILES.toy_default
): { min: number; max: number; tier: EvidenceTier; formula: string } => {
  const band = factoryBandFromRetail(retailMin, retailMax, channel);
  return {
    ...band,
    tier: 'assumed',
    formula: `交叉校验：${band.formula}`,
  };
};

/** 毛利率 */
export const marginRate = (price: number, cost: number): number | undefined => {
  if (!(price > 0) || !(cost >= 0)) return undefined;
  return (price - cost) / price;
};

/** 加价率 */
export const markupRate = (price: number, cost: number): number | undefined => {
  if (!(cost > 0) || !(price >= 0)) return undefined;
  return (price - cost) / cost;
};

/**
 * 参考中间价汇率（非实时牌价）。用于无用户币种时的展示换算。
 * 使用时必须在 assumptions 中声明，并降低置信度。
 */
export const FX_REF_TO_CNY: Record<string, { rate: number; asOf: string; note: string }> = {
  USD: {
    rate: 7.2,
    asOf: 'ref-band',
    note: '参考中间价约 7.2，非实时牌价；正式报价请按成交日汇率重算',
  },
  EUR: {
    rate: 7.8,
    asOf: 'ref-band',
    note: '参考中间价约 7.8，非实时牌价；正式报价请按成交日汇率重算',
  },
  CNY: { rate: 1, asOf: 'parity', note: '人民币原币' },
};

export const convertToCny = (
  amount: number,
  currency: string
): { cny: number; fxNote: string; assumedFx: boolean } => {
  const key = (currency || 'CNY').toUpperCase();
  const fx = FX_REF_TO_CNY[key] || FX_REF_TO_CNY.USD;
  return {
    cny: round2(amount * fx.rate),
    fxNote: fx.note,
    assumedFx: key !== 'CNY',
  };
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

const EMPTY_PRICE = /^(n\/?a|未知|公开信息未找到|none|null|待补|暂无)?$/i;

/** 从「¥12–35」「FOB $1.2-2.5」等解析数字区间与币种提示 */
export const parsePriceBandNumbers = (
  raw?: string
): { lo?: number; hi?: number; currencyHint?: string } => {
  const s = (raw || '').trim();
  if (!s || EMPTY_PRICE.test(s)) return {};
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

/** 四分位稳健价带：剔除极端异常，降低脏数据幻觉 */
export const robustBandFromValues = (
  values: number[]
): { min: number; max: number; n: number; method: string } | undefined => {
  const nums = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!nums.length) return undefined;
  if (nums.length < 4) {
    return {
      min: round2(nums[0]),
      max: round2(nums[nums.length - 1]),
      n: nums.length,
      method: 'min-max（样本<4，未做四分位修剪）',
    };
  }
  const q = (p: number) => {
    const i = (nums.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    if (lo === hi) return nums[lo];
    return nums[lo] * (hi - i) + nums[hi] * (i - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const trimmed = nums.filter((v) => v >= lowFence && v <= highFence);
  const use = trimmed.length >= 3 ? trimmed : nums;
  return {
    min: round2(use[0]),
    max: round2(use[use.length - 1]),
    n: use.length,
    method: 'Tukey IQR 1.5× 修剪后 min-max',
  };
};

/** 置信度：按证据层级与样本量 */
export const scoreEvidenceConfidence = (opts: {
  tier: EvidenceTier;
  sampleSize: number;
  hasObservedBuy: boolean;
  hasObservedRetail: boolean;
  usedAssumedFx: boolean;
  usedLandedLadder: boolean;
}): { score: number; label: '高' | '中' | '低' } => {
  let score = 10;
  if (opts.tier === 'observed') score += 45;
  else if (opts.tier === 'derived') score += 28;
  else if (opts.tier === 'assumed') score += 12;
  score += Math.min(25, opts.sampleSize * 5);
  if (opts.hasObservedBuy) score += 12;
  if (opts.hasObservedRetail) score += 8;
  if (opts.usedAssumedFx) score -= 10;
  if (opts.usedLandedLadder) score -= 12;
  if (opts.sampleSize === 0) score = Math.min(score, 22);
  score = Math.max(5, Math.min(92, Math.round(score)));
  const label = score >= 65 ? '高' : score >= 40 ? '中' : '低';
  return { score, label };
};
