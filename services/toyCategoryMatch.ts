/**
 * 阿里玩具类目：关键词自动匹配一级/二级；客户品类 vs 平台类目交叉。
 */
import {
  ALIBABA_TOY_CATEGORIES,
  getAlibabaToyL2,
  type AlibabaToyL1,
} from '../data/alibabaToyCategories';
import type { AnalysisResult } from '../types';

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (s: string) =>
  norm(s)
    .split(' ')
    .filter((t) => t.length >= 2 && !/^(and|the|for|with|toys?|products?|other|kids?|baby)$/i.test(t));

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
};

/** 根据关键词/产品描述推断最可能的一、二级类目 */
export const suggestToyCategoriesFromKeyword = (
  keyword: string,
  limit = 5
): ToyCategorySuggestion[] => {
  const kw = norm(keyword);
  if (!kw || kw.length < 2) return [];
  const kwTokens = tokens(keyword);
  const hits: ToyCategorySuggestion[] = [];

  for (const cat of ALIBABA_TOY_CATEGORIES) {
    const l1n = norm(cat.nameEn);
    let l1Score = 0;
    if (kw.includes(l1n) || l1n.includes(kw)) l1Score += 40;
    for (const t of kwTokens) {
      if (l1n.includes(t)) l1Score += 8;
    }
    for (const child of cat.children) {
      const c2 = norm(child);
      let score = l1Score;
      if (kw.includes(c2) || c2.includes(kw)) score += 50;
      for (const t of kwTokens) {
        if (c2.includes(t) || t.includes(c2.split(' ')[0] || '')) score += 10;
      }
      // 单词重叠
      const childToks = tokens(child);
      const overlap = childToks.filter((t) => kwTokens.includes(t)).length;
      score += overlap * 12;
      if (score < 18) continue;
      hits.push({
        l1: cat.nameEn,
        l2: child,
        score,
        reason: overlap ? `关键词命中 ${overlap} 个词` : '类目名相近',
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: ToyCategorySuggestion[] = [];
  for (const h of hits) {
    const k = `${h.l1}::${h.l2}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
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
    push((p as any).description);
  }
  for (const c of analysis.websiteCategories || []) {
    push(typeof c === 'string' ? c : (c as any)?.name || (c as any)?.title);
  }
  for (const x of analysis.businessScope?.coreProducts || []) push(x);
  for (const x of analysis.tradeIntelligence?.importCategories || []) push(x);
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
};

/** 客户品类信号 vs 阿里玩具类目 */
export const matchClientSignalsToAlibabaCategories = (
  signals: string[],
  opts?: { limit?: number; minScore?: number }
): ClientAlibabaCategoryHit[] => {
  const minScore = opts?.minScore ?? 20;
  const limit = opts?.limit ?? 12;
  const blob = signals.join(' · ');
  const sug = suggestToyCategoriesFromKeyword(blob, limit * 2);
  return sug
    .filter((s) => s.score >= minScore)
    .slice(0, limit)
    .map((s) => ({
      l1: s.l1,
      l2: s.l2,
      score: s.score,
      evidence: s.reason,
    }));
};

export const listAlibabaToyL1 = (): AlibabaToyL1[] => ALIBABA_TOY_CATEGORIES;

export { getAlibabaToyL2 };
