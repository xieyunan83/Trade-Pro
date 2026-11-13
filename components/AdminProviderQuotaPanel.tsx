import React, { useCallback, useEffect, useState } from 'react';
import { Gauge, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import type { User } from '../types';
import {
  fetchProviderQuotaSnapshot,
  type ProviderQuotaRow,
} from '../services/providerQuotaService';

type Props = {
  currentUser: User;
};

const statusCls = (s: ProviderQuotaRow['status']) => {
  switch (s) {
    case 'ok':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'warn':
      return 'bg-amber-100 text-amber-900 border-amber-200';
    case 'error':
      return 'bg-rose-100 text-rose-800 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
};

const catLabel: Record<ProviderQuotaRow['category'], string> = {
  llm: '大模型',
  search: '检索',
  email: '邮箱/发信',
  image: '生图',
  app: '平台限额',
};

/** 管理后台：各服务剩余额度（后续可按公司/部门/员工二次分配） */
export const AdminProviderQuotaPanel: React.FC<Props> = ({ currentUser }) => {
  const [rows, setRows] = useState<ProviderQuotaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [at, setAt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const next = await fetchProviderQuotaSnapshot({ currentUser });
      setRows(next);
      setAt(Date.now());
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50/80 to-white p-4 sm:p-5 space-y-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-slate-900 text-cyan-300 flex items-center justify-center shrink-0">
            <Gauge size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900">服务剩余额度总览</h3>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5 leading-relaxed">
              汇总后台实际调用的大模型 / 检索 / 邮箱 / 发信额度。后续将据此给公司、部门、员工分配额度。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          刷新额度
        </button>
      </div>

      {err ? (
        <div className="flex items-center gap-2 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
          <AlertTriangle size={14} /> {err}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {loading && !rows.length ? (
          <div className="col-span-full flex items-center justify-center gap-2 py-8 text-slate-400 text-xs font-bold">
            <Loader2 size={14} className="animate-spin" /> 读取各服务额度…
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-slate-900 truncate">{r.name}</span>
                <span
                  className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${statusCls(r.status)}`}
                >
                  {catLabel[r.category]}
                </span>
              </div>
              <div className="text-sm font-black text-slate-800">{r.remainingLabel}</div>
              <p className="text-[10px] font-medium text-slate-500 leading-snug line-clamp-2">
                {r.detail}
              </p>
              {r.keysTotal != null ? (
                <p className="text-[9px] font-mono text-slate-400">
                  keys {r.keysUsable ?? 0}/{r.keysTotal}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>

      <p className="text-[10px] font-medium text-slate-400">
        {at ? `更新于 ${new Date(at).toLocaleString('zh-CN', { hour12: false })}` : ''}
        · 千问/Gemini/万相/Tavily 等若无官方余额接口，以 Key 池「本月可用」为准；Anymail / Hunter / 发信可查真实余额。
      </p>
    </div>
  );
};
