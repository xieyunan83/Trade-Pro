/**
 * 客户产品画像库：从背调报告抽取品类/价格 → 入库 → 新品反查匹配
 */
import type {
  AnalysisResult,
  CustomerProductProfile,
  CustomerProductSku,
  HistoryItem,
  OurProductMatchQuery,
  ProductMatchHit,
} from '../types';
import { INDUSTRY_OPTIONS } from '../data/industries';
import {
  deleteProductProfile,
  getProductProfiles,
  saveProductProfile,
  saveProductProfilesBulk,
} from './db';
import {
  deleteProductProfileCloud,
  saveProductProfileCloud,
  syncProductProfilesCloud,
} from './supabase';

const domainKey = (raw?: string) =>
  (raw || '')
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .trim();

/** 常见玩具/消费品同义词 → 标准品类（中文标签） */
const CATEGORY_ALIASES: Array<{ keys: string[]; label: string }> = [
  { keys: ['diecast', '合金车', '合金小车', '金属车', 'toy car', 'car toy', 'pull back', '回力车'], label: '合金/回力车玩具' },
  { keys: ['rc car', 'remote control', '遥控车', '遥控玩具'], label: '遥控玩具' },
  { keys: ['plush', '软玩具', '毛绒', 'stuffed'], label: '毛绒玩具' },
  { keys: ['educational toy', '益智', 'stem toy', 'learning toy'], label: '益智教育玩具' },
  { keys: ['bubble', '泡泡'], label: '泡泡 / 派对玩具' },
  { keys: ['party favor', '派对礼品', 'party supply'], label: '派对用品' },
  { keys: ['outdoor play', '户外游乐', 'playground'], label: '户外游乐设施' },
  { keys: ['baby', 'infant', '母婴', 'nursery', '喂养'], label: '母婴用品' },
  { keys: ['stationery', '文具'], label: '文具办公用品' },
  { keys: ['kitchen', '厨具', 'tableware', '餐具'], label: '厨具餐具' },
  { keys: ['pet', '宠物'], label: '宠物用品' },
  { keys: ['toy', '玩具', 'games'], label: '玩具与游戏' },
];

const normalizeText = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/+&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeCategoryLabel = (raw?: string): string => {
  const t = (raw || '').trim();
  if (!t || /^(n\/?a|未知|公开信息未找到|none|null)$/i.test(t)) return '';
  const low = normalizeText(t);

  for (const a of CATEGORY_ALIASES) {
    if (a.keys.some((k) => low.includes(normalizeText(k)))) return a.label;
  }

  for (const opt of INDUSTRY_OPTIONS) {
    const en = normalizeText(opt.en);
    const zh = normalizeText(opt.zh);
    if ((en && low.includes(en)) || (zh && (low.includes(zh) || zh.includes(low)))) {
      return opt.zh;
    }
  }

  // 截断过长自由文本
  return t.length > 48 ? `${t.slice(0, 46)}…` : t;
};

const parseMoney = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
    }
  }
  return undefined;
};

const skuId = (companyKey: string, name: string, idx: number) =>
  `${companyKey}__${idx}_${normalizeText(name).slice(0, 24).replace(/\s+/g, '_') || 'sku'}`;

const EMPTY_SIGNAL = /^(n\/?a|未知|公开信息未找到|none|null|待补|暂无|-)?$/i;

