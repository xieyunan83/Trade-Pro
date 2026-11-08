/**
 * 统一品类归类与匹配 API（全站阿里类目）
 * - 任意模块对产品/客户文本调用本文件
 * - 表达偏差：同义词规则 + 倒排索引候选 + 证据校验后才采纳
 */
import {
  PRODUCT_TAXONOMY,
  PRODUCT_TAXONOMY_BY_ID,
  PRODUCT_TAXONOMY_L1,
  PRODUCT_TAXONOMY_ROOTS,
  TAXONOMY_ALIAS_RULES,
  TOY_ROOT_ID,
  formatTaxonomyLabel,
  getTaxonomyChildren,
  getTaxonomyL1ByRoot,
  resolveLegacyCategoryId,
  taxonomyPromptList,
  type TaxonomyNode,
  type TaxonomySide,
} from '../data/productTaxonomy';
import type { CategoryEvidenceRef } from '../types';

export type CategoryAssignment = {
  rootId?: string;
  l1Id: string;
  l2Id?: string;
  l1NameEn: string;
  l1NameZh: string;
  l2NameEn?: string;
  l2NameZh?: string;
  score: number;
  reason: string;
  label: string;
  /** 校验后置信度 0–1 */
  confidence?: number;
  verified?: boolean;
  warnings?: string[];
};

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP = new Set([
  'and',
  'the',
  'for',
  'with',
  'toys',
  'toy',
  'products',
  'product',
  'other',
  'kids',
  'kid',
  'baby',
  'set',
  'sets',
  'new',
  'best',
  'hot',
  'sale',
  'items',
  'item',
  'goods',
]);

const tokens = (s: string) =>
  norm(s)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOP.has(t));

const EMPTY = /^(n\/?a|未知|公开信息未找到|none|null|待补|暂无|-)?$/i;

/** 倒排：词元 → 节点 id 列表（懒建；先玩具子集，空闲再扩全站，避免主线程卡死） */
let tokenIndex: Map<string, string[]> | null = null;
let tokenIndexFull = false;
/** 类目异步 hydrate 后节点数变化，需重建索引 */
let indexedForCount = -1;

const indexNodeInto = (map: Map<string, Set<string>>, node: TaxonomyNode) => {
  const bag = new Set<string>();
  for (const raw of [node.nameEn, node.nameZh, ...node.aliases]) {
    for (const t of tokens(raw)) bag.add(t);
    const n = norm(raw);
    if (n.length >= 2) bag.add(n);
  }
  for (const t of bag) {
    if (!map.has(t)) map.set(t, new Set());
    map.get(t)!.add(node.id);
  }
};

const finalizeIndex = (map: Map<string, Set<string>>) =>
  new Map([...map.entries()].map(([k, v]) => [k, [...v]]));

/** 仅母婴玩具大类 + 全部一级：找客自动匹配够用，节点量远小于全站 7k+ */
const ensureToyIndex = () => {
  const n = PRODUCT_TAXONOMY.length;
  if (n === 0) {
    tokenIndex = new Map();
    indexedForCount = 0;
    return tokenIndex;
  }
  if (tokenIndex && indexedForCount === n) return tokenIndex;
  const map = new Map<string, Set<string>>();
  for (const node of PRODUCT_TAXONOMY_ROOTS) indexNodeInto(map, node);
  for (const node of PRODUCT_TAXONOMY_L1) indexNodeInto(map, node);
  for (const node of PRODUCT_TAXONOMY) {
    if (node.level === 2 && node.rootId === TOY_ROOT_ID) indexNodeInto(map, node);
  }
  tokenIndex = finalizeIndex(map);
  indexedForCount = n;
  tokenIndexFull = false;
  // 空闲时再扩全站二级，不堵交互
  const expand = () => {
    if (tokenIndexFull || !tokenIndex) return;
    const map2 = new Map<string, Set<string>>();
    for (const [k, ids] of tokenIndex) map2.set(k, new Set(ids));
    let i = 0;
    const rest = PRODUCT_TAXONOMY.filter((n) => n.level === 2 && n.rootId !== TOY_ROOT_ID);
    const step = () => {
      const end = Math.min(i + 120, rest.length);
      for (; i < end; i++) indexNodeInto(map2, rest[i]);
      if (i < rest.length) {
        // 拉长间隔，避免挤占侧栏点击
        globalThis.setTimeout(step, 48);
        return;
      }
      tokenIndex = finalizeIndex(map2);
      tokenIndexFull = true;
    };
    globalThis.setTimeout(step, 0);
  };
  if (typeof window !== 'undefined') {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    };
    // 登录/首屏后再慢慢扩，超时也拉长
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(expand, { timeout: 12000 });
    } else {
      globalThis.setTimeout(expand, 5000);
    }
  }
  return tokenIndex;
};

