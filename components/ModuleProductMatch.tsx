import React, { useEffect, useMemo, useState } from 'react';
import {
  CustomerProductProfile,
  HistoryItem,
  OurProductMatchQuery,
  ProductMatchHit,
} from '../types';
import {
  loadProductCatalog,
  matchOurProductToProfiles,
  rebuildProductCatalogFromHistory,
} from '../services/productCatalog';
import { INDUSTRY_OPTIONS } from '../data/industries';
import {
  Search,
  RefreshCw,
  Loader2,
  Package,
  Target,
  Database,
  ExternalLink,
  Sparkles,
} from 'lucide-react';

interface ModuleProductMatchProps {
  history: HistoryItem[];
  onOpenHistory?: (item: HistoryItem) => void;
  onGoCrm?: () => void;
}

export const ModuleProductMatch: React.FC<ModuleProductMatchProps> = ({
  history,
  onOpenHistory,
  onGoCrm,
}) => {
  const [profiles, setProfiles] = useState<CustomerProductProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [country, setCountry] = useState('');
  const [hits, setHits] = useState<ProductMatchHit[] | null>(null);
  const [searched, setSearched] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await loadProductCatalog();
      setProfiles(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const categoryOptions = useMemo(
    () => INDUSTRY_OPTIONS.filter((o) => /玩具|母婴|礼品|派对|家居|厨|宠物|文具|电子/.test(o.zh)),
    []
  );

  const handleRebuild = async () => {
    if (!history.length) {
      alert('暂无背调历史可入库。请先完成客户背调。');
      return;
    }
    if (!confirm(`将从 ${history.length} 条背调记录重建产品库（已有更新的条目会保留）。继续？`)) return;
    setRebuilding(true);
    try {
      const { upserted, skipped } = await rebuildProductCatalogFromHistory(history, { force: false });
      await refresh();
      alert(`产品库已更新：写入/刷新 ${upserted} 家，跳过 ${skipped} 条。`);
    } catch (e: any) {
      alert(`重建失败：${e?.message || String(e)}`);
    } finally {
      setRebuilding(false);
    }
  };

  const handleMatch = () => {
    const q: OurProductMatchQuery = {
      name: name.trim(),
      category: category.trim() || undefined,
      priceMinCny: priceMin ? Number(priceMin) : undefined,
      priceMaxCny: priceMax ? Number(priceMax) : undefined,
      countries: country.trim() ? [country.trim()] : undefined,
    };
    if (!q.name && !q.category) {
      alert('请填写新品名称或品类');
      return;
    }
    if (!profiles.length) {
      alert('产品库为空。请先点「从背调重建产品库」，或完成背调后自动入库。');
      return;
    }
    setHits(matchOurProductToProfiles(q, profiles));
    setSearched(true);
  };

  const openReport = (profile: CustomerProductProfile) => {
    if (!profile.historyId || !onOpenHistory) return;
    const item = history.find((h) => h.id === profile.historyId);
    if (item) onOpenHistory(item);
    else alert('未找到对应背调记录（可能已删除），可在 CRM / 记录中心查看。');
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 text-slate-900 font-black text-xl">
              <Target className="text-emerald-600" size={22} />
              新品匹配客户
            </div>
            <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl">
              输入你的新品名称、品类与价格区间，在已背调客户的产品库中反查合适买家——不必再只靠关键词搜客户。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw size={14} /> 刷新库
            </button>
            <button
              type="button"
              disabled={rebuilding}
              onClick={() => void handleRebuild()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-emerald-600 disabled:opacity-50"
            >
              {rebuilding ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
              从背调重建产品库
            </button>
            {onGoCrm && (
              <button
                type="button"
                onClick={onGoCrm}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-200 text-emerald-700 text-xs font-bold hover:bg-emerald-50"
              >
                去 CRM 批量深挖
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <label className="block sm:col-span-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">新品名称 *</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：1:64 合金回力消防车"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">品类</span>
            <input
              list="product-match-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="合金/回力车玩具"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
            />
            <datalist id="product-match-categories">
              {categoryOptions.map((o) => (
                <option key={o.en} value={o.zh} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">目标国家（可选）</span>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="United Arab Emirates"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">价格下限 ¥</span>
            <input
              type="number"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
              placeholder="FOB/零售"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">价格上限 ¥</span>
            <input
              type="number"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              placeholder="例如 25"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
            />
          </label>
          <div className="sm:col-span-2 flex items-end">
            <button
              type="button"
              onClick={handleMatch}
              className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm"
            >
              <Search size={16} /> 匹配合适客户
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
          <span className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-full">
            <Package size={12} className="text-emerald-600" />
            产品库 {loading ? '…' : `${profiles.length} 家客户`}
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-400">
            <Sparkles size={12} />
            背调时会自动采集全站品类与价格并入库；「补做产品品类」只用于旧背调缺数据的客户。
          </span>
        </div>
      </div>

      {searched && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-black text-slate-800">
              匹配结果 {hits?.length ? `(${hits.length})` : ''}
            </h3>
          </div>
          {!hits?.length ? (
            <div className="p-10 text-center text-slate-400 font-bold text-sm">
              未找到足够匹配的客户。可放宽品类/价格，或对旧背调缺品类的客户在 CRM 点「补做产品品类」。
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {hits.map((hit) => (
                <li key={hit.profile.id} className="p-5 hover:bg-slate-50/80 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-slate-900 text-base">{hit.profile.companyName}</span>
                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                            hit.score >= 70
                              ? 'bg-emerald-100 text-emerald-700'
                              : hit.score >= 40
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          匹配度 {hit.score}
                        </span>
                        {hit.priceOverlap && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                            价格重叠
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-blue-600 font-bold mt-0.5 truncate">
                        {hit.profile.website || '—'}
                        {hit.profile.country ? ` · ${hit.profile.country}` : ''}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {hit.profile.categories.slice(0, 8).map((c) => (
                          <span
                            key={c}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                              hit.matchedCategories.includes(c)
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                : 'border-slate-200 text-slate-600'
                            }`}
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                      {hit.profile.priceBand && (
                        <div className="text-xs font-bold text-slate-500 mt-2">
                          客户价位线索：{hit.profile.priceBand}
                        </div>
                      )}
                      <ul className="mt-2 space-y-0.5">
                        {hit.reasons.map((r) => (
                          <li key={r} className="text-xs text-slate-500 font-medium">
                            · {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-col gap-2">
                      {hit.profile.historyId && onOpenHistory && (
                        <button
                          type="button"
                          onClick={() => openReport(hit.profile)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold"
                        >
                          <ExternalLink size={12} /> 打开背调
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