/** 把包装/配色原文拆成可匹配短标签 */
export const splitDesignSignalTokens = (raw?: string, max = 12): string[] => {
  if (!raw || EMPTY_SIGNAL.test(raw.trim())) return [];
  const parts = raw
    .split(/[,，、;/|+\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 40 && !EMPTY_SIGNAL.test(s));
  return [...new Set(parts)].slice(0, max);
};

const unionStrings = (...lists: Array<string[] | undefined>): string[] => {
  const out = new Set<string>();
  for (const list of lists) {
    (list || []).forEach((x) => {
      const t = (x || '').trim();
      if (t) out.add(t);
    });
  }
  return [...out];
};

const preferLongerText = (a?: string, b?: string): string | undefined => {
  const aa = (a || '').trim();
  const bb = (b || '').trim();
  if (!aa || EMPTY_SIGNAL.test(aa)) return bb || undefined;
  if (!bb || EMPTY_SIGNAL.test(bb)) return aa || undefined;
  return bb.length > aa.length ? bb : aa;
};

/** 设计匹配信号是否够用（色/包/价/周期至少两类） */
export const profileHasDesignSignals = (p?: CustomerProductProfile | null): boolean => {
  if (!p) return false;
  let n = 0;
  if ((p.packagingStyles || []).length || (p.packagingSummary || '').trim()) n += 1;
  if ((p.colorPalettes || []).length || (p.colorPreference || '').trim()) n += 1;
  if (p.priceMinCny != null || p.priceMaxCny != null || p.buyCostMinCny != null) n += 1;
  if ((p.procurementCycle || p.buyingSeasons || p.typicalMoq || '').trim()) n += 1;
  return n >= 2;
};

export type CatalogGapKind =
  | 'tags'
  | 'packaging'
  | 'colors'
  | 'price'
  | 'buyCost'
  | 'cycle'
  | 'volume';

export type CatalogCoverageRow = {
  id: string;
  companyName: string;
  website: string;
  historyId?: string;
  crmClientId?: string;
  missing: CatalogGapKind[];
  catalogQuality: number;
  designSignalQuality: number;
};

export type CatalogCoverageReport = {
  historyWithReport: number;
  profilesTotal: number;
  withTags: number;
  withPackaging: number;
  withColors: number;
  withPrice: number;
  withBuyCost: number;
  withCycle: number;
  withVolume: number;
  designReady: number;
  crmBlankProductTags: number;
  /** 有背调但画像缺失或设计信号空白 */
  gaps: CatalogCoverageRow[];
};

const missingKindsForProfile = (p: CustomerProductProfile): CatalogGapKind[] => {
  const miss: CatalogGapKind[] = [];
  if (!(p.productTags || []).length && !(p.sellCategories || []).length) miss.push('tags');
  if (!(p.packagingStyles || []).length && !(p.packagingSummary || '').trim()) miss.push('packaging');
  if (!(p.colorPalettes || []).length && !(p.colorPreference || '').trim()) miss.push('colors');
  if (p.priceMinCny == null && p.priceMaxCny == null) miss.push('price');
  if (p.buyCostMinCny == null && p.buyCostMaxCny == null) miss.push('buyCost');
  if (!(p.procurementCycle || p.buyingSeasons || p.typicalMoq || '').trim()) miss.push('cycle');
  if (!(p.volumeSignal || '').trim()) miss.push('volume');
  return miss;
};

/** 从背调报告抽取客户产品画像 */
export const buildProductProfileFromAnalysis = (
  analysis: AnalysisResult,
  meta?: {
    historyId?: string;
    crmClientId?: string;
    ownerUsername?: string;
    departmentId?: string;
  }
): CustomerProductProfile | null => {
  const website = domainKey(analysis.companyInfo?.website) || domainKey(meta?.historyId);
  const companyName = (analysis.companyInfo?.name || website || '').trim();
  if (!website && !companyName) return null;

  const id = website || `name:${normalizeText(companyName).replace(/\s+/g, '_')}`;
  const skus: CustomerProductSku[] = [];
  const categorySet = new Set<string>();
  let priceMin: number | undefined;
  let priceMax: number | undefined;

  const bumpPrice = (lo?: number, hi?: number) => {
    if (lo != null && lo > 0) priceMin = priceMin == null ? lo : Math.min(priceMin, lo);
    if (hi != null && hi > 0) priceMax = priceMax == null ? hi : Math.max(priceMax, hi);
  };

  const pushCat = (
    raw?: string,
    source: CustomerProductSku['source'] = 'category',
    price?: { min?: number; max?: number }
  ) => {
    const cat = normalizeCategoryLabel(raw);
    if (!cat) return;
    categorySet.add(cat);
    bumpPrice(price?.min, price?.max);
    const existing = skus.find((s) => s.source === source && s.category === cat && s.name === cat);
    if (existing) {
      if (price?.min != null && (existing.priceMinCny == null || price.min < existing.priceMinCny)) {
        existing.priceMinCny = price.min;
      }
      if (price?.max != null && (existing.priceMaxCny == null || price.max > existing.priceMaxCny)) {
        existing.priceMaxCny = price.max;
      }
      return;
    }
    skus.push({
      id: skuId(id, cat, skus.length),
      name: cat,
      category: cat,
      categoryRaw: raw,
      priceMinCny: price?.min,
      priceMaxCny: price?.max,
      source,
    });
  };

  const sellCatSet = new Set<string>();
  const procureCatSet = new Set<string>();
  const tagSet = new Set<string>();

  const addTags = (tags?: string[]) => {
    (tags || []).forEach((t) => {
      const x = (t || '').trim();
      if (x && x.length <= 32 && !/公开信息未找到/i.test(x)) tagSet.add(x);
    });
  };

  const packagingStyleSet = new Set<string>();
  const colorPaletteSet = new Set<string>();
  let buyCostMin: number | undefined;
  let buyCostMax: number | undefined;
  const bumpBuyCost = (v?: number) => {
    if (v == null || v <= 0) return;
    buyCostMin = buyCostMin == null ? v : Math.min(buyCostMin, v);
    buyCostMax = buyCostMax == null ? v : Math.max(buyCostMax, v);
  };

  (analysis.products || []).forEach((p, idx) => {
    const name = (p.name || '').trim();
    if (!name || /公开信息未找到/i.test(name)) return;
    const cat = normalizeCategoryLabel(p.category) || normalizeCategoryLabel(name) || '未分类产品';
    categorySet.add(cat);
    const role = p.role === 'procure' ? 'procure' : p.role === 'both' ? 'both' : 'sell';
    if (role === 'sell' || role === 'both') sellCatSet.add(cat);
    if (role === 'procure' || role === 'both') procureCatSet.add(cat);
    addTags(p.tags);
    const colors = (p.colors || '').trim();
    const packaging = (p.packaging || '').trim();
    splitDesignSignalTokens(colors).forEach((t) => colorPaletteSet.add(t));
    splitDesignSignalTokens(packaging).forEach((t) => packagingStyleSet.add(t));
    if (colors && !EMPTY_SIGNAL.test(colors)) addTags([`配色:${colors.slice(0, 28)}`]);
    if (packaging && !EMPTY_SIGNAL.test(packaging)) addTags([`包装:${packaging.slice(0, 28)}`]);
    const retail = parseMoney(p.retailPriceCNY) ?? parseMoney(p.retailPrice);
    const fob = parseMoney(p.estimatedFOBPriceCNY);
    bumpBuyCost(fob);
    const lo = parseMoney(p.priceMinCNY) ?? (retail != null && fob != null ? Math.min(retail, fob) : retail ?? fob);
    const hi = parseMoney(p.priceMaxCNY) ?? (retail != null && fob != null ? Math.max(retail, fob) : retail ?? fob);
    bumpPrice(lo, hi);
    skus.push({
      id: skuId(id, name, idx),
      name,
      category: cat,
      categoryRaw: p.category,
      priceMinCny: lo,
      priceMaxCny: hi,
      retailPrice: p.retailPrice,
      retailPriceCNY: retail,
      estimatedFOBPriceCNY: fob,
      source: role === 'procure' ? 'procure' : 'sku',
      keywordMatch: !!p.keywordMatch,
      role,
      tags: (p.tags || []).filter(Boolean).slice(0, 8),
      colors: colors && !EMPTY_SIGNAL.test(colors) ? colors : undefined,
      packaging: packaging && !EMPTY_SIGNAL.test(packaging) ? packaging : undefined,
    });
  });

  (analysis.businessScope?.coreProducts || []).forEach((c) => {
    pushCat(c, 'core');
    const n = normalizeCategoryLabel(c);
    if (n) sellCatSet.add(n);
  });
  (analysis.businessScope?.relevantProducts || []).forEach((c) => {
    pushCat(c, 'core');
    const n = normalizeCategoryLabel(c);
    if (n) sellCatSet.add(n);
  });
  (analysis.tradeIntelligence?.importCategories || []).forEach((c) => {
    pushCat(c, 'trade');
    const n = normalizeCategoryLabel(c);
    if (n) procureCatSet.add(n);
  });
  (analysis.websiteCategories || []).forEach((wc) => {
    const lo = parseMoney(wc.priceMinCNY);
    const hi = parseMoney(wc.priceMaxCNY);
    pushCat(wc.categoryName, 'website', { min: lo, max: hi });
    const n = normalizeCategoryLabel(wc.categoryName);
    if (n) sellCatSet.add(n);
    (wc.items || []).slice(0, 8).forEach((item) => pushCat(item, 'website', { min: lo, max: hi }));
  });

  const intel = analysis.productIntel;
  (intel?.sell?.categories || []).forEach((c) => {
    pushCat(c, 'website');
    const n = normalizeCategoryLabel(c);
    if (n) sellCatSet.add(n);
  });
  (intel?.sell?.items || []).forEach((item) => pushCat(item, 'sku'));
  addTags(intel?.sell?.tags);
  (intel?.procure?.categories || []).forEach((c) => {
    pushCat(c, 'procure');
    const n = normalizeCategoryLabel(c);
    if (n) procureCatSet.add(n);
  });
  (intel?.procure?.items || []).forEach((item) => {
    const cat = normalizeCategoryLabel(item) || item;
    if (!cat) return;
    categorySet.add(cat);
    procureCatSet.add(cat);
    skus.push({
      id: skuId(id, item, skus.length),
      name: item,
      category: cat,
      source: 'procure',
      role: 'procure',
    });
  });
  addTags(intel?.procure?.tags);
  addTags(intel?.matchTags);

  if (analysis.searchKeyword) pushCat(analysis.searchKeyword, 'category');

  const categories = [...categorySet];
  if (!skus.length && !categories.length) return null;

  const priceBand =
    priceMin != null || priceMax != null
      ? `¥${priceMin ?? '?'}–${priceMax ?? '?'}`
      : analysis.businessScope?.priceSensitivity || undefined;

  const searchKeywords = [
    ...(analysis.searchKeyword ? [analysis.searchKeyword] : []),
    ...((analysis.searchTags || [])
      .filter((t) => t.startsWith('关键词:'))
      .map((t) => t.replace(/^关键词:/, '').trim())
      .filter(Boolean) as string[]),
  ];

  const sellCategories = [...sellCatSet];
  const procureCategories = [...procureCatSet];

  const packagingSummary = preferLongerText(
    undefined,
    analysis.productSummary?.packagingAnalysis
  );
  const colorPreference = preferLongerText(
    undefined,
    analysis.productSummary?.colorPreference
  );
  splitDesignSignalTokens(packagingSummary, 8).forEach((t) => packagingStyleSet.add(t));
  splitDesignSignalTokens(colorPreference, 8).forEach((t) => colorPaletteSet.add(t));

  const typicalMoq = (analysis.tradeIntelligence?.typicalMoq || '').trim();
  const buyingSeasons = (analysis.tradeIntelligence?.buyingSeasons || '').trim();
  const procureInfo = (analysis.businessModel?.procurementInfo || '').trim();
  const volumeSignal = (analysis.tradeIntelligence?.estimatedAnnualImport || '').trim();
  const procurementCycle = [buyingSeasons, typicalMoq, procureInfo]
    .filter((s) => s && !EMPTY_SIGNAL.test(s))
    .join(' · ')
    .slice(0, 240);

  if (typicalMoq && !EMPTY_SIGNAL.test(typicalMoq)) addTags([`MOQ:${typicalMoq.slice(0, 24)}`]);
  if (buyingSeasons && !EMPTY_SIGNAL.test(buyingSeasons)) {
    addTags([`旺季:${buyingSeasons.slice(0, 24)}`]);
  }

  const packagingStyles = [...packagingStyleSet].slice(0, 20);
  const colorPalettes = [...colorPaletteSet].slice(0, 20);
  packagingStyles.forEach((t) => tagSet.add(`包装:${t}`.slice(0, 32)));
  colorPalettes.forEach((t) => tagSet.add(`配色:${t}`.slice(0, 32)));

  const productTags = [...tagSet].slice(0, 48);
  const skuCount = skus.filter((s) => s.source === 'sku' || s.source === 'procure').length;
  const catalogQuality = Math.min(
    100,
    Math.round(
      Math.min(40, categories.length * 5) +
        Math.min(30, skuCount * 3) +
        Math.min(15, sellCategories.length * 3) +
        Math.min(15, procureCategories.length * 4) +
        Math.min(10, productTags.length * 2)
    )
  );

  let designSignalQuality = 0;
  if (packagingStyles.length || packagingSummary) designSignalQuality += 25;
  if (colorPalettes.length || colorPreference) designSignalQuality += 25;
  if (priceMin != null || priceMax != null) designSignalQuality += 20;
  if (buyCostMin != null || buyCostMax != null) designSignalQuality += 15;
  if (procurementCycle) designSignalQuality += 10;
  if (volumeSignal && !EMPTY_SIGNAL.test(volumeSignal)) designSignalQuality += 5;
  designSignalQuality = Math.min(100, designSignalQuality);

  return {
    id,
    companyName: companyName || id,
    website: website || '',
    country:
      analysis.searchCountry ||
      analysis.companyInfo?.headquarters?.split(',').pop()?.trim() ||
      analysis.companyInfo?.city ||
      undefined,
    historyId: meta?.historyId,
    crmClientId: meta?.crmClientId,
    categories,
    sellCategories,
    procureCategories,
    productTags,
    priceMinCny: priceMin,
    priceMaxCny: priceMax,
    priceBand,
    skus: skus.slice(0, 100),
    importCategories: analysis.tradeIntelligence?.importCategories,
    hsCodes: analysis.tradeIntelligence?.hsCodes,
    coreProducts: analysis.businessScope?.coreProducts,
    searchKeywords: [...new Set(searchKeywords)],
    catalogQuality,
    hasSellProcureSplit: sellCategories.length > 0 && procureCategories.length > 0,
    packagingStyles,
    colorPalettes,
    packagingSummary: packagingSummary && !EMPTY_SIGNAL.test(packagingSummary) ? packagingSummary : undefined,
    colorPreference: colorPreference && !EMPTY_SIGNAL.test(colorPreference) ? colorPreference : undefined,
    buyCostMinCny: buyCostMin,
    buyCostMaxCny: buyCostMax,
    typicalMoq: typicalMoq && !EMPTY_SIGNAL.test(typicalMoq) ? typicalMoq : undefined,
    buyingSeasons: buyingSeasons && !EMPTY_SIGNAL.test(buyingSeasons) ? buyingSeasons : undefined,
    procurementCycle: procurementCycle || undefined,
    volumeSignal: volumeSignal && !EMPTY_SIGNAL.test(volumeSignal) ? volumeSignal : undefined,
    designSignalQuality,
    updatedAt: Date.now(),
    ownerUsername: meta?.ownerUsername,
    departmentId: meta?.departmentId,
  };
};

/** 合并画像：保留更完整的设计信号与 SKU */
export const mergeProductProfiles = (
  prev: CustomerProductProfile,
  built: CustomerProductProfile
): CustomerProductProfile => {
  const skuMap = new Map<string, CustomerProductSku>();
  [...(prev.skus || []), ...(built.skus || [])].forEach((s) => {
    const key = `${s.source}|${normalizeText(s.name)}|${s.category}`;
    const old = skuMap.get(key);
    if (!old) {
      skuMap.set(key, s);
      return;
    }
    skuMap.set(key, {
      ...old,
      ...s,
      tags: unionStrings(old.tags, s.tags).slice(0, 8),
      colors: preferLongerText(old.colors, s.colors),
      packaging: preferLongerText(old.packaging, s.packaging),
      priceMinCny:
        old.priceMinCny != null && s.priceMinCny != null
          ? Math.min(old.priceMinCny, s.priceMinCny)
          : old.priceMinCny ?? s.priceMinCny,
      priceMaxCny:
        old.priceMaxCny != null && s.priceMaxCny != null
          ? Math.max(old.priceMaxCny, s.priceMaxCny)
          : old.priceMaxCny ?? s.priceMaxCny,
      retailPriceCNY: s.retailPriceCNY ?? old.retailPriceCNY,
      estimatedFOBPriceCNY: s.estimatedFOBPriceCNY ?? old.estimatedFOBPriceCNY,
    });
  });

  const priceMin =
    prev.priceMinCny != null && built.priceMinCny != null
      ? Math.min(prev.priceMinCny, built.priceMinCny)
      : prev.priceMinCny ?? built.priceMinCny;
  const priceMax =
    prev.priceMaxCny != null && built.priceMaxCny != null
      ? Math.max(prev.priceMaxCny, built.priceMaxCny)
      : prev.priceMaxCny ?? built.priceMaxCny;
  const buyMin =
    prev.buyCostMinCny != null && built.buyCostMinCny != null
      ? Math.min(prev.buyCostMinCny, built.buyCostMinCny)
      : prev.buyCostMinCny ?? built.buyCostMinCny;
  const buyMax =
    prev.buyCostMaxCny != null && built.buyCostMaxCny != null
      ? Math.max(prev.buyCostMaxCny, built.buyCostMaxCny)
      : prev.buyCostMaxCny ?? built.buyCostMaxCny;

  const packagingStyles = unionStrings(prev.packagingStyles, built.packagingStyles).slice(0, 20);
  const colorPalettes = unionStrings(prev.colorPalettes, built.colorPalettes).slice(0, 20);
  const productTags = unionStrings(prev.productTags, built.productTags).slice(0, 48);
  const sellCategories = unionStrings(prev.sellCategories, built.sellCategories);
  const procureCategories = unionStrings(prev.procureCategories, built.procureCategories);
  const categories = unionStrings(prev.categories, built.categories);
  const catalogQuality = Math.max(prev.catalogQuality || 0, built.catalogQuality || 0);
  const designSignalQuality = Math.max(
    prev.designSignalQuality || 0,
    built.designSignalQuality || 0
  );

  return {
    ...prev,
    ...built,
    companyName: built.companyName || prev.companyName,
    website: built.website || prev.website,
    country: built.country || prev.country,
    historyId: built.historyId || prev.historyId,
    crmClientId: built.crmClientId || prev.crmClientId,
    categories,
    sellCategories,
    procureCategories,
    productTags,
    priceMinCny: priceMin,
    priceMaxCny: priceMax,
    priceBand:
      priceMin != null || priceMax != null
        ? `¥${priceMin ?? '?'}–${priceMax ?? '?'}`
        : built.priceBand || prev.priceBand,
    skus: [...skuMap.values()].slice(0, 100),
    importCategories: unionStrings(prev.importCategories, built.importCategories),
    hsCodes: unionStrings(prev.hsCodes, built.hsCodes),
    coreProducts: unionStrings(prev.coreProducts, built.coreProducts),
    searchKeywords: unionStrings(prev.searchKeywords, built.searchKeywords),
    catalogQuality,
    hasSellProcureSplit: sellCategories.length > 0 && procureCategories.length > 0,
    packagingStyles,
    colorPalettes,
    packagingSummary: preferLongerText(prev.packagingSummary, built.packagingSummary),
    colorPreference: preferLongerText(prev.colorPreference, built.colorPreference),
    buyCostMinCny: buyMin,
    buyCostMaxCny: buyMax,
    typicalMoq: preferLongerText(prev.typicalMoq, built.typicalMoq),
    buyingSeasons: preferLongerText(prev.buyingSeasons, built.buyingSeasons),
    procurementCycle: preferLongerText(prev.procurementCycle, built.procurementCycle),
    volumeSignal: preferLongerText(prev.volumeSignal, built.volumeSignal),
    designSignalQuality,
    updatedAt: Math.max(prev.updatedAt || 0, built.updatedAt || 0, Date.now()),
    ownerUsername: built.ownerUsername || prev.ownerUsername,
    departmentId: built.departmentId || prev.departmentId,
  };
};

export const upsertProductProfile = async (
  profile: CustomerProductProfile,
  syncCloud = true
): Promise<void> => {
  await saveProductProfile(profile);
  if (syncCloud) {
    void saveProductProfileCloud(profile).catch((e) =>
      console.warn('[productCatalog] cloud save failed', e)
    );
  }
};

/** 背调完成后写入产品库 */
export const indexAnalysisIntoProductCatalog = async (
  analysis: AnalysisResult,
  meta?: {
    historyId?: string;
    crmClientId?: string;
    ownerUsername?: string;
    departmentId?: string;
  }
): Promise<CustomerProductProfile | null> => {
  const profile = buildProductProfileFromAnalysis(analysis, meta);
  if (!profile) return null;
  await upsertProductProfile(profile);
  return profile;
};

const profileRicherThan = (built: CustomerProductProfile, prev: CustomerProductProfile): boolean => {
  const designGain =
    (built.designSignalQuality || 0) > (prev.designSignalQuality || 0) ||
    (built.packagingStyles || []).length > (prev.packagingStyles || []).length ||
    (built.colorPalettes || []).length > (prev.colorPalettes || []).length ||
    ((built.buyCostMinCny != null || built.buyCostMaxCny != null) &&
      prev.buyCostMinCny == null &&
      prev.buyCostMaxCny == null) ||
    (!!(built.procurementCycle || built.buyingSeasons || built.typicalMoq) &&
      !(prev.procurementCycle || prev.buyingSeasons || prev.typicalMoq));
  const catalogGain =
    (built.catalogQuality || 0) > (prev.catalogQuality || 0) + 5 ||
    (built.skus || []).length > (prev.skus || []).length ||
    (built.productTags || []).length > (prev.productTags || []).length;
  return designGain || catalogGain;
};

/** 从历史记录批量重建产品库（不覆盖更新时间更近的已有条目，除非 force；fillGaps 时合并更完整信号） */
export const rebuildProductCatalogFromHistory = async (
  history: HistoryItem[],
  opts?: { force?: boolean; fillGaps?: boolean; ownerUsername?: string; departmentId?: string }
): Promise<{ upserted: number; enriched: number; skipped: number }> => {
  const existing = await getProductProfiles();
  const map = new Map(existing.map((p) => [p.id, p]));
  let upserted = 0;
  let enriched = 0;
  let skipped = 0;
  const batch: CustomerProductProfile[] = [];

  for (const h of history) {
    if (!h?.data) {
      skipped += 1;
      continue;
    }
    const built = buildProductProfileFromAnalysis(h.data, {
      historyId: h.id,
      ownerUsername: h.ownerUsername || opts?.ownerUsername,
      departmentId: h.departmentId || opts?.departmentId,
    });
    if (!built) {
      skipped += 1;
      continue;
    }
    const prev = map.get(built.id);
    if (!prev) {
      const next = {
        ...built,
        updatedAt: Math.max(built.updatedAt, h.timestamp || 0),
        historyId: h.id,
      };
      map.set(next.id, next);
      batch.push(next);
      upserted += 1;
      continue;
    }

    const richer = profileRicherThan(built, prev);
    const stalePrev =
      (prev.updatedAt || 0) <= (h.timestamp || 0) && prev.skus.length < built.skus.length;
    const shouldWrite = opts?.force || opts?.fillGaps || richer || stalePrev;

    if (!shouldWrite) {
      skipped += 1;
      continue;
    }

    const merged = mergeProductProfiles(prev, {
      ...built,
      updatedAt: Math.max(built.updatedAt, h.timestamp || 0, prev.updatedAt || 0),
      historyId: h.id,
    });
    map.set(merged.id, merged);
    batch.push(merged);
    if ((prev.skus || []).length || (prev.categories || []).length) enriched += 1;
    else upserted += 1;
  }

  if (batch.length) {
    await saveProductProfilesBulk(batch);
    void syncProductProfilesCloud(batch).catch((e) =>
      console.warn('[productCatalog] bulk cloud sync failed', e)
    );
  }
  return { upserted, enriched, skipped };
};

/** A：从历史补洞（合并设计信号，不整库强刷） */
export const backfillProductCatalogFromHistory = async (
  history: HistoryItem[],
  opts?: { ownerUsername?: string; departmentId?: string }
) => rebuildProductCatalogFromHistory(history, { ...opts, fillGaps: true });

/** 覆盖度报表：空白标签 / 缺色包价周期 */
export const buildCatalogCoverageReport = (
  history: HistoryItem[],
  profiles: CustomerProductProfile[],
  crmClients?: Array<{ id: string; name: string; website?: string; tags?: string[]; productType?: string }>
): CatalogCoverageReport => {
  const profileByDomain = new Map<string, CustomerProductProfile>();
  const profileByHistory = new Map<string, CustomerProductProfile>();
  for (const p of profiles) {
    const d = domainKey(p.website) || p.id;
    if (d) profileByDomain.set(d, p);
    if (p.historyId) profileByHistory.set(p.historyId, p);
  }

  /**
   * 性能关键：禁止对全量 history 逐条 buildProductProfileFromAnalysis（2k+ 会卡死 UI）。
   * 缺口优先扫已有 profiles；无画像的历史只做轻量占位，不重建报告。
   */
  const gaps: CatalogCoverageRow[] = [];
  const seenGap = new Set<string>();

  for (const p of profiles) {
    const missing = missingKindsForProfile(p);
    if (missing.length < 2 && profileHasDesignSignals(p)) continue;
    const id = p.id || p.historyId || p.website || p.companyName;
    if (!id || seenGap.has(id)) continue;
    seenGap.add(id);
    gaps.push({
      id: p.id,
      companyName: p.companyName,
      website: p.website,
      historyId: p.historyId,
      crmClientId: p.crmClientId,
      missing,
      catalogQuality: p.catalogQuality || 0,
      designSignalQuality: p.designSignalQuality || 0,
    });
  }

  let historyWithReport = 0;
  let noProfileGaps = 0;
  const MAX_NO_PROFILE_GAPS = 40;
  for (const h of history) {
    if (!h?.data) continue;
    historyWithReport += 1;
    const domain = domainKey(h.data.companyInfo?.website) || domainKey(h.domain) || '';
    const existing =
      (h.id && profileByHistory.get(h.id)) ||
      (domain && profileByDomain.get(domain)) ||
      null;
    if (existing) continue;
    if (noProfileGaps >= MAX_NO_PROFILE_GAPS) continue;
    const gid = h.id || domain;
    if (!gid || seenGap.has(gid)) continue;
    seenGap.add(gid);
    noProfileGaps += 1;
    gaps.push({
      id: h.id,
      companyName: h.data.companyInfo?.name || h.domain || h.id,
      website: domain,
      historyId: h.id,
      missing: ['tags', 'packaging', 'colors', 'price', 'buyCost', 'cycle', 'volume'],
      catalogQuality: 0,
      designSignalQuality: 0,
    });
  }

  let withTags = 0;
  let withPackaging = 0;
  let withColors = 0;
  let withPrice = 0;
  let withBuyCost = 0;
  let withCycle = 0;
  let withVolume = 0;
  let designReady = 0;
  for (const p of profiles) {
    if ((p.productTags || []).length > 0) withTags += 1;
    if ((p.packagingStyles || []).length > 0 || !!(p.packagingSummary || '').trim()) withPackaging += 1;
    if ((p.colorPalettes || []).length > 0 || !!(p.colorPreference || '').trim()) withColors += 1;
    if (p.priceMinCny != null || p.priceMaxCny != null) withPrice += 1;
    if (p.buyCostMinCny != null || p.buyCostMaxCny != null) withBuyCost += 1;
    if (!!(p.procurementCycle || p.buyingSeasons || p.typicalMoq || '').trim()) withCycle += 1;
    if (!!(p.volumeSignal || '').trim()) withVolume += 1;
    if (profileHasDesignSignals(p)) designReady += 1;
  }

  let crmBlankProductTags = 0;
  for (const c of crmClients || []) {
    const tags = c.tags || [];
    const hasProductTag =
      tags.some((t) => /^(在售:|采购:|包装:|配色:)/.test(t)) ||
      tags.some((t) => (t || '').length > 0 && !t.startsWith('关键词:') && !t.startsWith('国家:'));
    const hasType = !!(c.productType || '').trim() && c.productType !== 'N/A';
    if (!hasProductTag && !hasType) crmBlankProductTags += 1;
  }

  // 缺口按缺失数量排序，最多返回 40 条供看板（减少 DOM）
  gaps.sort((a, b) => b.missing.length - a.missing.length || a.designSignalQuality - b.designSignalQuality);

  return {
    historyWithReport,
    profilesTotal: profiles.length,
    withTags,
    withPackaging,
    withColors,
    withPrice,
    withBuyCost,
    withCycle,
    withVolume,
    designReady,
    crmBlankProductTags,
    gaps: gaps.slice(0, 40),
  };
};

const tokensOf = (s: string) =>
  normalizeText(s)
    .split(/[\s,/|+\-，、&]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

const priceRangesOverlap = (
  aMin?: number,
  aMax?: number,
  bMin?: number,
  bMax?: number
): boolean => {
  if (aMin == null && aMax == null) return false;
  if (bMin == null && bMax == null) return false;
  const aLo = aMin ?? aMax!;
  const aHi = aMax ?? aMin!;
  const bLo = bMin ?? bMax!;
  const bHi = bMax ?? bMin!;
  // 允许 30% 容差
  const pad = (v: number) => v * 0.3;
  return aLo - pad(aLo) <= bHi + pad(bHi) && bLo - pad(bLo) <= aHi + pad(aHi);
};

/** 仅用背调入库的真实品类/SKU/标签打分；理由必须可追溯到库字段 */
export const matchOurProductToProfiles = (
  query: OurProductMatchQuery,
  profiles: CustomerProductProfile[]
): ProductMatchHit[] => {
  const name = (query.name || '').trim();
  const category = normalizeCategoryLabel(query.category) || normalizeCategoryLabel(name);
  const qTokens = [
    ...new Set([
      ...tokensOf(name),
      ...tokensOf(query.category || ''),
      ...tokensOf(query.notes || ''),
      ...(query.packagingHints || []).flatMap((h) => tokensOf(h)),
      ...(query.colorHints || []).flatMap((h) => tokensOf(h)),
    ]),
  ];
  const packHints = (query.packagingHints || []).map((h) => normalizeText(h)).filter(Boolean);
  const colorHints = (query.colorHints || []).map((h) => normalizeText(h)).filter(Boolean);
  const countries = (query.countries || []).map((c) => c.trim().toLowerCase()).filter(Boolean);

  const hits: ProductMatchHit[] = [];

  for (const profile of profiles) {
    // 无真实产品数据的空壳画像不参与匹配
    const quality = profile.catalogQuality ?? 0;
    const hasReal =
      (profile.skus || []).length > 0 ||
      (profile.categories || []).length > 0 ||
      (profile.sellCategories || []).length > 0 ||
      (profile.procureCategories || []).length > 0;
    if (!hasReal || quality < 8) continue;

    if (countries.length) {
      const pc = (profile.country || '').toLowerCase();
      if (pc && !countries.some((c) => pc.includes(c) || c.includes(pc))) continue;
    }

    let score = 0;
    const reasons: string[] = [];
    const matchedCategories: string[] = [];

    const sellCats = profile.sellCategories?.length
      ? profile.sellCategories
      : profile.categories;
    const procureCats = [
      ...(profile.procureCategories || []),
      ...(profile.importCategories || []),
    ];

    // 采购侧命中（出口匹配优先：对方会买什么）
    for (const cat of procureCats) {
      const nCat = normalizeCategoryLabel(cat) || cat;
      if (category && (nCat === category || nCat.includes(category) || category.includes(nCat))) {
        score += 48;
        matchedCategories.push(nCat);
        reasons.push(`采购/进口品类命中（库内）：${nCat}`);
        break;
      }
    }

    // 在售侧命中
    for (const cat of sellCats) {
      const nCat = normalizeCategoryLabel(cat) || cat;
      if (category && (nCat === category || nCat.includes(category) || category.includes(nCat))) {
        if (!matchedCategories.includes(nCat)) {
          score += matchedCategories.length ? 18 : 40;
          matchedCategories.push(nCat);
          reasons.push(`在售品类命中（库内）：${nCat}`);
        }
        break;
      }
    }

    // 具体 SKU 名称命中
    const skuHit = (profile.skus || []).find((s) => {
      const blob = `${s.name} ${s.category}`.toLowerCase();
      return qTokens.some((t) => t.length > 1 && blob.includes(t));
    });
    if (skuHit) {
      score += 22;
      reasons.push(
        `SKU 线索命中（库内「${skuHit.name}」/${skuHit.role === 'procure' ? '采购' : '在售'}）`
      );
    }

    // 标签命中
    const tags = profile.productTags || [];
    const tagHits = tags.filter((t) =>
      qTokens.some((tok) => normalizeText(t).includes(tok) || tok.includes(normalizeText(t)))
    );
    if (tagHits.length) {
      score += Math.min(20, tagHits.length * 6);
      reasons.push(`标签命中（库内）：${tagHits.slice(0, 3).join('、')}`);
    }

    // 近义品类（仍须落在库内品类上）
    if (category && !matchedCategories.length) {
      for (const a of CATEGORY_ALIASES) {
        const inQuery =
          a.keys.some((k) => normalizeText(category).includes(normalizeText(k))) ||
          a.label === category;
        if (!inQuery) continue;
        const pool = [...sellCats, ...procureCats, ...profile.categories];
        const hit = pool.some((c) => {
          const nc = normalizeCategoryLabel(c) || c;
          return nc === a.label || a.keys.some((k) => normalizeText(c).includes(normalizeText(k)));
        });
        if (hit) {
          score += 26;
          matchedCategories.push(a.label);
          reasons.push(`近义品类（库内）：${a.label}`);
          break;
        }
      }
    }

    const priceOverlap = priceRangesOverlap(
      query.priceMinCny,
      query.priceMaxCny,
      profile.priceMinCny,
      profile.priceMaxCny
    );
    if (priceOverlap) {
      score += 16;
      reasons.push(`价格区间重叠（库内 ${profile.priceBand || '有价位'}）`);
    }

    // 采购成本带（FOB 推算）与我方报价重叠
    const buyOverlap = priceRangesOverlap(
      query.priceMinCny,
      query.priceMaxCny,
      profile.buyCostMinCny,
      profile.buyCostMaxCny
    );
    if (buyOverlap) {
      score += 10;
      reasons.push(
        `采购成本带贴近（库内 ¥${profile.buyCostMinCny ?? '?'}–${profile.buyCostMaxCny ?? '?'}）`
      );
    }

    // 包装 / 配色：设计完成后的显式提示优先，其次备注/品名词元
    const packHits = (profile.packagingStyles || []).filter((t) => {
      const nt = normalizeText(t);
      return (
        packHints.some((h) => nt.includes(h) || h.includes(nt)) ||
        qTokens.some((tok) => nt.includes(tok) || tok.includes(nt))
      );
    });
    if (packHits.length) {
      score += Math.min(packHints.length ? 18 : 12, packHits.length * 5);
      reasons.push(`包装形态贴近（库内）：${packHits.slice(0, 2).join('、')}`);
    }
    const colorHits = (profile.colorPalettes || []).filter((t) => {
      const nt = normalizeText(t);
      return (
        colorHints.some((h) => nt.includes(h) || h.includes(nt)) ||
        qTokens.some((tok) => nt.includes(tok) || tok.includes(nt))
      );
    });
    if (colorHits.length) {
      score += Math.min(colorHints.length ? 18 : 12, colorHits.length * 5);
      reasons.push(`配色贴近（库内）：${colorHits.slice(0, 2).join('、')}`);
    }

    if (profile.skus.some((s) => s.source === 'sku')) {
      score += 6;
      reasons.push(`含 ${profile.skus.filter((s) => s.source === 'sku').length} 条具体 SKU 记录`);
    }
    if (profile.hasSellProcureSplit) {
      score += 8;
      reasons.push('背调已区分在售/采购双边数据');
    }
    if (profileHasDesignSignals(profile)) {
      score += 4;
      reasons.push('含包装/配色/价带等设计匹配信号');
    }

    // 无任何库内命中理由 → 丢弃（禁止空理由凑分）
    if (!reasons.length) continue;

    score = Math.min(100, Math.round(score));
    if (score < 22) continue;

    hits.push({
      profile,
      score,
      reasons: reasons.slice(0, 6),
      matchedCategories: [...new Set(matchedCategories)],
      priceOverlap,
    });
  }

  return hits.sort((a, b) => b.score - a.score);
};

/** 内存缓存：避免匹配页每次击键/适市卡都 getAll 两千条画像卡死 UI */
let productCatalogMemCache: { at: number; rows: CustomerProductProfile[] } | null = null;
const CATALOG_CACHE_TTL_MS = 90_000;

export const invalidateProductCatalogCache = (): void => {
  productCatalogMemCache = null;
};

export const loadProductCatalog = async (opts?: {
  force?: boolean;
}): Promise<CustomerProductProfile[]> => {
  if (
    !opts?.force &&
    productCatalogMemCache &&
    Date.now() - productCatalogMemCache.at < CATALOG_CACHE_TTL_MS
  ) {
    return productCatalogMemCache.rows;
  }
  const local = await getProductProfiles();
  const rows = local.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  productCatalogMemCache = { at: Date.now(), rows };
  return rows;
};

/** CRM 是否已有产品/设计向标签 */
export const crmHasDesignProductTags = (client: {
  tags?: string[];
  productType?: string;
}): boolean => {
  const tags = client.tags || [];
  if (tags.some((t) => /^(在售:|采购:|包装:|配色:|MOQ:|旺季:)/.test(String(t || '')))) {
    return true;
  }
  const pt = (client.productType || '').trim();
  return !!pt && pt !== 'N/A';
};

/**
 * CRM 空白客户（阶段 C）：缺设计匹配信号 / 产品标签。
 * 须有官网，才能轻量补采。
 */
export const isCrmClientBlankForDesignFill = (
  client: { id: string; name?: string; website?: string; tags?: string[]; productType?: string },
  profile?: CustomerProductProfile | null
): boolean => {
  if (!(client.website || '').trim()) return false;
  if (crmHasDesignProductTags(client) && profileHasDesignSignals(profile)) return false;
  if (profileHasDesignSignals(profile) && (profile?.catalogQuality || 0) >= 30) return false;
  if (crmHasDesignProductTags(client) && (profile?.designSignalQuality || 0) >= 40) return false;
  return true;
};

/** 列出 CRM 中待轻量补全的空白客户 */
export const listBlankCrmClientsForDesignFill = <
  T extends { id: string; name?: string; website?: string; tags?: string[]; productType?: string },
>(
  clients: T[],
  profiles: CustomerProductProfile[]
): T[] => {
  const byDomain = new Map<string, CustomerProductProfile>();
  const byId = new Map<string, CustomerProductProfile>();
  for (const p of profiles) {
    const d = domainKey(p.website) || p.id;
    if (d) byDomain.set(d, p);
    if (p.crmClientId) byId.set(p.crmClientId, p);
  }
  return clients.filter((c) => {
    const d = domainKey(c.website);
    const profile = byId.get(c.id) || (d ? byDomain.get(d) : undefined) || null;
    return isCrmClientBlankForDesignFill(c, profile);
  });
};

export const removeProductProfile = async (id: string): Promise<void> => {
  await deleteProductProfile(id);
  void deleteProductProfileCloud(id).catch(() => undefined);
};

export { domainKey as productCatalogDomainKey };

/**
 * 报告是否已含「全站品类 + 价格」可用数据。
 * 新背调应达到此标准；未达标的旧报告才需要「产品深挖」补做。
 */
export const hasRichProductCatalog = (analysis?: AnalysisResult | null): boolean => {
  if (!analysis) return false;
  const cats = analysis.websiteCategories || [];
  const products = analysis.products || [];
  const intel = analysis.productIntel;
  const importCats = analysis.tradeIntelligence?.importCategories || [];

  const catsWithPrice = cats.filter((c) => {
    const band = (c.priceBand || '').trim();
    if (band && band !== '待补价格' && !/^n\/?a$/i.test(band)) return true;
    return (
      (typeof c.priceMinCNY === 'number' && c.priceMinCNY > 0) ||
      (typeof c.priceMaxCNY === 'number' && c.priceMaxCNY > 0)
    );
  });

  const productsPriced = products.filter((p) => {
    const hasCat = !!(p.category || '').trim();
    const hasPrice =
      (typeof p.priceMinCNY === 'number' && p.priceMinCNY > 0) ||
      (typeof p.priceMaxCNY === 'number' && p.priceMaxCNY > 0) ||
      (typeof p.retailPriceCNY === 'number' && p.retailPriceCNY > 0) ||
      (typeof p.estimatedFOBPriceCNY === 'number' && p.estimatedFOBPriceCNY > 0) ||
      !!(p.retailPrice || '').trim();
    return hasCat && hasPrice;
  });

  const sellSide =
    (intel?.sell?.categories || []).length >= 2 ||
    catsWithPrice.length >= 3 ||
    productsPriced.filter((p) => p.role !== 'procure').length >= 4;
  const procureSide =
    (intel?.procure?.categories || []).length >= 1 ||
    importCats.length >= 1 ||
    productsPriced.some((p) => p.role === 'procure' || p.role === 'both') ||
    (analysis.businessModel?.procurementInfo || '').trim().length > 8;

  const baseRich =
    catsWithPrice.length >= 3 ||
    productsPriced.length >= 5 ||
    (cats.length >= 4 && productsPriced.length >= 3) ||
    (catsWithPrice.length >= 2 && productsPriced.length >= 4);

  // 新标准：全站在售丰富，且尽量有采购侧线索（匹配出口才有意义）
  if (baseRich && sellSide && procureSide) return true;
  if (baseRich && sellSide && (intel?.matchTags || []).length >= 2) return true;
  return false;
};

