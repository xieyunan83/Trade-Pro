/**
 * 用决策模型对背调结果做结构化再判定：渠道分型、适市、是否需补品类/设计信号、匹配就绪度。
 * 结果写入 AnalysisResult.decisionEnrichment，供 CRM 标签与产品匹配消费。
 */
import type { AnalysisResult } from '../types';
import {
  callDecisionModel,
  type DecisionModelResult,
} from './decisionModelService';
import { hasRichProductCatalog, profileHasDesignSignals } from './productCatalog';
import { buildProductProfileFromAnalysis } from './productCatalog';

export type DecisionEnrichment = {
  channelKind: string;
  channelConfidence: number;
  isToyRelevant: number;
  productFitScore: number;
  productFitConfidence: number;
  matchReady: number;
  needsProductDig: number;
  needsDesignFill: number;
  evidenceStrength: number;
  evidenceConfidence: number;
  modelId: string;
  updatedAt: number;
  /** 中性摘要，可上前台 */
  summaryZh: string;
};

const buildState = (analysis: AnalysisResult) => {
  const products = (analysis.products || []).slice(0, 8).map((p) => ({
    name: p.name,
    category: p.category,
    role: p.role,
    packaging: p.packaging,
    colors: p.colors,
    price: p.retailPrice || p.estimatedFOBPriceCNY,
  }));
  return {
    company: analysis.companyInfo?.name,
    website: analysis.companyInfo?.website,
    nature: analysis.companyInfo?.nature,
    description: (analysis.companyInfo?.description || '').slice(0, 800),
    coreProducts: analysis.businessScope?.coreProducts?.slice(0, 12),
    channels: analysis.businessModel?.channels?.slice(0, 8),
    ecommerce: analysis.businessModel?.ecommercePresence?.slice(0, 8),
    importCategories: analysis.tradeIntelligence?.importCategories?.slice(0, 10),
    hsCodes: analysis.tradeIntelligence?.hsCodes?.slice(0, 8),
    productIntelSell: analysis.productIntel?.sell?.categories?.slice(0, 10),
    productIntelProcure: analysis.productIntel?.procure?.categories?.slice(0, 10),
    packaging: analysis.productSummary?.packagingAnalysis?.slice(0, 200),
    colorPreference: analysis.productSummary?.colorPreference?.slice(0, 120),
    searchKeyword: analysis.searchKeyword,
    searchCountry: analysis.searchCountry,
    products,
    hasRichCatalog: hasRichProductCatalog(analysis),
  };
};

const QUESTIONS = {
  channelKind: {
    type: 'choice' as const,
    instructions: '该公司最贴近哪一类采购/销售渠道？',
    criteria: {
      platform_seller: '电商平台卖家（Amazon/TikTok/Walmart 等）',
      importer: '进口商 / 贸易公司，有提单或进口行为特征',
      wholesaler: '批发商 / 经销商',
      retailer: '线下零售连锁或精品店',
      hybrid: '线上线下混合',
      other: '无法判断或其他',
    },
  },
  isToyRelevant: {
    type: 'noul' as const,
    instructions:
      '是否与玩具、礼品、婴童、文教、派对、户外休闲相关的买家或卖家？（是=高概率）',
    criteria: {
      true: '相关：玩具礼品婴童文教派对等',
      false: '明显不相关：纯金融/软件/重工业等',
    },
  },
  productFitScore: {
    type: 'score' as const,
    instructions: '作为澄海玩具/礼品出口的潜在客户，产品与市场匹配程度？',
    criteria: [
      '几乎不匹配',
      '弱相关，需谨慎',
      '可开发，需补证据',
      '较匹配，值得跟进',
      '高度匹配，优先开发',
    ],
  },
  matchReady: {
    type: 'noul' as const,
    instructions: '现有品类/包装/价带信息是否足够支撑产品匹配与开发建议？',
  },
  needsProductDig: {
    type: 'noul' as const,
    instructions: '是否仍缺少全站品类与价格区间，需要产品品类补采？',
  },
  needsDesignFill: {
    type: 'noul' as const,
    instructions: '是否缺少包装/配色/价带等设计匹配信号，需要轻量补全？',
  },
  evidenceStrength: {
    type: 'score' as const,
    instructions: '公开信息与贸易线索对结论的支撑强度？',
    criteria: ['几乎无证据', '弱', '中等', '较强', '硬证据充分'],
  },
};