const ensureIndex = () => ensureToyIndex();

const scoreNodeAgainstText = (node: TaxonomyNode, kw: string, kwTokens: string[]): number => {
  const names = [node.nameEn, node.nameZh, ...node.aliases].map(norm).filter(Boolean);
  let score = 0;
  for (const n of names) {
    if (!n) continue;
    if (kw === n) score = Math.max(score, node.level === 2 ? 96 : node.level === 1 ? 88 : 70);
    else if (kw.includes(n) && n.length >= 4) score = Math.max(score, node.level === 2 ? 58 : 42);
    else if (n.includes(kw) && kw.length >= 4) score = Math.max(score, node.level === 2 ? 50 : 36);
  }
  const nameToks = tokens(node.nameEn + ' ' + node.nameZh);
  const overlap = nameToks.filter((t) => kwTokens.includes(t)).length;
  if (overlap) score += overlap * (node.level === 2 ? 14 : node.level === 1 ? 10 : 6);
  for (const t of kwTokens) {
    if (t.length < 3) continue;
    for (const n of names) {
      if (n.includes(t)) score += node.level === 2 ? 6 : 4;
    }
  }
  return score;
};

const toAssignment = (node: TaxonomyNode, score: number, reason: string): CategoryAssignment | null => {
  if (node.level === 0) {
    // 大类命中：落到其下第一个一级不合适；要求继续细化，仅作弱提示时跳过
    return null;
  }
  if (node.level === 1) {
    return {
      rootId: node.parentId || undefined,
      l1Id: node.id,
      l1NameEn: node.nameEn,
      l1NameZh: node.nameZh,
      score,
      reason,
      label: node.nameZh,
    };
  }
  const l1 = node.parentId ? PRODUCT_TAXONOMY_BY_ID[node.parentId] : undefined;
  if (!l1) return null;
  return {
    rootId: l1.parentId || node.rootId,
    l1Id: l1.id,
    l2Id: node.id,
    l1NameEn: l1.nameEn,
    l1NameZh: l1.nameZh,
    l2NameEn: node.nameEn,
    l2NameZh: node.nameZh,
    score,
    reason,
    label: `${l1.nameZh} / ${node.nameZh}`,
  };
};

/**
 * 表达偏差校验：候选类目名/词元须在原文或证据中有依据，
 * 且不可被更高分的其他大类明显压过（防「玩具」误配到「工业」等）。
 */
export const verifyCategoryAssignment = (
  raw: string,
  assignment: CategoryAssignment,
  opts?: { evidenceBlob?: string; minConfidence?: number }
): CategoryAssignment => {
  const minConfidence = opts?.minConfidence ?? 0.45;
  const warnings: string[] = [];
  const blob = norm([raw, opts?.evidenceBlob || ''].join(' '));
  const labelToks = tokens(
    [assignment.l1NameEn, assignment.l1NameZh, assignment.l2NameEn, assignment.l2NameZh, assignment.label]
      .filter(Boolean)
      .join(' ')
  );
  const supportHits = labelToks.filter((t) => t.length >= 3 && blob.includes(t)).length;
  let confidence = Math.min(1, assignment.score / 100);
  if (labelToks.length && supportHits === 0 && assignment.score < 70) {
    confidence *= 0.55;
    warnings.push('类目词元未在原文/证据中出现，已降权');
  } else if (supportHits > 0) {
    confidence = Math.min(1, confidence + 0.08 * Math.min(3, supportHits));
  }
  // 大类冲突：原文更像另一个 root
  if (assignment.rootId && blob) {
    let bestOther = 0;
    let bestOtherId = '';
    for (const root of PRODUCT_TAXONOMY_ROOTS) {
      if (root.id === assignment.rootId) continue;
      const s = scoreNodeAgainstText(root, blob, tokens(blob));
      if (s > bestOther) {
        bestOther = s;
        bestOtherId = root.id;
      }
    }
    const selfRoot = assignment.rootId ? PRODUCT_TAXONOMY_BY_ID[assignment.rootId] : undefined;
    const selfScore = selfRoot ? scoreNodeAgainstText(selfRoot, blob, tokens(blob)) : 0;
    if (bestOther >= 28 && bestOther > selfScore + 12) {
      confidence *= 0.4;
      warnings.push(`原文更接近「${PRODUCT_TAXONOMY_BY_ID[bestOtherId]?.nameZh || bestOtherId}」，匹配存疑`);
    }
  }
  const verified = confidence >= minConfidence && assignment.score >= 18;
  if (!verified) warnings.push('未通过品类校验阈值');
  return {
    ...assignment,
    confidence,
    verified,
    warnings: warnings.length ? warnings : undefined,
    score: verified ? assignment.score : Math.min(assignment.score, 17),
  };
};

