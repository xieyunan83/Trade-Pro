import React, { useMemo, useState } from 'react';
import { Library, Search, Download, Upload, Plus } from 'lucide-react';
import type { HistoryItem, User } from '../types';
import {
  type BuyerRecord,
  loadBuyerRecords,
  saveBuyerRecords,
  searchBuyerLibrary,
} from '../services/buyerLibraryTypes';

type Props = {
  currentUser: User;
  /** 只读引用背调历史，导入买家库时复制字段，不修改 history */
  history: HistoryItem[];
};

const newId = () => `by_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * 自有买家库（后台）：前台无导航；客户搜索按关键词命中时优先调用。
 * 存储独立；从背调「复制」入库，绝不写回/删除 history 或 CRM。
 */
export const ModuleBuyerLibrary: React.FC<Props> = ({ currentUser, history }) => {
  const [rows, setRows] = useState<BuyerRecord[]>(() => loadBuyerRecords());
  const [q, setQ] = useState('');
  const [onlineHint, setOnlineHint] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const persist = (next: BuyerRecord[]) => {
    setRows(next);
    saveBuyerRecords(next);
  };

  const localHits = useMemo(() => (q.trim() ? searchBuyerLibrary(q, rows) : rows.slice(0, 100)), [q, rows]);

  const runSearch = () => {
    const hits = searchBuyerLibrary(q, rows);
    if (hits.length > 0) {
      setOnlineHint(null);
      setMsg(`库内命中 ${hits.length} 条（未调用在线搜索，不产生 API 费用）`);
      return;
    }
    setOnlineHint(
      '库内无命中。后续将自动走 Tavily/AnySearch 补搜并写回本库；当前请先用「从背调导入」充实库，或在客户搜索模块继续在线找客。'
    );
    setMsg('库内 0 条 · 建议先导入背调或手工添加');
  };

  const importFromHistory = () => {
    if (!history.length) {
      setMsg('当前可见背调历史为空，无法导入');
      return;
    }
    if (
      !confirm(
        `将把当前可见的 ${history.length} 条背调「复制」到买家库？\n不会修改或删除背调历史与 CRM。`
      )
    ) {
      return;
    }
    const now = Date.now();
    const byKey = new Map<string, BuyerRecord>();
    for (const r of rows) {
      const k = `${(r.domain || '').toLowerCase()}|${r.companyName.toLowerCase()}`;
      byKey.set(k, r);
    }
    let added = 0;
    for (const h of history) {
      const name = (h.data?.companyInfo?.name || h.domain || '').trim();
      if (!name) continue;
      const domain = (h.domain || h.data?.companyInfo?.website || '')
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .toLowerCase();
      const key = `${domain}|${name.toLowerCase()}`;
      if (byKey.has(key)) continue;
      const rec: BuyerRecord = {
        id: newId(),
        companyName: name,
        domain: domain || undefined,
        country: h.country || h.data?.companyInfo?.headquarters || h.data?.companyInfo?.city,
        industry: undefined,
        source: 'background',
        enrichmentStatus: 'enriched',
        lastEnrichedAt: h.timestamp || now,
        ownerUsername: currentUser.username,
        departmentId: currentUser.departmentId,
        createdAt: now,
        updatedAt: now,
      };
      byKey.set(key, rec);
      added += 1;
    }
    persist([...byKey.values()]);
    setMsg(`已复制入库 ${added} 条新买家（背调历史未改动）`);
  };

  const addManual = () => {
    const name = window.prompt('公司名称');
    if (!name?.trim()) return;
    const domain = window.prompt('域名（可选）') || '';
    const now = Date.now();
    persist([
      {
        id: newId(),
        companyName: name.trim(),
        domain: domain.trim() || undefined,
        source: 'manual',
        enrichmentStatus: 'raw',
        ownerUsername: currentUser.username,
        departmentId: currentUser.departmentId,
        createdAt: now,
        updatedAt: now,
      },
      ...rows,
    ]);
    setMsg('已手工添加');
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `buyer_library_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="max-w-[90rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-cyan-200/70 bg-white/95 p-5 sm:p-6 shadow-sm">
        <div className="inline-flex items-center gap-2 text-cyan-700 font-black text-xs uppercase tracking-widest">
          <Library size={14} /> Buyer Library
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">自有买家库（后台）</h2>
        <p className="text-xs text-teal-800/80 font-bold mt-1">
          前台已隐藏 · 仅在「客户搜索」命中相关公司时注入结果
        </p>
        <p className="text-sm text-slate-500 font-medium mt-1 max-w-3xl">
          检索顺序：先搜本库 → 未命中再在线补搜（在线补搜接通后启用）。存储键{' '}
          <code className="text-xs bg-slate-100 px-1 rounded">trade_scout_buyer_library_v1</code>
          。从背调导入只是复制，<strong className="text-slate-700">不会动你的 1200+ 背调与 CRM</strong>。
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-3 text-slate-400" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium"
              placeholder="公司名 / 域名 / 国家…"
            />
          </div>
          <button
            type="button"
            onClick={runSearch}
            className="rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-black px-4 py-2.5"
          >
            库内搜索
          </button>
          <button
            type="button"
            onClick={importFromHistory}
            className="rounded-xl border border-slate-200 bg-white text-xs font-black px-3 py-2.5 inline-flex items-center gap-1"
          >
            <Upload size={14} /> 从背调复制入库（{history.length}）
          </button>
          <button
            type="button"
            onClick={addManual}
            className="rounded-xl border border-slate-200 bg-white text-xs font-black px-3 py-2.5 inline-flex items-center gap-1"
          >
            <Plus size={14} /> 手工
          </button>
          <button
            type="button"
            onClick={exportJson}
            className="rounded-xl border border-slate-200 bg-white text-xs font-black px-3 py-2.5 inline-flex items-center gap-1"
          >
            <Download size={14} /> 导出
          </button>
        </div>
        {msg && (
          <p className="mt-3 text-xs font-bold text-cyan-900 bg-cyan-50 border border-cyan-100 rounded-xl px-3 py-2">
            {msg}
          </p>
        )}
        {onlineHint && (
          <p className="mt-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            {onlineHint}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-black text-slate-700 mb-2">
          库内 {rows.length} 家 · 本屏展示 {localHits.length}
        </div>
        <div className="overflow-x-auto max-h-[32rem]">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-[10px] font-black uppercase text-slate-400 border-b">
              <tr>
                <th className="py-2 text-left">公司</th>
                <th className="py-2 text-left">域名</th>
                <th className="py-2 text-left">国家</th>
                <th className="py-2 text-left">来源</th>
              </tr>
            </thead>
            <tbody>
              {localHits.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-slate-400 font-bold">
                    库空：点「从背调复制入库」可快速充实（只复制）
                  </td>
                </tr>
              ) : (
                localHits.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-2.5 font-bold text-slate-800">{r.companyName}</td>
                    <td className="py-2.5 text-xs font-mono text-slate-500">{r.domain || '—'}</td>
                    <td className="py-2.5 text-xs">{r.country || '—'}</td>
                    <td className="py-2.5 text-[11px] font-bold text-slate-400">{r.source}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
