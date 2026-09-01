import React, { useMemo, useState } from 'react';
import { AnalysisResult, ProductAnalysis, WebsiteCategory } from '../types';
import {
  PackageSearch,
  Tag,
  Info,
  ShoppingCart,
  BarChart3,
  PieChart,
  Sparkles,
  Languages,
  Loader2,
  Layers,
  Filter,
  ShieldCheck,
} from 'lucide-react';
import {
  looksLikeEnglishParagraph,
  translateProductSummaryToZh,
} from '../services/geminiService';

interface ModuleProductsProps {
  data: AnalysisResult;
  onUpdateProductSummary?: (summary: NonNullable<AnalysisResult['productSummary']>) => void;
  onAddToCRM?: () => void;
}

const productMatchesKeyword = (p: ProductAnalysis, keyword?: string): boolean => {
  if (p.keywordMatch) return true;
  const kw = (keyword || '').trim().toLowerCase();
  if (!kw) return false;
  const tokens = kw.split(/[\s,/|+\-，、]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  const blob = `${p.name || ''} ${p.category || ''} ${p.features || ''} ${p.pitchPoint || ''} ${p.techSpecs || ''}`.toLowerCase();
  return tokens.some((t) => blob.includes(t));
};

const formatPriceBand = (
  min?: number | null,
  max?: number | null,
  fallback?: string
): string => {
  if (fallback?.trim()) return fallback.trim();
  if (min != null && max != null && min > 0 && max > 0) {
    return min === max ? `¥${min}` : `¥${min}–${max}`;
  }
  if (min != null && min > 0) return `¥${min}+`;
  if (max != null && max > 0) return `至 ¥${max}`;
  return '待补价格';
};

type CategoryRow = {
  name: string;
  items: string[];
  priceBand: string;
  skuCount: number;
  keywordHit: boolean;
};

/** 合并官网品类树 + 产品 SKU 聚合，补齐价格区间 */
const buildCategoryRows = (
  websiteCategories: WebsiteCategory[] | undefined,
  products: ProductAnalysis[],
  keyword?: string
): CategoryRow[] => {
  const map = new Map<string, CategoryRow & { min?: number; max?: number }>();

  const ensure = (name: string) => {
    const key = name.trim() || '未分类';
    let row = map.get(key);
    if (!row) {
      row = { name: key, items: [], priceBand: '待补价格', skuCount: 0, keywordHit: false };
      map.set(key, row);
    }
    return row;
  };

  (websiteCategories || []).forEach((wc) => {
    const row = ensure(wc.categoryName || '未分类');
    (wc.items || []).forEach((it) => {
      if (it && !row.items.includes(it)) row.items.push(it);
    });
    if (typeof wc.priceMinCNY === 'number' && wc.priceMinCNY > 0) {
      row.min = row.min == null ? wc.priceMinCNY : Math.min(row.min, wc.priceMinCNY);
    }
    if (typeof wc.priceMaxCNY === 'number' && wc.priceMaxCNY > 0) {
      row.max = row.max == null ? wc.priceMaxCNY : Math.max(row.max, wc.priceMaxCNY);
    }
    if (wc.priceBand?.trim()) row.priceBand = wc.priceBand.trim();
  });

  products.forEach((p) => {
    const cat = (p.category || '').trim() || '未分类';
    const row = ensure(cat);
    row.skuCount += 1;
    if (p.name && !row.items.includes(p.name) && row.items.length < 12) {
      row.items.push(p.name);
    }
    const lo = p.priceMinCNY ?? p.retailPriceCNY ?? p.estimatedFOBPriceCNY;
    const hi = p.priceMaxCNY ?? p.retailPriceCNY ?? p.estimatedFOBPriceCNY;
    if (typeof lo === 'number' && lo > 0) {
      row.min = row.min == null ? lo : Math.min(row.min, lo);
    }
    if (typeof hi === 'number' && hi > 0) {
      row.max = row.max == null ? hi : Math.max(row.max, hi);
    }
    if (productMatchesKeyword(p, keyword)) row.keywordHit = true;
  });

  return [...map.values()]
    .map((r) => ({
      name: r.name,
      items: r.items,
      skuCount: r.skuCount,
      keywordHit: r.keywordHit,
      priceBand: formatPriceBand(r.min, r.max, r.priceBand !== '待补价格' ? r.priceBand : undefined),
    }))
    .sort((a, b) => Number(b.keywordHit) - Number(a.keywordHit) || a.name.localeCompare(b.name, 'zh'));
};

export const ModuleProducts: React.FC<ModuleProductsProps> = ({ data, onUpdateProductSummary, onAddToCRM }) => {
  const keyword = (data.searchKeyword || '').trim();
  const [summary, setSummary] = useState(data.productSummary);
  const [translating, setTranslating] = useState(false);
  const [translateMsg, setTranslateMsg] = useState('');
  /** 默认展示全部品类/产品；可切到仅关键词相关 */
  const [viewMode, setViewMode] = useState<'all' | 'keyword'>('all');

  React.useEffect(() => {
    setSummary(data.productSummary);
  }, [data.productSummary]);

  const needsZh = useMemo(() => {
    if (!summary) return false;
    return (
      looksLikeEnglishParagraph(summary.marketPreference) ||
      looksLikeEnglishParagraph(summary.recommendedProducts) ||
      looksLikeEnglishParagraph(summary.packagingAnalysis) ||
      looksLikeEnglishParagraph(summary.colorPreference) ||
      looksLikeEnglishParagraph(summary.featureAnalysis)
    );
  }, [summary]);

  const allProducts = data.products || [];
  const categoryRows = useMemo(
    () => buildCategoryRows(data.websiteCategories, allProducts, keyword),
    [data.websiteCategories, allProducts, keyword]
  );

  const keywordProductCount = useMemo(
    () => allProducts.filter((p) => productMatchesKeyword(p, keyword)).length,
    [allProducts, keyword]
  );

  const displayedProducts = useMemo(() => {
    if (viewMode === 'keyword' && keyword) {
      const matched = allProducts.filter((p) => productMatchesKeyword(p, keyword));
      return matched.length ? matched : allProducts;
    }
    return allProducts;
  }, [allProducts, viewMode, keyword]);

  const displayedCategories = useMemo(() => {
    if (viewMode === 'keyword' && keyword) {
      const matched = categoryRows.filter((c) => c.keywordHit);
      return matched.length ? matched : categoryRows;
    }
    return categoryRows;
  }, [categoryRows, viewMode, keyword]);

  const handleTranslate = async () => {
    if (!summary) return;
    setTranslating(true);
    setTranslateMsg('正在译成简体中文…');
    try {
      const zh = await translateProductSummaryToZh(summary, keyword);
      setSummary(zh);
      onUpdateProductSummary?.(zh);
      setTranslateMsg('已译成中文并保存');
    } catch (e: any) {
      setTranslateMsg(`翻译失败：${e?.message || String(e)}`);
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <Layers size={16} className="text-emerald-700 mt-0.5 shrink-0" />
          <div className="text-sm text-emerald-900">
            <span className="font-black">全站品类采集</span>
            <span className="font-medium text-emerald-800/90">
              ：先爬取客户官网及其它平台的全部品类与价格区间，再标注与搜索关键词的匹配。
            </span>
            {keyword ? (
              <span className="block mt-1 text-xs font-bold text-violet-700">
                当前关键词「{keyword}」已匹配 {keywordProductCount}/{allProducts.length} 个 SKU · 品类 {categoryRows.filter((c) => c.keywordHit).length}/{categoryRows.length}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onAddToCRM && (
            <button
              type="button"
              onClick={onAddToCRM}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg touch-manipulation"
            >
              <ShieldCheck size={14} /> 导入 CRM
            </button>
          )}
        {keyword && (
          <div className="flex items-center gap-1 bg-white rounded-xl border border-emerald-100 p-1 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${
                viewMode === 'all' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              全部品类
            </button>
            <button
              type="button"
              onClick={() => setViewMode('keyword')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${
                viewMode === 'keyword' ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Filter size={12} />
              仅关键词
            </button>
          </div>
        )}
        </div>
      </div>

      {keyword && viewMode === 'keyword' && (
        <div className="bg-violet-50 border border-violet-100 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-2">
          <Sparkles size={16} className="text-violet-600" />
          <span className="text-sm font-black text-violet-800">当前筛选：与「{keyword}」相关</span>
          {data.searchTags?.slice(0, 4).map((t) => (
            <span key={t} className="text-[10px] font-black bg-white text-violet-600 px-2 py-0.5 rounded-lg border border-violet-100">
              {t}
            </span>
          ))}
        </div>
      )}

      {summary && (
        <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2 flex-wrap">
              <PieChart className="text-blue-600" /> 市场喜好与产品策略
            </h3>
            <button
              type="button"
              onClick={handleTranslate}
              disabled={translating}
              className="inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-sm font-black"
              title={needsZh ? '检测到英文内容，建议译成中文' : '再次用中文润色/翻译本段'}
            >
              {translating ? <Loader2 size={16} className="animate-spin" /> : <Languages size={16} />}
              {needsZh ? '一键译成中文' : '重新译成中文'}
            </button>
          </div>
          {translateMsg && (
            <p className={`text-xs font-bold mb-4 ${translateMsg.includes('失败') ? 'text-rose-600' : 'text-emerald-700'}`}>
              {translateMsg}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                <div className="text-[10px] font-black text-blue-700 uppercase tracking-widest mb-2 flex items-center gap-1"><ShoppingCart size={12}/> 终端市场喜好</div>
                <p className="text-sm font-bold text-blue-900 leading-relaxed">{summary.marketPreference}</p>
              </div>
              <div className="bg-purple-50 p-6 rounded-2xl border border-purple-100">
                <div className="text-[10px] font-black text-purple-700 uppercase tracking-widest mb-2 flex items-center gap-1"><Tag size={12}/> 推荐开发产品</div>
                <p className="text-sm font-bold text-purple-900 leading-relaxed">{summary.recommendedProducts}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="bg-white p-3 rounded-xl text-blue-600 shadow-sm"><PackageSearch size={20}/></div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">包装偏好分析</div>
                  <div className="text-sm font-bold text-slate-800 mt-1">{summary.packagingAnalysis}</div>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="bg-white p-3 rounded-xl text-pink-600 shadow-sm"><Tag size={20}/></div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">颜色偏好分析</div>
                  <div className="text-sm font-bold text-slate-800 mt-1">{summary.colorPreference}</div>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="bg-white p-3 rounded-xl text-green-600 shadow-sm"><BarChart3 size={20}/></div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">功能点/卖点分析</div>
                  <div className="text-sm font-bold text-slate-800 mt-1">{summary.featureAnalysis}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 全站品类 + 价格区间 */}
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-2xl font-black text-slate-800 mb-1 flex items-center gap-2">
          <Layers className="text-emerald-600" />
          全站品类一览
        </h3>
        <p className="text-sm font-medium text-slate-500 mb-6">
          共 {displayedCategories.length} 个品类
          {viewMode === 'all' && categoryRows.length !== displayedCategories.length
            ? ''
            : ''}
          ，每条标有价格区间（来自官网目录与 SKU 汇总）
        </p>

        {displayedCategories.length === 0 ? (
          <div className="py-8 text-center text-slate-400 font-bold">暂无品类数据，请重新背调或使用「产品品类深挖」</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {displayedCategories.map((cat) => (
              <div
                key={cat.name}
                className={`rounded-2xl border p-4 ${
                  cat.keywordHit
                    ? 'bg-violet-50/70 border-violet-100'
                    : 'bg-slate-50 border-slate-100'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="font-black text-slate-800 text-sm leading-snug">{cat.name}</div>
                  <div className="shrink-0 bg-emerald-600 text-white text-[10px] font-black px-2.5 py-1 rounded-full">
                    {cat.priceBand}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {cat.keywordHit && keyword && (
                    <span className="text-[10px] font-black bg-violet-600 text-white px-2 py-0.5 rounded-lg">
                      关键词相关
                    </span>
                  )}
                  {cat.skuCount > 0 && (
                    <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-100 px-2 py-0.5 rounded-lg">
                      {cat.skuCount} SKU
                    </span>
                  )}
                </div>
                {cat.items.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {cat.items.slice(0, 6).map((it) => (
                      <span
                        key={it}
                        className="text-[10px] font-bold text-slate-600 bg-white border border-slate-100 px-1.5 py-0.5 rounded"
                      >
                        {it.length > 22 ? `${it.slice(0, 20)}…` : it}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 全部产品 SKU */}
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-2xl font-black text-slate-800 mb-2 flex items-center gap-2">
          <PackageSearch className="text-blue-600" />
          {viewMode === 'keyword' && keyword
            ? `与「${keyword}」相关的产品`
            : '全部产品清单'}
        </h3>
        <p className="text-sm font-medium text-slate-500 mb-6">
          共 {displayedProducts.length} 条
          {keyword && viewMode === 'all'
            ? `（其中 ${keywordProductCount} 条与「${keyword}」相关，已打标）`
            : ''}
        </p>

        {displayedProducts.length === 0 ? (
          <div className="py-10 text-center text-slate-400 font-bold">暂无产品分析数据</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {displayedProducts.map((p, i) => (
              <ProductCard
                key={`p-${i}-${p.name}`}
                p={p}
                highlight={!!keyword && productMatchesKeyword(p, keyword)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const ProductCard: React.FC<{ p: ProductAnalysis; highlight: boolean }> = ({ p, highlight }) => (
  <div className={`p-6 rounded-3xl border transition-all group ${highlight ? 'bg-violet-50/60 border-violet-100 hover:border-violet-300' : 'bg-slate-50 border-slate-100 hover:border-blue-200'}`}>
    <div className="flex justify-between items-start mb-4 gap-2">
      <div className="min-w-0">
        <h4 className="text-lg font-black text-slate-800 group-hover:text-blue-600 transition-colors">{p.name}</h4>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {p.category && (
            <span className="inline-block text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-lg">
              {p.category}
            </span>
          )}
          {highlight && (
            <span className="inline-block text-[10px] font-black bg-violet-600 text-white px-2 py-0.5 rounded-lg">关键词相关</span>
          )}
        </div>
      </div>
      <div className="bg-blue-600 text-white px-3 py-1 rounded-full text-[10px] font-black shadow-md flex-shrink-0">{p.retailPrice || '—'}</div>
    </div>

    <div className="grid grid-cols-2 gap-4 mb-4">
      <div className="bg-white p-3 rounded-xl border border-slate-100">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">建议 FOB 价</div>
        <div className="text-sm font-black text-slate-800">
          {p.estimatedFOBPriceCNY ? `¥${p.estimatedFOBPriceCNY}` : '—'}
        </div>
      </div>
      <div className="bg-white p-3 rounded-xl border border-slate-100">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">价格区间 ¥</div>
        <div className="text-sm font-black text-slate-800">
          {p.priceMinCNY != null || p.priceMaxCNY != null
            ? `${p.priceMinCNY ?? '?'}–${p.priceMaxCNY ?? '?'}`
            : p.retailPriceCNY
              ? String(p.retailPriceCNY)
              : p.marginSpace || '—'}
        </div>
      </div>
    </div>

    <div className="space-y-3">
      {p.features && (
        <div className="flex items-start gap-2">
          <Info size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs font-bold text-slate-600"><span className="text-slate-400 uppercase tracking-tighter mr-1">功能:</span> {p.features}</div>
        </div>
      )}
      {p.colors && (
        <div className="flex items-start gap-2">
          <Tag size={14} className="text-pink-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs font-bold text-slate-600"><span className="text-slate-400 uppercase tracking-tighter mr-1">颜色:</span> {p.colors}</div>
        </div>
      )}
      {p.packaging && (
        <div className="flex items-start gap-2">
          <PackageSearch size={14} className="text-purple-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs font-bold text-slate-600"><span className="text-slate-400 uppercase tracking-tighter mr-1">包装:</span> {p.packaging}</div>
        </div>
      )}
    </div>
  </div>
);
