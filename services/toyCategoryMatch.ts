/**
 * 阿里玩具类目匹配（兼容层）
 * 新代码请优先用 services/categoryTaxonomy.ts；本文件保持旧导出名。
 * 找客页自动匹配走「玩具子集」快路径，避免全站类目倒排堵死主线程。
 */
import { ALIBABA_TOY_CATEGORIES, getAlibabaToyL2, type AlibabaToyL1 } from '../data/alibabaToyCategories';
import type { AnalysisResult } from '../types';
import {
  assignCategories,
  assignCategoriesFromSignals,
  formatTaxonomyLabel,
  getTaxonomyChildren,
  listTaxonomyL1,
  TOY_ROOT_ID,
} from './categoryTaxonomy';
import { PRODUCT_TAXONOMY_BY_ID, TAXONOMY_ALIAS_RULES } from '../data/productTaxonomy';

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

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 轻量：只在玩具大类 L1/L2 + 同义词规则里找，不触全站倒排 */
const suggestToyFast = (keyword: string, limit: number): ToyCategorySuggestion[] => {
  const kw = norm(keyword);
  if (kw.length < 2) return [];
  const out: ToyCategorySuggestion[] = [];

  for (const rule of TAXONOMY_ALIAS_RULES) {
    const hitKey = rule.keys.find((k) => kw.includes(norm(k)));
    if (!hitKey || !rule.l1Id) continue;
    const l1 = PRODUCT_TAXONOMY_BY_ID[rule.l1Id];
    if (!l1) continue;
    let l2 = rule.l2Hint
      ? getTaxonomyChildren(rule.l1Id).find(
          (c) =>
            norm(c.nameEn).includes(norm(rule.l2Hint!)) ||
            c.aliases.some((a) => norm(a).includes(norm(rule.l2Hint!)))
        )
      : undefined;
    out.push({
      l1: l1.nameEn,
      l2: l2?.nameEn || l1.nameEn,
      score: 80 + (l2 ? 10 : 0),
      reason: `同义词「${hitKey}」`,
      l1Id: l1.id,
      l2Id: l2?.id,
      rootId: TOY_ROOT_ID,
      labelZh: rule.labelZh || formatTaxonomyLabel(l2?.id || l1.id),
    });
    if (out.length >= limit) return out;
  }

  const l1s = listTaxonomyL1(TOY_ROOT_ID);
  for (const l1 of l1s) {
    const l1n = norm(l1.nameEn + ' ' + l1.nameZh);
    let bestL2: { id: string; nameEn: string; score: number } | undefined;
    for (const c of getTaxonomyChildren(l1.id)) {
      const cn = norm(c.nameEn + ' ' + c.nameZh);
      let sc = 0;
      if (kw === cn) sc = 90;
      else if (kw.includes(cn) && cn.length >= 4) sc = 55;
      else if (cn.includes(kw) && kw.length >= 4) sc = 48;
      else {
        const parts = kw.split(' ').filter((t) => t.length >= 3);
        for (const t of parts) if (cn.includes(t)) sc += 12;
      }
      if (sc >= 24 && (!bestL2 || sc > bestL2.score)) {
        bestL2 = { id: c.id, nameEn: c.nameEn, score: sc };
      }
    }
    let l1Score = 0;
    if (kw === l1n) l1Score = 70;
    else if (kw.includes(norm(l1.nameEn)) || norm(l1.nameEn).includes(kw)) l1Score = 40;
    else {
      const parts = kw.split(' ').filter((t) => t.length >= 3);
      for (const t of parts) if (l1n.includes(t)) l1Score += 10;
    }
    const score = Math.max(l1Score, bestL2?.score || 0);
    if (score < 24) continue;
    out.push({
      l1: l1.nameEn,
      l2: bestL2?.nameEn || l1.nameEn,
      score,
      reason: bestL2 ? '玩具二级命中' : '玩具一级命中',
      l1Id: l1.id,
      l2Id: bestL2?.id,
      rootId: TOY_ROOT_ID,
      labelZh: formatTaxonomyLabel(bestL2?.id || l1.id),
    });
  }

  out.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const uniq: ToyCategorySuggestion[] = [];
  for (const s of out) {
    const k = `${s.l1Id}::${s.l2Id || ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(s);
    if (uniq.length >= limit) break;
  }
  return uniq;
};

/** 根据关键词/产品描述推断最可能的一、二级类目（优先母婴玩具大类） */
export const suggestToyCategoriesFromKeyword = (
  keyword: string,
  limit = 5
): ToyCategorySuggestion[] => {
  const kw = (keyword || '').trim();
  if (kw.length < 2) return [];
  const fast = suggestToyFast(kw, limit);
  if (fast.length && fast[0].score >= 36) return fast;
  // 快路径不够再走统一匹配（内部已改为玩具子集倒排，不再全表卡死）
  try {
    const preferred = assignCategories(kw, limit, { preferRootId: TOY_ROOT_ID, skipVerify: true });
    const pool = preferred.filter((a) => a.score >= 18);
    if (pool.length) {
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
    }
  } catch (e) {
    console.warn('[toyCategoryMatch] assignCategories failed', e);
  }
  return fast;
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
