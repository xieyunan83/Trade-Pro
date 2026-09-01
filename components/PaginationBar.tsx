import React, { useEffect, useState } from 'react';

export interface PaginationBarProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** 可选：左侧说明文案 */
  summary?: React.ReactNode;
  className?: string;
}

/** 上一页 / 下一页 + 手动输入页码跳转 */
export const PaginationBar: React.FC<PaginationBarProps> = ({
  page,
  totalPages,
  onPageChange,
  summary,
  className = '',
}) => {
  const safeTotal = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotal);
  const [draft, setDraft] = useState(String(safePage));

  useEffect(() => {
    setDraft(String(safePage));
  }, [safePage]);

  const jump = () => {
    const n = parseInt(draft.replace(/\D/g, ''), 10);
    if (!Number.isFinite(n)) {
      setDraft(String(safePage));
      return;
    }
    const next = Math.min(safeTotal, Math.max(1, n));
    setDraft(String(next));
    if (next !== safePage) onPageChange(next);
  };

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${className}`}
    >
      {summary != null ? <div className="text-xs font-bold text-slate-500">{summary}</div> : <div />}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-40 hover:bg-slate-50"
        >
          上一页
        </button>
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600">
          <span>第</span>
          <input
            type="number"
            min={1}
            max={safeTotal}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                jump();
              }
            }}
            onBlur={jump}
            className="w-14 px-2 py-1.5 rounded-lg border border-slate-200 text-center font-black text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
            title="输入页码后回车跳转"
            aria-label="跳转到页码"
          />
          <span>/ {safeTotal} 页</span>
          <button
            type="button"
            onClick={jump}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black hover:bg-slate-800"
          >
            跳转
          </button>
        </div>
        <button
          type="button"
          disabled={safePage >= safeTotal}
          onClick={() => onPageChange(Math.min(safeTotal, safePage + 1))}
          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-40 hover:bg-slate-50"
        >
          下一页
        </button>
      </div>
    </div>
  );
};
