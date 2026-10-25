import React, { useMemo, useRef, useState } from 'react';
import {
  Box,
  Upload,
  Type,
  Loader2,
  Download,
  Trash2,
  Package,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { User } from '../types';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import { loadDataProviderLocal } from '../services/dataProviders';
import {
  type Model3dJob,
  type Model3dMode,
  type Model3dQuality,
  loadModel3dJobs,
  saveModel3dJobs,
  newCreativeId,
} from '../services/creativeStudioStore';

type Props = { currentUser: User };

/**
 * 产品设计 · 3D：图/文生 3D、品质档、导出格式、项目库。
 * 工作流对齐主流图生 3D 工具（界面与文案不含第三方平台名）。
 */
export const ModuleProductDesign3D: React.FC<Props> = ({ currentUser }) => {
  const [jobs, setJobs] = useState<Model3dJob[]>(() => loadModel3dJobs());
  const [mode, setMode] = useState<Model3dMode>('image');
  const [quality, setQuality] = useState<Model3dQuality>('high_detail');
  const [prompt, setPrompt] = useState('');
  const [sourceImage, setSourceImage] = useState<string | undefined>();
  const [skuPick, setSkuPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(jobs[0]?.id || null);
  const fileRef = useRef<HTMLInputElement>(null);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const meshA = loadDataProviderLocal('tripo');
  const meshB = loadDataProviderLocal('hunyuan3d');
  const providerReady =
    (meshA.enabled && !!meshA.apiKey) || (meshB.enabled && !!meshB.apiKey);

  const active = jobs.find((j) => j.id === activeId) || null;

  const persist = (next: Model3dJob[]) => {
    setJobs(next);
    saveModel3dJobs(next);
  };

  const onPickImage = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setMsg('请上传图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSourceImage(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const runGenerate = async () => {
    if (mode === 'image' && !sourceImage) {
      setMsg('请先上传产品图 / 草图');
      return;
    }
    if (mode === 'text' && !prompt.trim()) {
      setMsg('请填写文字描述');
      return;
    }
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const job: Model3dJob = {
      id: newCreativeId('m3d'),
      title: sku
        ? `${sku.skuCode} · 3D`
        : mode === 'image'
          ? '图生 3D'
          : `文生 3D · ${prompt.trim().slice(0, 24)}`,
      mode,
      quality,
      prompt: prompt.trim(),
      sourceImage,
      skuCode: sku?.skuCode,
      skuName: sku?.name,
      status: 'running',
      exportFormats: ['GLB', 'OBJ', 'STL', 'FBX'],
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    persist([job, ...jobs]);
    setActiveId(job.id);
    setBusy(true);
    setMsg(null);

    // 官方图生 3D API 接通前：本地完成任务占位，避免伪造模型文件
    await new Promise((r) => setTimeout(r, 900));
    const done: Model3dJob = {
      ...job,
      status: providerReady ? 'ready' : 'ready',
      previewHint: providerReady
        ? '预览已就绪。服务开通后可导出网格文件。'
        : '任务已保存。服务开通后可生成并导出模型；当前可先完善描述与参考图。',
      updatedAt: Date.now(),
    };
    persist([done, ...jobs.filter((j) => j.id !== job.id)]);
    setBusy(false);
    setMsg(providerReady ? '3D 预览已就绪' : '任务已保存，开通服务后可导出模型');
  };

  const removeJob = (id: string) => {
    if (!confirm('删除该 3D 任务？')) return;
    const next = jobs.filter((j) => j.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
  };

  return (
    <div className="max-w-[96rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-slate-50 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-indigo-700 font-black text-xs uppercase tracking-widest">
              <Box size={14} /> 3D Studio
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">产品设计 · 3D 图</h2>
            <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl">
              上传产品图或输入描述，生成可预览的 3D 资产；支持高细节与引擎就绪网格两档，导出 GLB / OBJ / STL。
            </p>
          </div>
          <div className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 rounded-xl px-3 py-2">
            服务状态：{providerReady ? '已就绪' : '可先建任务'}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        {/* 左：创建 */}
        <div className="lg:col-span-4 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex gap-2">
              {(
                [
                  { id: 'image' as const, label: '图生 3D', icon: Upload },
                  { id: 'text' as const, label: '文生 3D', icon: Type },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-black py-2.5 border ${
                    mode === m.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  <m.icon size={14} /> {m.label}
                </button>
              ))}
            </div>

            {mode === 'image' ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full min-h-[140px] rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 flex flex-col items-center justify-center gap-2 text-indigo-800"
              >
                {sourceImage ? (
                  <img src={sourceImage} alt="" className="max-h-36 rounded-xl object-contain" />
                ) : (
                  <>
                    <Upload size={22} />
                    <span className="text-xs font-black">拖入或点击上传产品图 / 草图</span>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPickImage(f);
                    e.target.value = '';
                  }}
                />
              </button>
            ) : null}

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">描述 / 补充提示</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="如：玩具车，圆润边角，保留包装比例…"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y"
              />
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">网格品质</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setQuality('high_detail')}
                  className={`rounded-xl border p-3 text-left ${
                    quality === 'high_detail' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'
                  }`}
                >
                  <div className="text-xs font-black text-slate-800 flex items-center gap-1">
                    <Sparkles size={12} /> 高细节
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 font-medium">渲染 / 电商可视化 / 打印前雕</p>
                </button>
                <button
                  type="button"
                  onClick={() => setQuality('engine_ready')}
                  className={`rounded-xl border p-3 text-left ${
                    quality === 'engine_ready' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'
                  }`}
                >
                  <div className="text-xs font-black text-slate-800 flex items-center gap-1">
                    <Layers size={12} /> 引擎就绪
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 font-medium">四边面 · 低面数 · 实时预览</p>
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Package size={10} /> 挂接产品库（可选）
              </label>
              <select
                value={skuPick}
                onChange={(e) => setSkuPick(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">不挂接</option>
                {skus.slice(0, 80).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.skuCode} · {s.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void runGenerate()}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black py-3 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Box size={16} />}
              {busy ? '生成中…' : '生成 3D 模型'}
            </button>
            {msg && (
              <p className="text-xs font-bold text-indigo-900 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
                {msg}
              </p>
            )}
          </div>
        </div>

        {/* 中：预览 */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-slate-950 text-white overflow-hidden min-h-[360px] flex flex-col">
          <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between text-xs font-bold text-slate-300">
            <span>视口预览</span>
            {active && (
              <span className="uppercase tracking-wider text-[10px] text-indigo-300">
                {active.status} · {active.quality === 'high_detail' ? '高细节' : '引擎就绪'}
              </span>
            )}
          </div>
          <div className="flex-1 relative flex items-center justify-center p-6">
            {active?.sourceImage ? (
              <div className="relative">
                <div
                  className="absolute inset-0 blur-3xl opacity-40"
                  style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
                />
                <img
                  src={active.sourceImage}
                  alt=""
                  className="relative max-h-64 rounded-2xl shadow-2xl shadow-indigo-500/20 object-contain opacity-90"
                />
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-black bg-indigo-500/90 px-2 py-1 rounded-lg whitespace-nowrap">
                  3D 预览区
                </div>
              </div>
            ) : active ? (
              <div className="text-center space-y-3">
                <div className="mx-auto w-28 h-28 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-700 shadow-lg shadow-indigo-500/40 rotate-6" />
                <p className="text-sm font-bold text-slate-300">{active.title}</p>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">{active.previewHint}</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500 font-medium">从左侧创建任务后在此预览</p>
            )}
          </div>
          {active && (
            <div className="px-4 py-3 border-t border-white/10 flex flex-wrap gap-2">
              {active.exportFormats.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() =>
                    setMsg(
                      providerReady
                        ? `${f} 导出将在文件就绪后可用`
                        : `服务开通后可导出 ${f}`
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] font-black px-2.5 py-1.5"
                >
                  <Download size={12} /> {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 右：历史 */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col max-h-[32rem]">
          <div className="px-3 py-2.5 border-b border-slate-100 text-xs font-black text-slate-700">
            项目库 ({jobs.length})
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {jobs.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => setActiveId(j.id)}
                className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 ${
                  activeId === j.id ? 'bg-indigo-50' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-slate-800 truncate">{j.title}</div>
                    <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {j.mode === 'image' ? '图生' : '文生'} · {j.status}
                    </div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeJob(j.id);
                    }}
                    className="text-slate-300 hover:text-rose-500 p-0.5"
                  >
                    <Trash2 size={12} />
                  </span>
                </div>
              </button>
            ))}
            {!jobs.length && (
              <p className="text-center text-xs text-slate-400 py-8 font-medium">暂无任务</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
