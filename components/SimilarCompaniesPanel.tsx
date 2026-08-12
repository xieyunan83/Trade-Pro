import React, { useEffect, useMemo, useState } from 'react';
import { SimilarCompany } from '../types';
import { Briefcase, CheckSquare, ChevronRight, Globe, Search, Square } from 'lucide-react';

export interface SimilarCompaniesPanelProps {
  companies: SimilarCompany[];
  /** 单家深度调查 */
  onAnalyze?: (domain: string) => void;
  /** 批量背调（走任务队列确认弹窗） */
  onBatchAnalyze?: (companies: SimilarCompany[]) => void;
  /** 紧凑布局（背调报告内嵌） */
  compact?: boolean;
  title?: string;
  description?: string;
}

const companyKey = (c: SimilarCompany, i: number) =>
  `${(c.website || '').toLowerCase().trim()}|${(c.name || '').toLowerCase().trim()}|${i}`;

const analyzable = (c: SimilarCompany) => !!(c.website || c.name)?.trim();

export const SimilarCompaniesPanel: React.FC<SimilarCompaniesPanelProps> = ({
  companies,
  onAnalyze,
  onBatchAnalyze,
  compact = false,
  title,
  description,
}) => {
  const list = companies || [];
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const listSignature = useMemo(
    () => list.map((c, i) => companyKey(c, i)).join('||'),
    [list]
  );

  useEffect(() => {
    setSelected(new Set());
  }, [listSignature]);

  const keys = useMemo(() => list.map((c, i) => companyKey(c, i)), [list]);
  const selectableKeys = useMemo(
    () => list.map((c, i) => (analyzable(c) ? companyKey(c, i) : null)).filter(Boolean) as string[],
    [list]
  );

  const selectedCompanies = useMemo(
    () => list.filter((c, i) => selected.has(companyKey(c, i)) && analyzable(c)),
    [list, selected]
  );

  const allSelected =
    selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k));

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableKeys));
  };

  const handleBatch = () => {
    if (!onBatchAnalyze) return;
    if (selectedCompanies.length === 0) {
      alert('请先勾选要批量背调的同类公司');
      return;
    }
    onBatchAnalyze(selectedCompanies);
  };

  if (!list.length) {
    return (
      <div className="py-12 text-center text-slate-400 font-bold">暂无同类公司推荐</div>
    );
  }

  return (
    <div className="space-y-4">
      {(title || description || onBatchAnalyze) && (
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <div className="text-sm font-black text-slate-800 mb-1">{title}</div>
            )}
            {description && (
              <p className="text-sm text-slate-500 font-medium">{description}</p>
            )}
          </div>
          {onBatchAnalyze && (
            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={toggleAll}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-600 hover:border-blue-300"
              >
                {allSelected ? <CheckSquare size={14} className="text-blue-600" /> : <Square size={14} />}
                {allSelected ? '取消全选' : '全选'}
              </button>
              <button
                type="button"
                disabled={selectedCompanies.length === 0}
                onClick={handleBatch}
                className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-xs font-black"
              >
                <Search size={14} />
                批量背调{selectedCompanies.length > 0 ? ` (${selectedCompanies.length})` : ''}
              </button>
            </div>
          )}
        </div>
      )}

      {selectedCompanies.length > 0 && (
        <div className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
          已选 {selectedCompanies.length} 家，点击「批量背调」加入任务队列（可选详细/经济模式）
        </div>
      )}

      <div
        className={
          compact
            ? 'grid grid-cols-1 md:grid-cols-2 gap-3'
            : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6'
        }
      >
        {list.map((comp, i) => {
          const key = keys[i];
          const canAnalyze = analyzable(comp);
          const isOn = selected.has(key);
          return (
            <div
              key={key}
              className={`${
                compact ? 'bg-slate-50 p-4 rounded-2xl' : 'bg-slate-50 p-6 rounded-3xl'
              } border transition-all group ${
                isOn ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-100 hover:border-blue-200'
              }`}
            >
              <div className="flex justify-between items-start gap-2 mb-3">
                <div className="flex items-start gap-2 min-w-0">
                  {onBatchAnalyze && (
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={!canAnalyze}
                      onChange={() => canAnalyze && toggle(key)}
                      className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                      title={canAnalyze ? '加入批量背调' : '缺少网址/名称'}
                    />
                  )}
                  {!compact && (
                    <div className="bg-white p-3 rounded-2xl text-blue-600 shadow-sm flex-shrink-0">
                      <Briefcase size={24} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h4
                      className={`${compact ? 'text-sm' : 'text-lg'} font-black text-slate-800 truncate`}
                    >
                      {comp.name || '未知公司'}
                    </h4>
                    <div className="text-[11px] font-bold text-slate-400 flex items-center gap-1 truncate">
                      <Globe size={12} className="flex-shrink-0" />
                      {comp.website || '—'}
                      {comp.country ? ` · ${comp.country}` : ''}
                    </div>
                  </div>
                </div>
                {onAnalyze && canAnalyze && (
                  <button
                    type="button"
                    onClick={() => onAnalyze((comp.website || comp.name).trim())}
                    className="shrink-0 inline-flex items-center gap-1 bg-slate-900 text-white px-3 py-1.5 rounded-xl text-[10px] font-bold hover:bg-blue-600"
                  >
                    <Search size={11} /> 深度调查
                  </button>
                )}
              </div>
              {comp.mainProducts && (
                <div
                  className={`bg-white border border-slate-100 ${
                    compact ? 'rounded-xl px-3 py-2' : 'p-4 rounded-2xl'
                  }`}
                >
                  {!compact && (
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                      主营产品
                    </div>
                  )}
                  <div className="text-xs font-bold text-slate-600 leading-relaxed">
                    {comp.mainProducts}
                  </div>
                </div>
              )}
              {!compact && (
                <div className="mt-4 flex items-center justify-end text-blue-600 group-hover:translate-x-1 transition-transform">
                  <ChevronRight size={16} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
