import React, { useMemo, useRef, useState, useEffect } from 'react';
import { DiscoveryState, ClientSearchResult, CLIENT_TYPE_OPTIONS } from '../types';
import { Search, Globe, MapPin, Briefcase, Loader2, Plus, Layers, Star, Building2, ChevronDown, X, Check } from 'lucide-react';
import { searchPotentialClients } from '../services/geminiService';
import { CONTINENTS, countryLabel, countrySearchValue, findCountryByEn, type ContinentGroup } from '../data/countriesByContinent';

interface ClientFinderProps {
  state: DiscoveryState;
  onStateChange: (state: DiscoveryState) => void;
  onSelect: (domain: string) => void;
  onBatchAddToCRM: (results: ClientSearchResult[]) => void;
  onBatchAnalyze: (results: ClientSearchResult[]) => void;
}

const normalizeCountries = (state: DiscoveryState): string[] => {
  if (state.countries?.length) return state.countries;
  if (state.country?.trim()) {
    return state.country.split(/[,，;/|]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

const normalizeClientTypes = (state: DiscoveryState): string[] => {
  if (state.clientTypes?.length) return state.clientTypes;
  if (state.clientType?.trim()) {
    return state.clientType.split(/[,，;/|]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

export const ClientFinder: React.FC<ClientFinderProps> = ({ state, onStateChange, onSelect, onBatchAddToCRM, onBatchAnalyze }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [countryOpen, setCountryOpen] = useState(false);
  const [activeContinentId, setActiveContinentId] = useState(CONTINENTS[0].id);
  const [countryFilter, setCountryFilter] = useState('');
  const countryPanelRef = useRef<HTMLDivElement>(null);

  const selectedCountries = normalizeCountries(state);
  const selectedTypes = normalizeClientTypes(state);

  const activeContinent: ContinentGroup =
    CONTINENTS.find((c) => c.id === activeContinentId) || CONTINENTS[0];

  const filteredCountries = useMemo(() => {
    const q = countryFilter.trim().toLowerCase();
    if (!q) return activeContinent.countries;
    return activeContinent.countries.filter(
      (c) =>
        c.zh.includes(countryFilter.trim()) ||
        c.en.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [activeContinent, countryFilter]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!countryPanelRef.current?.contains(e.target as Node)) {
        setCountryOpen(false);
      }
    };
    if (countryOpen) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [countryOpen]);

  const patchState = (partial: Partial<DiscoveryState>) => {
    const nextCountries = partial.countries ?? selectedCountries;
    const nextTypes = partial.clientTypes ?? selectedTypes;
    onStateChange({
      ...state,
      ...partial,
      countries: nextCountries,
      clientTypes: nextTypes,
      country: nextCountries.join(', '),
      clientType: nextTypes.join(', '),
    });
  };

  const toggleCountry = (en: string) => {
    const next = selectedCountries.includes(en)
      ? selectedCountries.filter((c) => c !== en)
      : [...selectedCountries, en];
    patchState({ countries: next });
  };

  const toggleContinentAll = () => {
    const ens = activeContinent.countries.map(countrySearchValue);
    const allSelected = ens.every((en) => selectedCountries.includes(en));
    const next = allSelected
      ? selectedCountries.filter((c) => !ens.includes(c))
      : Array.from(new Set([...selectedCountries, ...ens]));
    patchState({ countries: next });
  };

  const toggleClientType = (value: string) => {
    const next = selectedTypes.includes(value)
      ? selectedTypes.filter((t) => t !== value)
      : [...selectedTypes, value];
    patchState({ clientTypes: next });
  };

  const handleSearch = async () => {
    if (!state.product) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const countryArg = selectedCountries.join(', ') || '';
      const typeArg = selectedTypes.join(', ') || '';
      const results = await searchPotentialClients(state.product, countryArg, state.industry, typeArg);
      patchState({ results, hasSearched: true });
      setSelectedIndices(new Set());
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || '搜索失败，请稍后重试');
      patchState({ results: [], hasSearched: true });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (idx: number) => {
    const next = new Set(selectedIndices);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedIndices(next);
  };

  const selectedResults = state.results.filter((_, i) => selectedIndices.has(i));
  const continentSelectedCount = (continent: ContinentGroup) =>
    continent.countries.filter((c) => selectedCountries.includes(countrySearchValue(c))).length;

  return (
    <div className="max-w-7xl mx-auto space-y-4 sm:space-y-8 animate-fade-in px-0">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-black text-slate-800 mb-2 flex items-center gap-2">
          <Globe className="text-blue-600 flex-shrink-0" /> 全球客户精准搜索
        </h2>
        <p className="text-sm text-slate-500 font-medium mb-4 sm:mb-6">
          支持多选客户类型与多国市场；先选大洲，再勾选国家。建议填写行业以提升命中率。
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">产品关键词</label>
            <div className="relative">
              <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
              <input
                type="text"
                value={state.product}
                onChange={(e) => patchState({ product: e.target.value })}
                className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                placeholder="例如: Silicone Baby Bibs"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">行业</label>
            <div className="relative">
              <Building2 className="absolute left-4 top-3.5 text-slate-400" size={18} />
              <input
                type="text"
                value={state.industry}
                onChange={(e) => patchState({ industry: e.target.value })}
                className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                placeholder="例如: Baby Products / Home Decor"
              />
            </div>
          </div>

          {/* 国家多选：一级大洲 / 二级国家 */}
          <div className="sm:col-span-2" ref={countryPanelRef}>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              目标国家（可多选）
            </label>
            <button
              type="button"
              onClick={() => setCountryOpen((v) => !v)}
              className="w-full min-h-[52px] px-4 py-3 rounded-xl border border-slate-200 bg-white text-left flex items-start gap-3 hover:border-blue-300 focus:ring-2 focus:ring-blue-500 transition-colors"
            >
              <MapPin className="text-slate-400 mt-0.5 flex-shrink-0" size={18} />
              <div className="flex-1 min-w-0">
                {selectedCountries.length === 0 ? (
                  <span className="text-slate-400 font-bold">先选大洲，再勾选国家</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCountries.map((en) => {
                      const item = findCountryByEn(en);
                      return (
                        <span
                          key={en}
                          className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg text-xs font-black"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCountry(en);
                          }}
                        >
                          {item ? item.zh : en}
                          <X size={12} />
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <ChevronDown
                className={`text-slate-400 flex-shrink-0 mt-0.5 transition-transform ${countryOpen ? 'rotate-180' : ''}`}
                size={18}
              />
            </button>

            {countryOpen && (
              <div className="mt-2 border border-slate-200 rounded-2xl bg-white shadow-xl overflow-hidden">
                {/* 一级：五大洲 */}
                <div className="flex flex-wrap gap-1 p-2 bg-slate-50 border-b border-slate-100">
                  {CONTINENTS.map((continent) => {
                    const count = continentSelectedCount(continent);
                    const active = continent.id === activeContinentId;
                    return (
                      <button
                        key={continent.id}
                        type="button"
                        onClick={() => {
                          setActiveContinentId(continent.id);
                          setCountryFilter('');
                        }}
                        className={`px-3 py-2 rounded-xl text-xs font-black transition-colors ${
                          active
                            ? 'bg-slate-900 text-white'
                            : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {continent.zh}
                        {count > 0 && (
                          <span className={`ml-1.5 ${active ? 'text-blue-200' : 'text-blue-600'}`}>
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="p-3 border-b border-slate-100 flex flex-col sm:flex-row gap-2 sm:items-center">
                  <input
                    type="text"
                    value={countryFilter}
                    onChange={(e) => setCountryFilter(e.target.value)}
                    placeholder={`在${activeContinent.zh}内搜索国家…`}
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={toggleContinentAll}
                      className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-black hover:bg-slate-200"
                    >
                      {activeContinent.countries.every((c) =>
                        selectedCountries.includes(countrySearchValue(c))
                      )
                        ? '取消本洲'
                        : '全选本洲'}
                    </button>
                    {selectedCountries.length > 0 && (
                      <button
                        type="button"
                        onClick={() => patchState({ countries: [] })}
                        className="px-3 py-2 rounded-lg text-red-600 text-xs font-black hover:bg-red-50"
                      >
                        清空全部
                      </button>
                    )}
                  </div>
                </div>

                {/* 二级：国家列表 */}
                <div className="max-h-56 overflow-y-auto p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                  {filteredCountries.map((c) => {
                    const en = countrySearchValue(c);
                    const checked = selectedCountries.includes(en);
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => toggleCountry(en)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-sm font-bold transition-colors ${
                          checked
                            ? 'bg-blue-50 text-blue-800'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                            checked ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'
                          }`}
                        >
                          {checked && <Check size={12} strokeWidth={3} />}
                        </span>
                        <span className="truncate">{countryLabel(c)}</span>
                      </button>
                    );
                  })}
                  {filteredCountries.length === 0 && (
                    <p className="col-span-full text-center text-sm text-slate-400 py-6 font-bold">无匹配国家</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 客户类型多选 */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">
                客户类型（可多选）
              </label>
              {selectedTypes.length > 0 && (
                <button
                  type="button"
                  onClick={() => patchState({ clientTypes: [] })}
                  className="text-[11px] font-black text-slate-400 hover:text-red-500"
                >
                  清空
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {CLIENT_TYPE_OPTIONS.map((opt) => {
                const checked = selectedTypes.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleClientType(opt.value)}
                    className={`inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-black border transition-all ${
                      checked
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                        checked ? 'bg-white border-white text-slate-900' : 'border-slate-300'
                      }`}
                    >
                      {checked && <Check size={10} strokeWidth={3} />}
                    </span>
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {selectedTypes.length === 0 && (
              <p className="mt-2 text-[11px] text-slate-400 font-bold">未选则搜索全部类型</p>
            )}
          </div>
        </div>

        <button
          onClick={handleSearch}
          disabled={loading || !state.product}
          className="w-full mt-4 sm:mt-6 bg-slate-900 hover:bg-blue-600 text-white py-3 sm:py-4 rounded-xl font-black shadow-lg transition-all flex items-center justify-center gap-2 touch-manipulation"
        >
          {loading ? <Loader2 className="animate-spin" size={20} /> : '开始搜索'}
        </button>
        {errorMsg && (
          <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl text-sm font-bold text-red-600">
            {errorMsg}
          </div>
        )}
      </div>

      {state.hasSearched && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <h3 className="text-base sm:text-lg font-black text-slate-800">搜索结果 ({state.results.length})</h3>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <button
                disabled={selectedIndices.size === 0}
                onClick={() => onBatchAddToCRM(selectedResults)}
                className="flex items-center justify-center gap-2 bg-white border border-slate-200 px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 touch-manipulation"
              >
                <Plus size={16} /> 导入 CRM ({selectedIndices.size})
              </button>
              <button
                disabled={selectedIndices.size === 0}
                onClick={() => onBatchAnalyze(selectedResults)}
                className="flex items-center justify-center gap-2 bg-blue-600 px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 touch-manipulation"
              >
                <Layers size={16} /> 批量分析 ({selectedIndices.size})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            {state.results.map((res, idx) => (
              <div
                key={idx}
                className={`bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all cursor-pointer touch-manipulation ${selectedIndices.has(idx) ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'}`}
                onClick={() => toggleSelect(idx)}
              >
                <div className="flex justify-between items-start mb-3 gap-3">
                  <div className="bg-slate-50 p-3 rounded-2xl text-slate-400 flex-shrink-0">
                    <Briefcase size={22} />
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {typeof res.fitScore === 'number' && (
                      <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-1 rounded-lg text-[10px] font-black">
                        <Star size={12} /> 匹配 {res.fitScore}/5
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(res.website || res.name);
                      }}
                      className="text-xs font-black text-blue-600 hover:underline"
                    >
                      深度分析 →
                    </button>
                  </div>
                </div>
                <h4 className="text-lg font-black text-slate-800 mb-1">{res.name}</h4>
                <div className="text-xs font-bold text-slate-400 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex items-center gap-1">
                    <Globe size={12} /> {res.website || '—'}
                  </span>
                  <span>
                    • {res.country}
                    {res.city ? ` · ${res.city}` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {res.clientType && (
                    <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg text-[10px] font-black">
                      {res.clientType}
                    </span>
                  )}
                  {res.estimatedScale && (
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg text-[10px] font-black">
                      {res.estimatedScale}
                    </span>
                  )}
                  {res.mainProducts && (
                    <span className="bg-violet-50 text-violet-700 px-2 py-0.5 rounded-lg text-[10px] font-black">
                      {res.mainProducts}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 line-clamp-3 leading-relaxed">{res.description}</p>
                {(res.fitReason || res.contactHint) && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                    {res.fitReason && (
                      <p className="text-[11px] font-bold text-slate-500">匹配理由：{res.fitReason}</p>
                    )}
                    {res.contactHint && (
                      <p className="text-[11px] font-bold text-blue-600 truncate">线索：{res.contactHint}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
