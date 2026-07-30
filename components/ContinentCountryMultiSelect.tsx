import React, { useMemo, useState } from 'react';
import { MapPin, X, Check } from 'lucide-react';
import {
  CONTINENTS,
  countryLabel,
  countrySearchValue,
  findCountryByEn,
  type ContinentGroup,
} from '../data/countriesByContinent';

interface ContinentCountryMultiSelectProps {
  value: string[];
  onChange: (countriesEn: string[]) => void;
  label?: string;
  className?: string;
  /** 默认展开二级菜单（营销工具等场景） */
  defaultOpen?: boolean;
}

/**
 * 一级大洲 → 二级国家 多选
 * 常显面板，避免被误认为「逗号输入框」
 */
export const ContinentCountryMultiSelect: React.FC<ContinentCountryMultiSelectProps> = ({
  value,
  onChange,
  label = '目标国家（可多选）',
  className = '',
  defaultOpen = true,
}) => {
  const [activeContinentId, setActiveContinentId] = useState(CONTINENTS[0].id);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState(!defaultOpen);

  const activeContinent: ContinentGroup =
    CONTINENTS.find((c) => c.id === activeContinentId) || CONTINENTS[0];

  const filteredCountries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return activeContinent.countries;
    return activeContinent.countries.filter(
      (c) =>
        c.zh.includes(filter.trim()) ||
        c.en.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [activeContinent, filter]);

  const toggleCountry = (en: string) => {
    onChange(value.includes(en) ? value.filter((c) => c !== en) : [...value, en]);
  };

  const toggleContinentAll = () => {
    const ens = activeContinent.countries.map(countrySearchValue);
    const allSelected = ens.every((en) => value.includes(en));
    onChange(
      allSelected
        ? value.filter((c) => !ens.includes(c))
        : Array.from(new Set([...value, ...ens]))
    );
  };

  const continentSelectedCount = (continent: ContinentGroup) =>
    continent.countries.filter((c) => value.includes(countrySearchValue(c))).length;

  return (
    <div className={className}>
      {label && (
        <div className="flex items-center justify-between gap-2 mb-2">
          <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">
            {label}
          </label>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="text-[11px] font-black text-blue-600 hover:underline"
          >
            {collapsed ? '展开选择' : '收起'}
          </button>
        </div>
      )}

      {/* 已选标签 */}
      <div className="mb-2 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white flex items-start gap-2">
        <MapPin className="text-slate-400 mt-0.5 flex-shrink-0" size={16} />
        <div className="flex-1 min-w-0">
          {value.length === 0 ? (
            <span className="text-slate-400 text-sm font-bold">尚未选择国家（先点大洲，再勾选国家）</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {value.map((en) => {
                const item = findCountryByEn(en);
                return (
                  <span
                    key={en}
                    className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg text-xs font-black"
                  >
                    {item ? item.zh : en}
                    <button
                      type="button"
                      onClick={() => toggleCountry(en)}
                      className="hover:text-red-600"
                      aria-label={`移除 ${item?.zh || en}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] font-black text-red-500 hover:underline flex-shrink-0"
          >
            清空
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="border-2 border-blue-100 rounded-2xl bg-white overflow-hidden shadow-sm">
          {/* 一级：大洲 */}
          <div className="flex flex-wrap gap-1.5 p-3 bg-slate-50 border-b border-slate-100">
            <span className="w-full text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
              一级 · 选择大洲
            </span>
            {CONTINENTS.map((continent) => {
              const count = continentSelectedCount(continent);
              const active = continent.id === activeContinentId;
              return (
                <button
                  key={continent.id}
                  type="button"
                  onClick={() => {
                    setActiveContinentId(continent.id);
                    setFilter('');
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
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest sm:mr-2">
              二级 · {activeContinent.zh}国家
            </span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`在${activeContinent.zh}内搜索…`}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={toggleContinentAll}
              className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-black hover:bg-slate-200"
            >
              {activeContinent.countries.every((c) => value.includes(countrySearchValue(c)))
                ? '取消本洲'
                : '全选本洲'}
            </button>
          </div>

          {/* 二级：国家勾选 */}
          <div className="max-h-64 overflow-y-auto p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
            {filteredCountries.map((c) => {
              const en = countrySearchValue(c);
              const checked = value.includes(en);
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => toggleCountry(en)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-sm font-bold transition-colors ${
                    checked ? 'bg-blue-50 text-blue-800' : 'hover:bg-slate-50 text-slate-700'
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
  );
};
