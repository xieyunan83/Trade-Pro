import React, { useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  Type,
  Image as ImageIcon,
  Layers,
  Loader2,
  Play,
  CheckCircle2,
  Trash2,
  Package,
} from 'lucide-react';
import type { User } from '../types';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import { loadDataProviderLocal } from '../services/dataProviders';
import {
  type VideoJob,
  type VideoMode,
  loadVideoJobs,
  saveVideoJobs,
  newCreativeId,
} from '../services/creativeStudioStore';

type Props = { currentUser: User };

/**
 * 产品 AI 视频：文/图/多参考生视频，样片确认后正片。
 * 工作流对齐主流 AI 视频工具（界面不含第三方平台名）。
 */
export const ModuleProductAiVideo: React.FC<Props> = ({ currentUser }) => {
  const [jobs, setJobs] = useState<VideoJob[]>(() => loadVideoJobs());
  const [mode, setMode] = useState<VideoMode>('image');
  const [prompt, setPrompt] = useState('');
  const [storyboard, setStoryboard] = useState('');
  const [durationSec, setDurationSec] = useState<4 | 5 | 8 | 10>(5);
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [images, setImages] = useState<string[]>([]);
  const [skuPick, setSkuPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(jobs[0]?.id || null);
  const fileRef = useRef<HTMLInputElement>(null);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const wan = loadDataProviderLocal('wan_video');
  const providerReady = wan.enabled && !!(wan.apiKey || '').trim();
  const active = jobs.find((j) => j.id === activeId) || null;

  const persist = (next: VideoJob[]) => {
    setJobs(next);
    saveVideoJobs(next);
  };

  const addImages = (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 6);
    list.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => setImages((prev) => [...prev, String(reader.result || '')].slice(0, 6));
      reader.readAsDataURL(file);
    });
  };

  const createDraft = async () => {
    if (!prompt.trim() && mode === 'text') {
      setMsg('请填写镜头描述');
      return;
    }
    if ((mode === 'image' || mode === 'reference') && images.length === 0) {
      setMsg(mode === 'reference' ? '请上传至少 1 张参考图（建议多角度）' : '请上传产品图');
      return;
    }
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const job: VideoJob = {
      id: newCreativeId('vid'),
      title: sku ? `${sku.skuCode} · ${durationSec}s` : `视频 · ${prompt.trim().slice(0, 20) || '未命名'}`,
      mode,
      prompt: prompt.trim(),
      storyboard: storyboard.trim() || undefined,
      durationSec,
      aspect,
      sourceImages: images,
      skuCode: sku?.skuCode,
      skuName: sku?.name,
      status: 'rendering',
      draftConfirmed: false,
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    persist([job, ...jobs]);
    setActiveId(job.id);
    setBusy(true);
    setMsg(null);
    await new Promise((r) => setTimeout(r, 1000));
    const done: VideoJob = {
      ...job,
      status: 'draft',
      previewHint: providerReady
        ? '样片已就绪（占位）。确认后进入正片渲染队列。'
        : '样片任务已创建。请在「数据接入」配置视频 API 后出真实样片；当前可先打磨分镜与提示词。',
      updatedAt: Date.now(),
    };
    persist([done, ...jobs.filter((j) => j.id !== job.id)]);
    setBusy(false);
    setMsg('样片阶段完成 — 请确认后再出正片，以控制成本');
  };

  const confirmFull = async () => {
    if (!active || active.status !== 'draft') return;
    setBusy(true);
    const rendering: VideoJob = { ...active, status: 'rendering', updatedAt: Date.now() };
    persist(jobs.map((j) => (j.id === active.id ? rendering : j)));
    await new Promise((r) => setTimeout(r, 800));
    const ready: VideoJob = {
      ...rendering,
      status: 'ready',
      draftConfirmed: true,
      previewHint: providerReady
        ? '正片任务完成（占位）。API 接通后可下载成片。'
        : '正片标记完成。配置视频 API 后可拉取成片文件。',
      updatedAt: Date.now(),
    };
    persist(jobs.map((j) => (j.id === active.id ? ready : j)));
    setBusy(false);
    setMsg('正片已确认');
  };

  const removeJob = (id: string) => {
    if (!confirm('删除该视频任务？')) return;
    const next = jobs.filter((j) => j.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
  };

  return (
    <div className="max-w-[96rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-rose-200/70 bg-gradient-to-br from-rose-50/70 via-white to-amber-50/40 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-rose-700 font-black text-xs uppercase tracking-widest">
              <Clapperboard size={14} /> Video Studio
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">产品 AI 视频</h2>
            <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl">
              文生 / 图生 / 多参考生视频；支持分镜与画幅。先出样片，确认后再渲正片。
            </p>
          </div>
          <div className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 rounded-xl px-3 py-2">
            视频 API：{providerReady ? '已配置' : '未配置（可先建任务）'}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'text' as const, label: '文生', icon: Type },
                  { id: 'image' as const, label: '图生', icon: ImageIcon },
                  { id: 'reference' as const, label: '多参考', icon: Layers },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`inline-flex flex-col items-center gap-1 rounded-xl text-[10px] font-black py-2 border ${
                    mode === m.id
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  <m.icon size={14} /> {m.label}
                </button>
              ))}
            </div>

            {(mode === 'image' || mode === 'reference') && (
              <div>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/40 py-4 text-xs font-black text-rose-800"
                >
                  上传{mode === 'reference' ? '参考图（可多张）' : '产品图'} · 已选 {images.length}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple={mode === 'reference'}
                  className="hidden"
                  onChange={(e) => {
                    addImages(e.target.files);
                    e.target.value = '';
                  }}
                />
                {images.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {images.map((src, i) => (
                      <img key={i} src={src} alt="" className="w-14 h-14 rounded-lg object-cover border border-slate-200" />
                    ))}
                    <button
                      type="button"
                      className="text-[10px] font-black text-slate-400 underline"
                      onClick={() => setImages([])}
                    >
                      清空
                    </button>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">镜头描述</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="主体动作、镜头运动、光线、禁止元素…"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">分镜（可选）</label>
              <textarea
                value={storyboard}
                onChange={(e) => setStoryboard(e.target.value)}
                rows={2}
                placeholder="0–2s：特写… 2–5s：环绕…"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase">时长</label>
                <select
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value) as 4 | 5 | 8 | 10)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-2 text-sm font-bold"
                >
                  {[4, 5, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} 秒
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase">画幅</label>
                <select
                  value={aspect}
                  onChange={(e) => setAspect(e.target.value as typeof aspect)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-2 text-sm font-bold"
                >
                  <option value="16:9">16:9 横版</option>
                  <option value="9:16">9:16 竖版</option>
                  <option value="1:1">1:1 方形</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
                <Package size={10} /> 产品库
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
              onClick={() => void createDraft()}
              className="w-full rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-black py-3 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
              生成样片
            </button>
            {msg && (
              <p className="text-xs font-bold text-rose-900 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{msg}</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden min-h-[360px] flex flex-col">
          <div className="px-4 py-2.5 border-b border-white/10 flex justify-between text-xs font-bold text-slate-300">
            <span>预览台</span>
            {active && (
              <span className="text-rose-300 text-[10px] uppercase tracking-wider">
                {active.aspect} · {active.durationSec}s · {active.status}
              </span>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            {active ? (
              <div
                className={`relative bg-gradient-to-br from-rose-600/30 to-amber-500/20 border border-white/10 rounded-2xl flex items-center justify-center ${
                  active.aspect === '9:16' ? 'w-40 h-72' : active.aspect === '1:1' ? 'w-56 h-56' : 'w-full max-w-lg aspect-video'
                }`}
              >
                {active.sourceImages[0] ? (
                  <img src={active.sourceImages[0]} alt="" className="absolute inset-0 w-full h-full object-cover rounded-2xl opacity-50" />
                ) : null}
                <div className="relative z-10 text-center px-4">
                  <Play className="mx-auto text-white/90 mb-2" size={36} />
                  <p className="text-xs font-black text-white">{active.title}</p>
                  <p className="text-[10px] text-slate-300 mt-2 max-w-xs mx-auto">{active.previewHint}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">生成样片后在此预览</p>
            )}
          </div>
          {active?.status === 'draft' && (
            <div className="px-4 py-3 border-t border-white/10">
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmFull()}
                className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-sm font-black py-2.5 inline-flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={16} /> 确认样片 · 渲正片
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white overflow-hidden max-h-[32rem] flex flex-col">
          <div className="px-3 py-2.5 border-b border-slate-100 text-xs font-black text-slate-700">成片库 ({jobs.length})</div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {jobs.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => setActiveId(j.id)}
                className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 ${activeId === j.id ? 'bg-rose-50' : ''}`}
              >
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-slate-800 truncate">{j.title}</div>
                    <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {j.mode} · {j.status}
                      {j.draftConfirmed ? ' · 正片' : ''}
                    </div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeJob(j.id);
                    }}
                    className="text-slate-300 hover:text-rose-500"
                  >
                    <Trash2 size={12} />
                  </span>
                </div>
              </button>
            ))}
            {!jobs.length && <p className="text-center text-xs text-slate-400 py-8">暂无视频</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