const num = (v: unknown, fallback = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export const enrichAnalysisWithDecision = async (
  analysis: AnalysisResult
): Promise<{ analysis: AnalysisResult; enrichment: DecisionEnrichment; raw: DecisionModelResult }> => {
  const state = buildState(analysis);
  const raw = await callDecisionModel(state, QUESTIONS, { timeoutMs: 60_000 });
  const a = raw.answers;

  const channelKind = a.channelKind?.choice || 'other';
  const channelConfidence = num(a.channelKind?.confidence, 0);
  const isToyRelevant = num(a.isToyRelevant?.noul, 0);
  const productFitScore = num(a.productFitScore?.score, 0);
  const productFitConfidence = num(a.productFitScore?.confidence, 0);
  const matchReady = num(a.matchReady?.noul, 0);
  const needsProductDig = num(a.needsProductDig?.noul, hasRichProductCatalog(analysis) ? 0.15 : 0.85);
  const needsDesignFill = num(a.needsDesignFill?.noul, 0.5);
  const evidenceStrength = num(a.evidenceStrength?.score, 0);
  const evidenceConfidence = num(a.evidenceStrength?.confidence, 0);

  const fitLabel =
    productFitScore >= 3.2 ? '高度匹配' : productFitScore >= 2.2 ? '较匹配' : productFitScore >= 1.2 ? '可开发' : '弱相关';

  const enrichment: DecisionEnrichment = {
    channelKind,
    channelConfidence,
    isToyRelevant,
    productFitScore,
    productFitConfidence,
    matchReady,
    needsProductDig,
    needsDesignFill,
    evidenceStrength,
    evidenceConfidence,
    modelId: raw.model,
    updatedAt: Date.now(),
    summaryZh: `渠道 ${channelKind}（置信 ${(channelConfidence * 100).toFixed(0)}%）· 适市 ${fitLabel} · 玩具相关 ${(isToyRelevant * 100).toFixed(0)}% · 证据档 ${evidenceStrength.toFixed(1)}`,
  };

  const channelTag =
    channelKind === 'platform_seller'
      ? '渠道:平台卖家'
      : channelKind === 'importer'
        ? '渠道:进口商'
        : channelKind === 'wholesaler'
          ? '渠道:批发'
          : channelKind === 'retailer'
            ? '渠道:零售'
            : channelKind === 'hybrid'
              ? '渠道:混合'
              : '渠道:待定';

  const fitTag = `适市:${fitLabel}`;
  const toyTag = isToyRelevant >= 0.55 ? '品类:玩具礼品相关' : isToyRelevant <= 0.35 ? '品类:低相关' : null;

  const prevTags = analysis.searchTags || [];
  const nextTags = [
    ...prevTags.filter((t) => !/^渠道:|^适市:|^品类:(玩具礼品相关|低相关)/.test(t)),
    channelTag,
    fitTag,
    ...(toyTag ? [toyTag] : []),
  ].slice(0, 40);

  const next: AnalysisResult = {
    ...analysis,
    searchTags: nextTags,
    decisionEnrichment: enrichment,
    evidenceConfidence: Math.max(analysis.evidenceConfidence || 0, evidenceConfidence || 0),
    evidenceSummary: enrichment.summaryZh,
  };

  return { analysis: next, enrichment, raw };
};

/** 从决策结果生成 CRM 补丁标签 */
export const crmTagsFromDecision = (enrichment?: DecisionEnrichment | null): string[] => {
  if (!enrichment) return [];
  const tags: string[] = [];
  if (enrichment.channelKind) {
    const map: Record<string, string> = {
      platform_seller: '渠道:平台卖家',
      importer: '渠道:进口商',
      wholesaler: '渠道:批发',
      retailer: '渠道:零售',
      hybrid: '渠道:混合',
      other: '渠道:待定',
    };
    tags.push(map[enrichment.channelKind] || `渠道:${enrichment.channelKind}`);
  }
  if (enrichment.productFitScore >= 3.2) tags.push('适市:高度匹配');
  else if (enrichment.productFitScore >= 2.2) tags.push('适市:较匹配');
  else if (enrichment.productFitScore >= 1.2) tags.push('适市:可开发');
  else tags.push('适市:弱相关');
  if (enrichment.isToyRelevant >= 0.55) tags.push('品类:玩具礼品相关');
  else if (enrichment.isToyRelevant <= 0.35) tags.push('品类:低相关');
  if (enrichment.matchReady >= 0.6) tags.push('匹配:就绪');
  else tags.push('匹配:待补证据');
  return tags;
};

/** 启发式：本地能否跳过挖品类 */
export const localNeedsProductDig = (analysis?: AnalysisResult | null) =>
  !hasRichProductCatalog(analysis || null);

export const localNeedsDesignFill = (analysis?: AnalysisResult | null) => {
  if (!analysis) return true;
  const profile = buildProductProfileFromAnalysis(analysis);
  if (!profile) return true;
  return !profileHasDesignSignals(profile);
};
