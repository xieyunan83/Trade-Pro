import React, { useMemo, useState } from 'react';
import { AnalysisResult, ProductAnalysis } from '../types';
import { PackageSearch, Tag, Info, ShoppingCart, BarChart3, PieChart, Sparkles, Languages, Loader2 } from 'lucide-react';
import {
  looksLikeEnglishParagraph,
  translateProductSummaryToZh,
} from '../services/geminiService';

interface ModuleProductsProps {
  data: AnalysisResult;
  onUpdateProductSummary?: (summary: NonNullable<AnalysisResult['productSummary']>) => void;
}

const productMatchesKeyword = (p: ProductAnalysis, keyword?: string): boolean => {
  if (p.keywordMatch) return true;
  const kw = (keyword || '').trim().toLowerCase();
  if (!kw) return false;
  const tokens = kw.split(/[\s,/|+\-，、]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  const blob = `${p.name || ''} ${p.features || ''} ${p.pitchPoint || ''} ${p.techSpecs || ''}`.toLowerCase();
  return tokens.some((t) => blob.includes(t));
};

export const ModuleProducts: React.FC<ModuleProductsProps> = ({ data, onUpdateProductSummary }) => {
  const keyword = (data.searchKeyword || '').trim();
  const [summary, setSummary] = useState(data.productSummary);
  const [translating, setTranslating] = useState(false);
  const [translateMsg, setTranslateMsg] = useState('');

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

  const { focused, others } = useMemo(() => {
    const list = data.products || [];
    if (!keyword) return { focused: list, others: [] as ProductAnalysis[] };
    const f: ProductAnalysis[] = [];
    const o: ProductAnalysis[] = [];
    for (const p of list) {
      if (productMatchesKeyword(p, keyword)) f.push(p);
      else o.push(p);
    }
    return { focused: f.length ? f : list, others: f.length ? o : [] };
  }, [data.products, keyword]);

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
      {keyword && (
        <div className="bg-violet-50 border border-violet-100 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-2">
          <Sparkles size={16} className="text-violet-600" />
          <span className="text-sm font-black text-violet-800">
            产品分析已按搜索关键词聚焦：{keyword}
          </span>
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
              {keyword ? <span className="text-sm font-bold text-violet-600">· {keyword}</span> : null}
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

      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-2xl font-black text-slate-800 mb-2 flex items-center gap-2">
          <PackageSearch className="text-blue-600" />
          {keyword ? `与「${keyword}」相关的产品` : '核心产品线分析'}
        </h3>
        {keyword && (
          <p className="text-sm font-medium text-slate-500 mb-6">
            优先展示与搜索关键词匹配的产品（共 {focused.length} 条）
            {others.length > 0 ? `；其余 ${others.length} 条为其它品类` : ''}
          </p>
        )}
        {!keyword && <div className="mb-6" />}

        {focused.length === 0 ? (
          <div className="py-10 text-center text-slate-400 font-bold">暂无产品分析数据</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {focused.map((p, i) => (
              <ProductCard key={`f-${i}`} p={p} highlight={!!keyword} />
            ))}
          </div>
        )}
      </div>

      {others.length > 0 && (
        <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-black text-slate-700 mb-4">其它产品线</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {others.map((p, i) => (
              <ProductCard key={`o-${i}`} p={p} highlight={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ProductCard: React.FC<{ p: ProductAnalysis; highlight: boolean }> = ({ p, highlight }) => (
  <div className={`p-6 rounded-3xl border transition-all group ${highlight ? 'bg-violet-50/60 border-violet-100 hover:border-violet-300' : 'bg-slate-50 border-slate-100 hover:border-blue-200'}`}>
    <div className="flex justify-between items-start mb-4 gap-2">
      <div className="min-w-0">
        <h4 className="text-lg font-black text-slate-800 group-hover:text-blue-600 transition-colors">{p.name}</h4>
        {highlight && (
          <span className="inline-block mt-1 text-[10px] font-black bg-violet-600 text-white px-2 py-0.5 rounded-lg">关键词相关</span>
        )}
      </div>
      <div className="bg-blue-600 text-white px-3 py-1 rounded-full text-[10px] font-black shadow-md flex-shrink-0">{p.retailPrice}</div>
    </div>
    
    <div className="grid grid-cols-2 gap-4 mb-4">
      <div className="bg-white p-3 rounded-xl border border-slate-100">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">建议 FOB 价</div>
        <div className="text-sm font-black text-slate-800">¥{p.estimatedFOBPriceCNY}</div>
      </div>
      <div className="bg-white p-3 rounded-xl border border-slate-100">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">利润空间</div>
        <div className={`text-sm font-black ${p.marginSpace === 'High' ? 'text-green-600' : p.marginSpace === 'Medium' ? 'text-blue-600' : 'text-yellow-600'}`}>{p.marginSpace}</div>
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
