import React, { useEffect, useState } from 'react';
import {
  Database,
  ExternalLink,
  Loader2,
  Save,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import type { User } from '../types';
import {
  DATA_PROVIDER_DEFS,
  type DataProviderId,
  type DataProviderMeta,
  loadAllDataProviders,
  saveDataProvider,
} from '../services/dataProviders';
import { syncCatalogFromProvider } from '../services/productCatalogTypes';
import { CRM_ENHANCEMENT_ROADMAP, PHASE_LABEL } from '../services/upgradeRoadmap';
import { ModuleBuyerLibrary } from './ModuleBuyerLibrary';
import { ModuleCustomsIntel } from './ModuleCustomsIntel';

const blank = (): DataProviderMeta => ({
  enabled: false,
  apiKey: '',
  apiBase: '',
  note: '',
  extra: {},
});

type Props = {
  currentUser: User;
};

/** 管理后台 · 数据接入：产品库/海关/3D/视频等提供商配置骨架 */
export const DataProvidersPanel: React.FC<Props> = ({ currentUser }) => {
  const [map, setMap] = useState<Record<string, DataProviderMeta>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<'toysbear' | 'skybird' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const all = await loadAllDataProviders();
      if (!cancelled) {
        setMap(all);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (id: DataProviderId, partial: Partial<DataProviderMeta>) => {
    setMap((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || blank()), ...partial },
    }));
  };

  const onSave = async (id: DataProviderId) => {
    setSavingId(id);
    setMsg(null);
    const meta = map[id] || blank();
    const ok = await saveDataProvider(id, meta);
    setSavingId(null);
    const label = DATA_PROVIDER_DEFS.find((d) => d.id === id)?.label || id;
    setMsg({
      ok: true,
      text: ok ? `${label} 已保存（本地 + 云端）` : `${label} 已写入本地；云端未同步（检查 Supabase）`,
    });
  };

  const onSyncCatalog = async (provider: 'toysbear' | 'skybird') => {
    setSyncingId(provider);
    setMsg(null);
    // 先落盘当前表单，避免未点保存就点同步
    await saveDataProvider(provider, map[provider] || blank());
    const res = await syncCatalogFromProvider(provider);
    setSyncingId(null);
    setMsg({ ok: res.ok, text: res.message });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 font-bold p-8">
        <Loader2 className="animate-spin" size={18} /> 加载数据源配置…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-white p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-900 text-cyan-300 flex items-center justify-center shrink-0">
            <Database size={18} />
          </div>
          <div>
            <h3 className="font-black text-slate-900 text-lg">今日看板 · 情报源（必读）</h3>
            <p className="text-sm text-slate-600 font-medium mt-1 max-w-3xl leading-relaxed">
              中行汇率与公开行业新闻<strong>自动拉取</strong>，无需配置。若要同步「优选行业资讯 / 新品」：
            </p>
            <ol className="mt-2 text-sm text-slate-700 font-medium list-decimal list-inside space-y-1 max-w-3xl">
              <li>在浏览器登录对应货源平台，打开开发者工具 → Network，复制接口请求头里的 Bearer Token。</li>
              <li>在下方找到对应提供商，勾选启用，把 Token 粘贴到「API Key」，点保存。</li>
              <li>回到「今日看板」或业务员工作台点「刷新情报」。</li>
            </ol>
            <p className="text-xs text-slate-500 font-medium mt-2">
              正式数据分享协议签署前，此为过渡方案；员工前台不会显示供应商名称。
            </p>
          </div>
        </div>
        {msg && (
          <div
            className={`mt-4 flex items-center gap-2 text-sm font-bold rounded-xl px-3 py-2 border ${
              msg.ok
                ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
                : 'bg-amber-50 text-amber-900 border-amber-100'
            }`}
          >
            {msg.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {msg.text}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4 sm:p-5">
        <div className="text-xs font-black text-violet-800 uppercase tracking-widest mb-1">
          CRM 增强 · {CRM_ENHANCEMENT_ROADMAP.phase} · {PHASE_LABEL[CRM_ENHANCEMENT_ROADMAP.phase]}
        </div>
        <p className="text-sm text-violet-900/80 font-medium">{CRM_ENHANCEMENT_ROADMAP.summary}</p>
        <ul className="mt-2 grid sm:grid-cols-2 gap-1">
          {CRM_ENHANCEMENT_ROADMAP.bullets.map((b) => (
            <li key={b} className="text-xs text-violet-800/90 font-semibold">
              · {b}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-4 rounded-2xl border border-teal-100 bg-teal-50/40 p-4 sm:p-5">
        <div>
          <div className="text-xs font-black text-teal-800 uppercase tracking-widest">
            后台数据库 · 客户搜索优先源
          </div>
          <p className="text-sm text-teal-900/80 font-medium mt-1 max-w-3xl leading-relaxed">
            维护企业内部买家与贸易档案。前台无独立入口，由客户搜索等模块按需使用。
          </p>
        </div>
        <ModuleBuyerLibrary currentUser={currentUser} history={[]} />
        <ModuleCustomsIntel currentUser={currentUser} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {DATA_PROVIDER_DEFS.map((def) => {
          const meta = map[def.id] || blank();
          return (
            <div
              key={def.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-black text-slate-900">{def.label}</div>
                  <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">{def.description}</p>
                  {def.docsHint && (
                    <a
                      href={def.docsHint.startsWith('http') ? def.docsHint : undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-700 mt-1.5"
                    >
                      {def.docsHint.startsWith('http') ? (
                        <>
                          官网 <ExternalLink size={10} />
                        </>
                      ) : (
                        def.docsHint
                      )}
                    </a>
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs font-black text-slate-600 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!meta.enabled}
                    onChange={(e) => patch(def.id, { enabled: e.target.checked })}
                    className="rounded border-slate-300"
                  />
                  启用
                </label>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  API Key / Token
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={meta.apiKey || ''}
                  onChange={(e) => patch(def.id, { apiKey: e.target.value })}
                  placeholder={
                    def.id === 'tripo'
                      ? 'tsk_…（图生 3D 控制台 API Key）'
                      : def.id === 'wan_video'
                        ? 'sk-… / sk-sp-…（可与万相同账号）'
                        : def.id === 'design_agent'
                          ? '图像 API Key'
                          : 'API Key / Token'
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  API Base / Endpoint
                </label>
                <input
                  value={meta.apiBase || ''}
                  onChange={(e) => patch(def.id, { apiBase: e.target.value })}
                  placeholder={
                    def.id === 'wan_video'
                      ? 'https://token-plan.cn-beijing.maas.aliyuncs.com（可选）'
                      : def.id === 'tripo'
                        ? '默认即可，无需填写'
                        : 'https://…'
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  模型 ID（可选）
                </label>
                <input
                  value={meta.extra?.modelId || ''}
                  onChange={(e) =>
                    patch(def.id, {
                      extra: { ...(meta.extra || {}), modelId: e.target.value },
                    })
                  }
                  placeholder={
                    def.id === 'design_agent'
                      ? '模型 ID（可选）'
                      : def.id === 'wan_video'
                        ? '默认 wan2.6-i2v / t2v'
                        : '可选'
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  备注（合同 / 覆盖国家等）
                </label>
                <textarea
                  value={meta.note || ''}
                  onChange={(e) => patch(def.id, { note: e.target.value })}
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void onSave(def.id)}
                  disabled={savingId === def.id}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white text-xs font-black px-4 py-2.5 hover:bg-slate-800 disabled:opacity-60"
                >
                  {savingId === def.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  保存
                </button>
                {(def.id === 'toysbear' || def.id === 'skybird') && (
                  <button
                    type="button"
                    onClick={() => void onSyncCatalog(def.id as 'toysbear' | 'skybird')}
                    disabled={syncingId === def.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 text-violet-900 text-xs font-black px-4 py-2.5 hover:bg-violet-100 disabled:opacity-60"
                    title="同步到前台「产品库」；官方 API 接通后再拉取"
                  >
                    {syncingId === def.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {def.id === 'toysbear' ? '同步小竹熊 → 产品库' : '同步霄鸟云 → 产品库'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
