/**
 * 阿里玩具类目匹配（兼容层）
 * 新代码请优先用 services/categoryTaxonomy.ts；本文件保持旧导出名。
 */
import { ALIBABA_TOY_CATEGORIES, getAlibabaToyL2, type AlibabaToyL1 } from '../data/alibabaToyCategories';
import type { AnalysisResult } from '../types';
import {
  assignCategories,
  assignCategoriesFromSignals,
  listTaxonomyL1,
  TOY_ROOT_ID,
} from './categoryTaxonomy';

/** 行业字符串是否属于玩具/母婴相关（触发一二级类目选择） */
export const isToyRelatedIndustry = (industry?: string): boolean => {
  const s = (industry || '').toLowerCase();
  if (!s.trim()) return false;
  return /toy|plush|game|娃娃|玩具|母婴|baby|infant|toddler|儿童|童装|blind.?box|figurine|stem|puzzle|nursery|maternity|diaper|anime/i.test(
    s
  );
};

export type ToyCategorySuggestion = {
  l1: string;
  l2: string;
  score: number;
  reason: string;
  l1Id?: string;
  l2Id?: string;
  rootId?: string;
  labelZh?: string;
};

/** 根据关键词/产品描述推断最可能的一、二级类目（优先母婴玩具大类，全站兜底） */
export const suggestToyCategoriesFromKeyword = (
  keyword: string,
  limit = 5
): ToyCategorySuggestion[] => {
  const kw = (keyword || '').trim();
  if (kw.length < 2) return [];
  const preferred = assignCategories(kw, limit, { preferRootId: TOY_ROOT_ID });
  const fallback =
    preferred.length && preferred[0].score >= 22
      ? preferred
      : assignCategories(kw, limit);
  const pool = (fallback.length ? fallback : preferred).filter(
    (a) => a.verified !== false && a.score >= 18
  );
  return pool.map((a) => ({
    l1: a.l1NameEn,
    l2: a.l2NameEn || a.l1NameEn,
    score: a.score,
    reason: a.reason,
    l1Id: a.l1Id,
    l2Id: a.l2Id,
    rootId: a.rootId,
    labelZh: a.label,
  }));
};

/** 从背调报告抽取客户采购/经营品类文本 */
export const extractClientProductSignals = (analysis?: AnalysisResult | null): string[] => {
  if (!analysis) return [];
  const out: string[] = [];
  const push = (s?: string) => {
    const t = (s || '').trim();
    if (t && t.length > 1 && !/公开信息未找到|n\/a|unknown/i.test(t)) out.push(t);
  };
  for (const p of analysis.products || []) {
    push(p.name);
    push(p.category);
    push((p as { description?: string }).description);
  }
  for (const c of analysis.websiteCategories || []) {
    // 正确字段为 categoryName（旧代码误读 name/title，导致站内类目信号丢失）
    push(typeof c === 'string' ? c : c?.categoryName);
    for (const item of c?.items || []) push(item);
  }
  for (const x of analysis.businessScope?.coreProducts || []) push(x);
  for (const x of analysis.businessScope?.relevantProducts || []) push(x);
  for (const x of analysis.tradeIntelligence?.importCategories || []) push(x);
  for (const x of analysis.productIntel?.sell?.categories || []) push(x);
  for (const x of analysis.productIntel?.procure?.categories || []) push(x);
  for (const x of analysis.productIntel?.sell?.items || []) push(x);
  for (const x of analysis.productIntel?.procure?.items || []) push(x);
  push(analysis.productSummary?.recommendedProducts);
  push(analysis.productSummary?.marketPreference);
  push(analysis.searchKeyword);
  for (const t of analysis.searchTags || []) push(t);
  return [...new Set(out)].slice(0, 80);
};

export type ClientAlibabaCategoryHit = {
  l1: string;
  l2: string;
  score: number;
  evidence: string;
  l1Id?: string;
  l2Id?: string;
};

/** 客户品类信号 vs 官方品类树 */
export const matchClientSignalsToAlibabaCategories = (
  signals: string[],
  opts?: { limit?: number; minScore?: number }
): ClientAlibabaCategoryHit[] => {
  const minScore = opts?.minScore ?? 20;
  const limit = opts?.limit ?? 12;
  return assignCategoriesFromSignals(signals, { limit, minScore }).map((a) => ({
    l1: a.l1NameEn,
    l2: a.l2NameEn || a.l1NameEn,
    score: a.score,
    evidence: a.reason,
    l1Id: a.l1Id,
    l2Id: a.l2Id,
  }));
};

export const listAlibabaToyL1 = (): AlibabaToyL1[] => ALIBABA_TOY_CATEGORIES;

export { getAlibabaToyL2, listTaxonomyL1 };
