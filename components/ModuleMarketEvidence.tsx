import React, { useMemo, useState } from 'react';
import { Layers, Search, Database, Save } from 'lucide-react';
import type { User } from '../types';
import { loadDataProviderLocal } from '../services/dataProviders';
import {
  draftEvidenceBundle,
  getMarketEvidenceReadiness,
  loadMarketEvidenceBundles,
  queryMarketplaceProvider,
  saveMarketEvidenceBundles,
  saveMarketplaceSignalCache,
  loadMarketplaceSignalCache,
} from '../services/marketEvidenceService';
import type {
  ImportBehaviorSignal,
  MarketplaceCategorySignal,
} from '../services/marketEvidenceTypes';

type Props = {
  currentUser: User;
};

/**
 * 商机证据（后台）：线上货架 × 线下进口对齐占位。
 * 前台无导航；接通数据商后支撑生产/销售建议。
 */
export const ModuleMarketEvidence: React.FC<Props> = ({ currentUser }) => {
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('US');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<MarketplaceCategorySignal[]>(() =>
    loadMarketplaceSignalCache()
  );
  const [offline, setOffline] = useState<ImportBehaviorSignal[]>([]);
  const [bundles, setBundles] = useState(() => loadMarketEvidenceBundles());
  const meta = loadDataProviderLocal('marketplace_intel');
  const readiness = useMemo(() => getMarketEvidenceReadiness(), [online, offline, bundles, msg]);

  const runQuery = async () => {
    if (!q.trim()) {
      setMsg('请输入品类关键词 / 公司名 / HS');
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await queryMarketplaceProvider({
      keyword: q.trim(),
      country: country.trim() || undefined,
    });
    setBusy(false);
    setOnline(res.online.length ? res.online : loadMarketplaceSignalCache());
    setOffline(res.offlineImport);
    setMsg(res.message);
  };

  const saveDraftBundle = () => {
    if (!online.length && !offline.length) {
      setMsg('请先查询到线上或线下信号，再保存证据包草稿');
      return;
    }
    const draft = draftEvidenceBundle({
      title: q.trim() || '未命名商机证据',
      online,
      offlineImport: offline,
      country: country.trim() || undefined,
    });
    const next = [draft, ...loadMarketEvidenceBundles()].slice(0, 200);
    saveMarketEvidenceBundles(next);
    setBundles(next);
    setMsg(`已保存证据包草稿「${draft.title}」（对齐状态：未关联 CRM）`);
  };

  /** 演示：写入一条占位线上信号，便于联调 UI（非真实平台数据） */
  const seedDemoOnline = () => {
    const demo: MarketplaceCategorySignal = {
      id: `demo_${Date.now()}`,
      platform: 'amazon',
      country: country.trim() || 'US',
      categoryPath: q.trim() || 'Toys & Games > Demo Category',
      keyword: q.trim() || 'demo toy',
      priceBand: '$8–18（演示占位）',
      demandLabel: '演示热度',
      reviewPainPoints: ['包装易损（演示）', '说明书缺多语（演示）'],
      evidenceTier: 'C',
      sourceNote: '本地演示占位，非真实平台数据',
      createdAt: Date.now(),
      observedAt: Date.now(),
    };
    const next = [demo, ...loadMarketplaceSignalCache()].slice(0, 3000);
    saveMarketplaceSignalCache(next);
    setOnline(next);
    setMsg('已写入 1 条演示线上信号（证据级 C）。正式环境请删除演示数据并接通 API。');
  };

  return (
    <div className="max-w-[90rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-indigo-200/70 bg-white/95 p-5 sm:p-6 shadow-sm">
        <div className="inline-flex items-center gap-2 text-indigo-700 font-black text-xs uppercase tracking-widest">
          <Layers size={14} /> Market Evidence
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">商机证据（后台）</h2>
        <p className="text-sm text-slate-500 font-medium mt-1 max-w-3xl leading-relaxed">
          将线上货架机会与线下进口行为对齐，供后续生产 / 销售建议引用。配置状态：
          <span className={`ml-1 font-black ${meta.enabled ? 'text-emerald-600' : 'text-amber-600'}`}>
            {meta.enabled ? '线上源已启用' : '线上源未启用'}
          </span>
        </p>
        <p className="mt-2 text-[11px] font-bold text-indigo-900/80 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
          {readiness.statusLabel}
          {' · '}
          线上缓存 {readiness.onlineCacheCount} · 海关缓存 {readiness.customsCacheCount} · 证据包{' '}
          {readiness.bundleCount}
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-3 text-slate-400" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runQuery()}
              className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium"
              placeholder="品类词 / 公司名 / HS…"
            />
          </div>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-24 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold"
            placeholder="国家"
            title="市场国家代码，如 US / DE"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void runQuery()}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black px-4 py-2.5 disabled:opacity-50"
          >
            {busy ? '查询中…' : '查询对齐'}
          </button>
          <button
            type="button"
            onClick={saveDraftBundle}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white text-indigo-800 text-xs font-black px-3 py-2.5"
          >
            <Save size={14} /> 存证据包草稿
          </button>
          <button
            type="button"
            onClick={seedDemoOnline}
            className="rounded-xl border border-slate-200 text-slate-600 text-xs font-bold px-3 py-2.5"
          >
            写入演示线上信号
          </button>
        </div>
        {msg && (
          <p className="mt-3 text-xs font-bold text-indigo-900 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 flex gap-2">
            <Database size={14} className="shrink-0 mt-0.5" /> {msg}
          </p>
        )}
        <p className="mt-2 text-[11px] text-slate-400 font-medium">
          操作账号：{currentUser.username} · 本模块默认不写 CRM；对齐确认后的回写在接通阶段实现
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 overflow-x-auto">
          <div className="text-[10px] font-black uppercase text-slate-400 mb-2">线上机会（货架）</div>
          <table className="w-full text-sm min-w-[420px]">
            <thead className="text-[10px] font-black uppercase text-slate-400 border-b">
              <tr>
                <th className="py-2 text-left">平台</th>
                <th className="py-2 text-left">类目 / 词</th>
                <th className="py-2 text-left">价带</th>
                <th className="py-2 text-left">级</th>
              </tr>
            </thead>
            <tbody>
              {online.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400 font-bold text-xs">
                    暂无线上缓存。配置「线上货架情报」或点演示写入。
                  </td>
                </tr>
              ) : (
                online.slice(0, 30).map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-2 text-xs font-bold uppercase">{r.platform}</td>
                    <td className="py-2 text-xs max-w-[14rem] truncate">
                      {r.categoryPath || r.keyword || '—'}
                    </td>
                    <td className="py-2 text-xs">{r.priceBand || '—'}</td>
                    <td className="py-2 text-xs font-black">{r.evidenceTier}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 overflow-x-auto">
          <div className="text-[10px] font-black uppercase text-slate-400 mb-2">线下进口行为</div>
          <table className="w-full text-sm min-w-[420px]">
            <thead className="text-[10px] font-black uppercase text-slate-400 border-b">
              <tr>
                <th className="py-2 text-left">公司</th>
                <th className="py-2 text-left">HS</th>
                <th className="py-2 text-left">票数</th>
                <th className="py-2 text-left">级</th>
              </tr>
            </thead>
            <tbody>
              {offline.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400 font-bold text-xs">
                    暂无聚合结果。有海关本地缓存时，按公司名/HS 查询可生成行为卡。
                  </td>
                </tr>
              ) : (
                offline.slice(0, 30).map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-2 text-xs font-semibold max-w-[12rem] truncate">
                      {r.companyName}
                    </td>
                    <td className="py-2 font-mono text-[10px]">
                      {(r.hsCodes || []).slice(0, 2).join(', ') || '—'}
                    </td>
                    <td className="py-2 text-xs">{r.shipmentCount ?? '—'}</td>
                    <td className="py-2 text-xs font-black">{r.evidenceTier}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-[10px] font-black uppercase text-slate-400 mb-2">
          证据包草稿（{bundles.length}）
        </div>
        {bundles.length === 0 ? (
          <p className="text-xs text-slate-400 font-bold py-4 text-center">
            尚无草稿。查询后点「存证据包草稿」。
          </p>
        ) : (
          <ul className="space-y-2">
            {bundles.slice(0, 12).map((b) => (
              <li
                key={b.id}
                className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs"
              >
                <div className="font-black text-slate-800">{b.title}</div>
                <div className="text-slate-500 font-medium mt-0.5">
                  对齐 {b.alignmentStatus} · 线上 {(b.online || []).length} · 进口{' '}
                  {(b.offlineImport || []).length} ·{' '}
                  {b.joinKeys.channelKind || '—'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
