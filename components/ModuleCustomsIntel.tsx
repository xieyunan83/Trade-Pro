import React, { useState } from 'react';
import { Ship, Search, Database } from 'lucide-react';
import type { User } from '../types';
import {
  type CustomsShipment,
  loadCustomsCache,
  saveCustomsCache,
  queryCustomsProvider,
} from '../services/customsTypes';
import { loadDataProviderLocal } from '../services/dataProviders';

type Props = {
  currentUser: User;
};

/** 海关情报（后台）：前台无导航；客户搜索命中时优先调用。独立缓存，不触碰 CRM/背调 */
export const ModuleCustomsIntel: React.FC<Props> = ({ currentUser }) => {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CustomsShipment[]>(() => loadCustomsCache());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = loadDataProviderLocal('customs');

  const runQuery = async () => {
    if (!q.trim()) {
      setMsg('请输入公司名 / HS / 关键词');
      return;
    }
    setBusy(true);
    setMsg(null);
    const local = loadCustomsCache().filter(
      (r) =>
        (r.consignee || '').toLowerCase().includes(q.toLowerCase()) ||
        (r.shipper || '').toLowerCase().includes(q.toLowerCase()) ||
        (r.hsCode || '').includes(q) ||
        (r.productDesc || '').toLowerCase().includes(q.toLowerCase())
    );
    if (local.length) {
      setRows(local);
      setMsg(`本地海关缓存命中 ${local.length} 条（未请求外网）`);
      setBusy(false);
      return;
    }
    if (!meta.enabled || !meta.apiKey) {
      setMsg('未配置海关数据源。请管理员打开「系统管理 → 数据接入 → 海关数据」启用并保存 Key。本地缓存仍为空。');
      setBusy(false);
      return;
    }
    const res = await queryCustomsProvider(q.trim());
    setBusy(false);
    if (res.ok && res.rows.length) {
      const merged = [...res.rows, ...loadCustomsCache()];
      saveCustomsCache(merged.slice(0, 5000));
      setRows(res.rows);
      setMsg(res.message);
    } else {
      setMsg(res.message || '查询无结果');
      setRows([]);
    }
  };

  return (
    <div className="max-w-[90rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-sky-200/70 bg-white/95 p-5 sm:p-6 shadow-sm">
        <div className="inline-flex items-center gap-2 text-sky-700 font-black text-xs uppercase tracking-widest">
          <Ship size={14} /> Customs
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">海关情报（后台）</h2>
        <p className="text-sm text-slate-500 font-medium mt-1 max-w-3xl">
          查询与维护贸易相关记录。配置状态：
          <span className={`ml-1 font-black ${meta.enabled ? 'text-emerald-600' : 'text-amber-600'}`}>
            {meta.enabled ? '已启用' : '未启用外采（可用本地数据）'}
          </span>
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-3 text-slate-400" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runQuery()}
              className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium"
              placeholder="公司名 / HS Code / 品名…"
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runQuery()}
            className="rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-black px-4 py-2.5 disabled:opacity-50"
          >
            {busy ? '查询中…' : '查询'}
          </button>
        </div>
        {msg && (
          <p className="mt-3 text-xs font-bold text-sky-900 bg-sky-50 border border-sky-100 rounded-xl px-3 py-2 flex gap-2">
            <Database size={14} className="shrink-0 mt-0.5" /> {msg}
          </p>
        )}
        <p className="mt-2 text-[11px] text-slate-400 font-medium">
          操作账号：{currentUser.username} · 本模块不会写入 CRM 客户表
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-[10px] font-black uppercase text-slate-400 border-b">
            <tr>
              <th className="py-2 text-left">日期</th>
              <th className="py-2 text-left">发货人</th>
              <th className="py-2 text-left">收货人</th>
              <th className="py-2 text-left">HS</th>
              <th className="py-2 text-left">品名</th>
              <th className="py-2 text-left">线路</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400 font-bold">
                  暂无缓存记录。配置海关 API 后查询结果会缓存在此。
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="py-2 text-xs">{r.date || '—'}</td>
                  <td className="py-2 font-semibold">{r.shipper || '—'}</td>
                  <td className="py-2 font-semibold">{r.consignee || '—'}</td>
                  <td className="py-2 font-mono text-xs">{r.hsCode || '—'}</td>
                  <td className="py-2 text-xs max-w-[14rem] truncate">{r.productDesc || '—'}</td>
                  <td className="py-2 text-xs">
                    {r.originCountry || '?'} → {r.destCountry || '?'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
