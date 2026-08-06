import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import {
  INDUSTRY_GROUPS,
  INDUSTRY_OPTIONS,
  industryLabel,
  joinIndustries,
  parseIndustrySelection,
  type IndustryOption,
} from '../data/industries';

interface IndustryMultiSelectProps {
  value: string;
  onChange: (joined: string) => void;
  placeholder?: string;
  className?: string;
  /** 紧凑模式（CRM 筛选等） */
  compact?: boolean;
}

export const IndustryMultiSelect: React.FC<IndustryMultiSelectProps> = ({
  value,
  onChange,
  placeholder = '例如: Baby Products / Home Decor',
  className = '',
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [customDraft, setCustomDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => parseIndustrySelection(value), [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (en: string) => {
    const next = selected.includes(en) ? selected.filter((s) => s !== en) : [...selected, en];
    onChange(joinIndustries(next));
  };

  const remove = (en: string) => {
    onChange(joinIndustries(selected.filter((s) => s !== en)));
  };

  const addCustom = () => {
    const t = customDraft.trim();
    if (!t) return;
    if (!selected.includes(t)) onChange(joinIndustries([...selected, t]));
    setCustomDraft('');
  };

  const q = filter.trim().toLowerCase();
  const filteredByGroup = useMemo(() => {
    const map = new Map<string, IndustryOption[]>();
    for (const g of INDUSTRY_GROUPS) map.set(g, []);
    for (const opt of INDUSTRY_OPTIONS) {
      if (q) {
        const hay = `${opt.en} ${opt.zh} ${opt.group}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const list = map.get(opt.group) || [];
      list.push(opt);
      map.set(opt.group, list);
    }
    return INDUSTRY_GROUPS.map((g) => ({ group: g, items: map.get(g) || [] })).filter(
      (x) => x.items.length > 0
    );
  }, [q]);

  const optionByEn = useMemo(() => {
    const m = new Map<string, IndustryOption>();
    for (const o of INDUSTRY_OPTIONS) m.set(o.en, o);
    return m;
  }, []);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-left hover:border-blue-300 focus:ring-2 focus:ring-blue-500 ${
          compact ? 'px-3 py-2.5' : 'pl-10 pr-10 py-3'
        }`}
      >
        {!compact && <Building2 className="absolute left-3 text-slate-400 pointer-events-none" size={18} />}
        <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
          {selected.length === 0 ? (
            <span className="text-slate-400 font-medium text-sm truncate">{placeholder}</span>
          ) : (
            selected.slice(0, compact ? 1 : 4).map((s) => {
              const opt = optionByEn.get(s);
              return (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 max-w-[140px] px-2 py-0.5 rounded-lg bg-blue-50 text-blue-800 text-xs font-bold"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="truncate">{opt ? opt.zh : s}</span>
                  <button
                    type="button"
                    className="shrink-0 text-blue-500 hover:text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(s);
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })
          )}
          {selected.length > (compact ? 1 : 4) && (
            <span className="text-xs font-bold text-slate-500">+{selected.length - (compact ? 1 : 4)}</span>
          )}
        </div>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full min-w-[280px] max-h-[360px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl flex flex-col">
          <div className="p-2 border-b border-slate-100 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 text-slate-400" size={14} />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜索行业（中/英）..."
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 text-sm font-medium"
                autoFocus
              />
            </div>
            <div className="flex gap-1.5">
              <input
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                placeholder="手动录入自定义行业..."
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium"
              />
              <button
                type="button"
                onClick={addCustom}
                className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold flex items-center gap-1"
              >
                <Plus size={14} /> 添加
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1 p-2 space-y-3">
            {filteredByGroup.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-6 font-medium">无匹配行业，可手动添加</p>
            ) : (
              filteredByGroup.map(({ group, items }) => (
                <div key={group}>
                  <div className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    {group}
                  </div>
                  <div className="space-y-0.5">
                    {items.map((opt) => {
                      const on = selected.includes(opt.en);
                      return (
                        <button
                          key={opt.en}
                          type="button"
                          onClick={() => toggle(opt.en)}
                          className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm ${
                            on ? 'bg-blue-50 text-blue-900' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              on ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'
                            }`}
                          >
                            {on && <Check size={10} />}
                          </span>
                          <span className="font-bold truncate">{industryLabel(opt)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <div className="p-2 border-t border-slate-100 flex justify-between items-center">
              <span className="text-xs text-slate-500 font-bold">已选 {selected.length}</span>
              <button
                type="button"
                onClick={() => onChange('')}
                className="text-xs font-bold text-red-500 hover:underline"
              >
                清空
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
