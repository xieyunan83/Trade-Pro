import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, ChevronDown, X, Check } from 'lucide-react';
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
  placeholder?: string;
  className?: string;
}

/** 一级大洲 / 二级国家 多选（外贸场景复用） */
export const ContinentCountryMultiSelect: React.FC<ContinentCountryMultiSelectProps> = ({
  value,
  onChange,
  label = '目标国家（可多选）',
  placeholder = '先选大洲，再勾选国家',
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [activeContinentId, setActiveContinentId] = useState(CONTINENTS[0].id);
  const [filter, setFilter] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

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
    <div className={className} ref={panelRef}>
      {label && (
        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full min-h-[52px] px-4 py-3 rounded-xl border border-slate-200 bg-white text-left flex items-start gap-3 hover:border-blue-300 focus:ring-2 focus:ring-blue-500 transition-colors"
      >
        <MapPin className="text-slate-400 mt-0.5 flex-shrink-0" size={18} />
        <div className="flex-1 min-w-0">
          {value.length === 0 ? (
            <span className="text-slate-400 font-bold">{placeholder}</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {value.map((en) => {
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
          className={`text-slate-400 flex-shrink-0 mt-0.5 transition-transform ${open ? 'rotate-180' : ''}`}
          size={18}
        />
      </button>

      {open && (
        <div className="mt-2 border border-slate-200 rounded-2xl bg-white shadow-xl overflow-hidden z-20 relative">
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
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`在${activeContinent.zh}内搜索国家…`}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={toggleContinentAll}
                className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-black hover:bg-slate-200"
              >
                {activeContinent.countries.every((c) => value.includes(countrySearchValue(c)))
                  ? '取消本洲'
                  : '全选本洲'}
              </button>
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="px-3 py-2 rounded-lg text-red-600 text-xs font-black hover:bg-red-50"
                >
                  清空全部
                </button>
              )}
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
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