/** 单段文本 → 官方品类（可多候选，默认做校验） */
export const assignCategories = (
  raw: string,
  limit = 5,
  opts?: { evidenceBlob?: string; skipVerify?: boolean; preferRootId?: string }
): CategoryAssignment[] => {
  const text = (raw || '').trim();
  if (!text || EMPTY.test(text) || text.length < 2) return [];
  const kw = norm(text);
  const kwTokens = tokens(text);
  const hits: CategoryAssignment[] = [];

  // 1) 同义词规则
  for (const rule of TAXONOMY_ALIAS_RULES) {
    const hitKey = rule.keys.find((k) => kw.includes(norm(k)));
    if (!hitKey || !rule.l1Id) continue;
    const l1 = PRODUCT_TAXONOMY_BY_ID[rule.l1Id];
    if (!l1) continue;
    let l2: TaxonomyNode | undefined;
    if (rule.l2Hint) {
      l2 = getTaxonomyChildren(rule.l1Id).find(
        (c) =>
          norm(c.nameEn).includes(norm(rule.l2Hint!)) ||
          c.aliases.some((a) => norm(a).includes(norm(rule.l2Hint!)))
      );
    }
    const a = toAssignment(l2 || l1, 72 + (l2 ? 16 : 0), `同义词「${hitKey}」→ ${rule.labelZh}`);
    if (a) hits.push(a);
  }

  // 2) 倒排候选（控制扫描量）
  const idx = ensureIndex();
  const candidateIds = new Set<string>();
  for (const t of kwTokens) {
    const ids = idx.get(t);
    if (ids) for (const id of ids.slice(0, 80)) candidateIds.add(id);
  }
  // 短句整词
  if (kw.length >= 3 && kw.length <= 48) {
    const ids = idx.get(kw);
    if (ids) for (const id of ids.slice(0, 40)) candidateIds.add(id);
  }
  // 优先 root 下节点加权（只扫该大类，禁止全表 7k 扫描）
  if (candidateIds.size < 40 && opts?.preferRootId) {
    for (const n of getTaxonomyL1ByRoot(opts.preferRootId)) {
      candidateIds.add(n.id);
      if (candidateIds.size >= 200) break;
      for (const c of getTaxonomyChildren(n.id)) {
        if (tokens(c.nameEn).some((t) => kwTokens.includes(t))) candidateIds.add(c.id);
        if (candidateIds.size >= 200) break;
      }
    }
  }

  for (const id of candidateIds) {
    const node = PRODUCT_TAXONOMY_BY_ID[id];
    if (!node || node.level === 0) continue;
    let score = scoreNodeAgainstText(node, kw, kwTokens);
    if (opts?.preferRootId) {
      const root =
        node.level === 2
          ? node.rootId
          : node.level === 1
            ? node.parentId
            : undefined;
      if (root === opts.preferRootId) score += 8;
    }
    if (score < 18) continue;
    const a = toAssignment(node, score, node.level === 2 ? '二级类目名命中' : '一级类目名命中');
    if (a) hits.push(a);
  }

  hits.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: CategoryAssignment[] = [];
  for (const h of hits) {
    const k = `${h.l1Id}::${h.l2Id || ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const next = opts?.skipVerify
      ? h
      : verifyCategoryAssignment(text, h, { evidenceBlob: opts?.evidenceBlob });
    if (!opts?.skipVerify && next.verified === false && next.score < 18) continue;
    out.push(next);
    if (out.length >= limit) break;
  }
  return out;
};

/** 多段信号合并归类 */
export const assignCategoriesFromSignals = (
  signals: string[],
  opts?: { limit?: number; minScore?: number; evidenceBlob?: string; preferRootId?: string }
): CategoryAssignment[] => {
  const minScore = opts?.minScore ?? 20;
  const limit = opts?.limit ?? 12;
  const merged = new Map<string, CategoryAssignment>();
  for (const s of signals) {
    for (const a of assignCategories(s, 4, {
      evidenceBlob: opts?.evidenceBlob,
      preferRootId: opts?.preferRootId,
    })) {
      if (a.score < minScore) continue;
      if (a.verified === false && (a.confidence || 0) < 0.45) continue;
      const k = `${a.l1Id}::${a.l2Id || ''}`;
      const prev = merged.get(k);
      if (!prev || a.score > prev.score) merged.set(k, a);
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
};

export const assignBestCategory = (
  raw: string,
  opts?: { evidenceBlob?: string; preferRootId?: string }
): CategoryAssignment | null => {
  const hits = assignCategories(raw, 3, opts);
  const best = hits.find((h) => h.verified !== false && h.score >= 18) || hits[0];
  return best && best.score >= 18 ? best : null;
};

/**
 * 客户网站/社交/电商爬取的品类或品名 → 官方树
 * 强制证据校验；无证据时仅接受高分精确命中
 */
export const mapExternalCategoryToTaxonomy = (
  label: string,
  opts?: {
    evidenceBlob?: string;
    evidenceUrl?: string;
    side?: TaxonomySide;
    preferRootId?: string;
  }
): CategoryAssignment | null => {
  const text = (label || '').trim();
  if (!text || EMPTY.test(text)) return null;
  const hasEvidence = !!(opts?.evidenceBlob || opts?.evidenceUrl);
  const hits = assignCategories(text, 5, {
    evidenceBlob: opts?.evidenceBlob,
    preferRootId: opts?.preferRootId,
  });
  for (const h of hits) {
    const verified = verifyCategoryAssignment(text, h, {
      evidenceBlob: opts?.evidenceBlob,
      minConfidence: hasEvidence ? 0.4 : 0.55,
    });
    if (verified.verified && verified.score >= (hasEvidence ? 18 : 28)) {
      return {
        ...verified,
        reason: hasEvidence
          ? `${verified.reason} · 已对照证据校验`
          : `${verified.reason} · 无证据仅高分精确命中`,
      };
    }
  }
  return null;
};

export const idsFromAssignments = (assignments: CategoryAssignment[]): string[] => {
  const ids = new Set<string>();
  for (const a of assignments) {
    ids.add(resolveLegacyCategoryId(a.l1Id) || a.l1Id);
    if (a.l2Id) ids.add(a.l2Id);
    if (a.rootId) ids.add(a.rootId);
  }
  return [...ids];
};

/** 两边 ID 集合交集得分（主匹配依据） */
export const scoreCategoryIdOverlap = (
  aIds: string[] | undefined,
  bIds: string[] | undefined
): { score: number; matchedIds: string[]; labels: string[] } => {
  const normId = (id: string) => resolveLegacyCategoryId(id) || id;
  const a = new Set((aIds || []).filter(Boolean).map(normId));
  const b = new Set((bIds || []).filter(Boolean).map(normId));
  if (!a.size || !b.size) return { score: 0, matchedIds: [], labels: [] };
  const matched: string[] = [];
  for (const id of a) {
    if (b.has(id)) matched.push(id);
  }
  for (const id of a) {
    const node = PRODUCT_TAXONOMY_BY_ID[id];
    if (!node) continue;
    if (node.level === 2 && node.parentId && b.has(node.parentId) && !matched.includes(node.parentId)) {
      matched.push(node.parentId);
    }
    if (node.level === 1) {
      for (const idB of b) {
        const nb = PRODUCT_TAXONOMY_BY_ID[idB];
        if (nb?.parentId === node.id && !matched.includes(idB)) matched.push(idB);
      }
    }
  }
  const unique = [...new Set(matched)];
  let score = 0;
  for (const id of unique) {
    const n = PRODUCT_TAXONOMY_BY_ID[id];
    score += n?.level === 2 ? 28 : n?.level === 1 ? 18 : 8;
  }
  return {
    score: Math.min(56, score),
    matchedIds: unique,
    labels: unique.map((id) => formatTaxonomyLabel(id)),
  };
};

export const toCategoryEvidenceRefs = (
  assignments: CategoryAssignment[],
  side: TaxonomySide,
  meta?: { source?: CategoryEvidenceRef['source']; url?: string; snippet?: string }
): CategoryEvidenceRef[] =>
  assignments.map((a) => ({
    l1Id: a.l1Id,
    l2Id: a.l2Id,
    label: a.label,
    side: side === 'both' ? 'both' : side,
    source: meta?.source || 'catalog',
    url: meta?.url,
    snippet: meta?.snippet || a.reason,
    confidence: a.confidence ?? Math.min(1, a.score / 100),
  }));

export const evidenceSupportsLabel = (label: string, evidenceBlob?: string): boolean => {
  if (!evidenceBlob || !evidenceBlob.trim()) return true;
  const blob = norm(evidenceBlob);
  const parts = tokens(label);
  if (!parts.length) return true;
  return parts.some((t) => t.length >= 3 && blob.includes(t));
};

export const listTaxonomyRoots = (): TaxonomyNode[] => PRODUCT_TAXONOMY_ROOTS;
export const listTaxonomyL1 = (rootId?: string): TaxonomyNode[] =>
  rootId ? getTaxonomyL1ByRoot(rootId) : PRODUCT_TAXONOMY_L1;
export const getTaxonomyNode = (id: string): TaxonomyNode | undefined =>
  PRODUCT_TAXONOMY_BY_ID[resolveLegacyCategoryId(id) || id];

export {
  formatTaxonomyLabel,
  taxonomyPromptList,
  getTaxonomyChildren,
  getTaxonomyL1ByRoot,
  PRODUCT_TAXONOMY,
  TOY_ROOT_ID,
  resolveLegacyCategoryId,
};
