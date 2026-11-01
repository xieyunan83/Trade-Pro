import React, { useMemo, useState } from 'react';
import { BookOpen, Check, Copy, Loader2, Search } from 'lucide-react';
import {
  ACQUISITION_STAGES,
  FORMULA_CATEGORY_LABEL,
  SEARCH_FORMULAS,
  UNIVERSAL_SEARCH_FORMULA,
  fillSearchFormula,
  type SearchFormulaCategory,
} from '../services/acquisitionMethods';

export type PlatformAcquisitionSearchRequest = {
  productKeyword: string;
  country: string;
  /** 仅强化某一类公式；不传则五类全开 */
  category?: SearchFormulaCategory;
  formulaId?: string;
  formulaTitle?: string;
};

type Props = {
  /** 预填产品词（来自流水线关键词） */
  productKeyword?: string;
  countryHint?: string;
  /** 在平台内执行客户搜索（不跳外网） */
  onPlatformSearch?: (req: PlatformAcquisitionSearchRequest) => void;
  searching?: boolean;
};

const CATEGORIES: SearchFormulaCategory[] = [
  'linkedin',
  'social',
  'amazon',
  'local_lang',
  'pdf_lists',
];

export const AcquisitionMethodsPanel: React.FC<Props> = ({
  productKeyword = '',
  countryHint = '',
  onPlatformSearch,
  searching = false,
}) => {
  const [cat, setCat] = useState<SearchFormulaCategory>('linkedin');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [product, setProduct] = useState(productKeyword);
  const [country, setCountry] = useState(countryHint);
  const [busyId, setBusyId] = useState<string | null>(null);

  React.useEffect(() => {
    if (productKeyword) setProduct(productKeyword);
  }, [productKeyword]);
  React.useEffect(() => {
    if (countryHint) setCountry(countryHint);
  }, [countryHint]);

  const formulas = useMemo(
    () => SEARCH_FORMULAS.filter((f) => f.category === cat),
    [cat]
  );

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
    } catch {
      alert('复制失败，请手动选中公式');
    }
  };

  const filled = (template: string) =>
    fillSearchFormula(template, {
      产品词: product || '[产品词]',
      国家: country || '[国家]',
      职位: 'buyer',
      公司域名: '[公司域名]',
      竞品品牌: '[竞品品牌]',
      竞品官网: 'example.com',
      德语产品词: product || '[德语产品词]',
      法语产品词: product || '[法语产品词]',
      日语产品词: product || '[日语产品词]',
      葡语产品词: product || '[葡语产品词]',
    });

  const runPlatform = (opts?: {
    category?: SearchFormulaCategory;
    formulaId?: string;
    formulaTitle?: string;
  }) => {
    const kw = product.trim();
    if (!kw) {
      alert('请先填写产品词，再在平台内检索');
      return;
    }
    if (!onPlatformSearch) {
      alert('平台检索未接通，请从「客户搜索」填写同一产品词与国家后搜索');
      return;
    }
    setBusyId(opts?.formulaId || opts?.category || 'all');
    onPlatformSearch({
      productKeyword: kw,
      country: country.trim(),
      category: opts?.category,
      formulaId: opts?.formulaId,
      formulaTitle: opts?.formulaTitle,
    });
    window.setTimeout(() => setBusyId(null), 1200);
  };

  const isBusy = searching || !!busyId;

  return (
    <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-2">
            <BookOpen className="text-blue-600 shrink-0" size={18} />
            获客方法与检索公式
          </h3>
          <p className="text-[11px] font-semibold text-slate-400 mt-1 leading-relaxed">
            公式已接入平台「客户搜索 / 背调」静默取证。点「平台检索」会带着产品词与国家进入客户搜索并自动开跑，不再跳转到外部搜索页。万能结构：
            <span className="text-slate-600">{UNIVERSAL_SEARCH_FORMULA}</span>
          </p>
        </div>
        <button
          type="button"
          disabled={isBusy}
          onClick={() => runPlatform()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black"
        >
          {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          五类一并平台检索
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {ACQUISITION_STAGES.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 space-y-1.5"
          >
            <div className="text-xs font-black text-slate-800">{s.title}</div>
            <p className="text-[10px] font-medium text-slate-500 leading-snug">{s.blurb}</p>
            <ul className="text-[10px] font-semibold text-slate-600 space-y-0.5 list-disc pl-3.5">
              {s.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex-1 min-w-[140px]">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
            产品词
          </span>
          <input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="如 educational toys"
            className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold"
          />
        </label>
        <label className="flex-1 min-w-[120px]">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
            国家 / 地区
          </span>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="如 USA / Germany"
            className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5 items-center">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black border transition-all ${
              cat === c
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
            }`}
          >
            {FORMULA_CATEGORY_LABEL[c]}
          </button>
        ))}
        <button
          type="button"
          disabled={isBusy}
          onClick={() => runPlatform({ category: cat })}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-[11px] font-black disabled:opacity-50"
        >
          <Search size={12} /> 本组平台检索
        </button>
      </div>

      <div className="space-y-2">
        {formulas.map((f) => {
          const q = filled(f.template);
          const rowBusy = busyId === f.id;
          return (
            <div
              key={f.id}
              className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-black text-slate-800">{f.title}</div>
                <code className="block mt-0.5 text-[11px] font-semibold text-slate-600 break-all">
                  {q}
                </code>
                <p className="text-[10px] font-medium text-slate-400 mt-0.5">{f.tip}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => copyText(f.id, q)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                >
                  {copiedId === f.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  {copiedId === f.id ? '已复制' : '复制'}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    runPlatform({ category: f.category, formulaId: f.id, formulaTitle: f.title })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 disabled:opacity-50"
                >
                  {rowBusy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                  平台检索
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] font-semibold text-slate-400 leading-relaxed">
        这些公式会进入客户搜索与背调的静默取证；命中公司后，决策人页先展示公开联系人，邮箱可再手动补全。排除词减号须紧贴单词（如
        -alibaba）。
      </p>
    </div>
  );
};
