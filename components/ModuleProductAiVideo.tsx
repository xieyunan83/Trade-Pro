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
  Download,
} from 'lucide-react';
import type { User } from '../types';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import {
  type VideoJob,
  type VideoMode,
  loadVideoJobs,
  saveVideoJobs,
  newCreativeId,
} from '../services/creativeStudioStore';
import { generateProductVideo, getVideoProviderStatus } from '../services/wanVideoService';

type Props = { currentUser: User };

/**
 * 产品 AI 视频：文/图/多参考真实生视频；样片确认后正片。
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
  const provider = getVideoProviderStatus();
  const active = jobs.find((j) => j.id === activeId) || null;

  const persist = (next: VideoJob[]) => {
    setJobs(next);
    saveVideoJobs(next);
  };

  const patchJob = (id: string, patch: Partial<VideoJob>) => {
    setJobs((prev) => {
      const next = prev.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: Date.now() } : j));
      saveVideoJobs(next);
      return next;
    });
  };

  const addImages = (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 6);
    list.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      if (file.size > 18 * 1024 * 1024) {
        setMsg('单张图片请小于 18MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => setImages((prev) => [...prev, String(reader.result || '')].slice(0, 6));
      reader.readAsDataURL(file);
    });
  };

  const buildFullPrompt = () => {
    const base = prompt.trim();
    const board = storyboard.trim();
    if (!board) return base;
    return `${base}\n分镜：${board}`;
  };

  const createDraft = async () => {
    if (!provider.ready) {
      setMsg(provider.detail);
      return;
    }
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
      progress: 0,
      draftConfirmed: false,
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    persist([job, ...jobs]);
    setActiveId(job.id);
    setBusy(true);
    setMsg('正在提交样片任务…');

    try {
      const result = await generateProductVideo({
        mode,
        prompt: buildFullPrompt() || 'Product showcase, smooth camera orbit, studio lighting',
        sourceImage: images[0],
        referenceImages: images.slice(1),
        durationSec,
        aspect,
        resolution: '720P',
        tier: 'draft',
        negativePrompt: 'blurry, low quality, distorted product, watermark, text overlay',
        onProgress: (pct, status) => {
          patchJob(job.id, {
            progress: Math.round(pct),
            previewHint: `样片生成中 ${Math.round(pct)}% · ${status}`,
          });
          setMsg(`样片生成中 ${Math.round(pct)}%`);
        },
      });
      patchJob(job.id, {
        status: 'draft',
        progress: 100,
        providerTaskId: result.taskId,
        draftVideoUrl: result.videoUrl,
        previewHint: '样片已就绪。确认后进入正片。',
        error: undefined,
      });
      setMsg('样片已完成 — 确认后再出正片以控制成本');
    } catch (e: any) {
      patchJob(job.id, {
        status: 'failed',
        error: e?.message || String(e),
        previewHint: e?.message || '样片失败',
      });
      setMsg(e?.message || '样片失败');
    } finally {
      setBusy(false);
    }
  };

  const confirmFull = async () => {
    if (!active || active.status !== 'draft') return;
    if (!provider.ready) {
      setMsg(provider.detail);
      return;
    }
    setBusy(true);
    patchJob(active.id, { status: 'rendering', progress: 0, previewHint: '正片渲染中…' });
    setMsg('正在提交正片任务…');

    try {
      const result = await generateProductVideo({
        mode: active.mode,
        prompt:
          [active.prompt, active.storyboard ? `分镜：${active.storyboard}` : '']
            .filter(Boolean)
            .join('\n') || 'Product hero video, cinematic lighting',
        sourceImage: active.sourceImages[0],
        referenceImages: active.sourceImages.slice(1),
        durationSec: active.durationSec,
        aspect: active.aspect,
        resolution: '1080P',
        tier: 'full',
        negativePrompt: 'blurry, low quality, distorted product, watermark, text overlay',
        onProgress: (pct, status) => {
          patchJob(active.id, {
            progress: Math.round(pct),
            previewHint: `正片生成中 ${Math.round(pct)}% · ${status}`,
          });
          setMsg(`正片生成中 ${Math.round(pct)}%`);
        },
      });
      patchJob(active.id, {
        status: 'ready',
        progress: 100,
        draftConfirmed: true,
        providerTaskId: result.taskId,
        videoUrl: result.videoUrl,
        previewHint: '正片已完成，可下载成片',
        error: undefined,
      });
      setMsg('正片已完成');
    } catch (e: any) {
      patchJob(active.id, {
        status: 'draft',
        error: e?.message || String(e),
        previewHint: e?.message || '正片失败，可重试',
      });
      setMsg(e?.message || '正片失败');
    } finally {
      setBusy(false);
    }
  };

  const removeJob = (id: string) => {
    if (!confirm('删除该视频任务？')) return;
    const next = jobs.filter((j) => j.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
  };

  const playUrl = active?.videoUrl || active?.draftVideoUrl;

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
              文生 / 图生 / 多参考真实出片；先出样片确认，再渲更高清正片。
            </p>
          </div>
          <div
            className={`text-[10px] font-bold rounded-xl px-3 py-2 border ${
              provider.ready
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-amber-800 bg-amber-50 border-amber-200'
            }`}
          >
            {provider.ready ? '服务已就绪' : '需配置 API Key'}
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
                  accept="image/png,image/jpeg,image/webp,image/bmp"
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
                      <img
                        key={i}
                        src={src}
                        alt=""
                        className="w-14 h-14 rounded-lg object-cover border border-slate-200"
                      />
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
              {busy && active?.status === 'rendering' && !active.draftConfirmed ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Play size={16} />
              )}
              {busy && active?.status === 'rendering' && !active.draftVideoUrl
                ? `样片中… ${active?.progress ?? 0}%`
                : '生成样片'}
            </button>
            {msg && (
              <p className="text-xs font-bold text-rose-900 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                {msg}
              </p>
            )}
            {!provider.ready && (
              <p className="text-[11px] text-amber-800 font-medium">
                管理员请到「系统管理 → 数据接入 → 视频生成 API」填写 Key（也可复用已配置的通义图像/千问 Key）。
              </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden min-h-[360px] flex flex-col">
          <div className="px-4 py-2.5 border-b border-white/10 flex justify-between text-xs font-bold text-slate-300">
            <span>预览台</span>
            {active && (
              <span className="text-rose-300 text-[10px] uppercase tracking-wider">
                {active.aspect} · {active.durationSec}s · {active.status}
                {typeof active.progress === 'number' && active.status === 'rendering'
                  ? ` · ${active.progress}%`
                  : ''}
              </span>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            {active?.status === 'rendering' ? (
              <div className="text-center space-y-3">
                <Loader2 className="mx-auto animate-spin text-rose-400" size={36} />
                <p className="text-sm font-bold text-slate-300">正在渲染视频…</p>
                <div className="w-48 h-1.5 rounded-full bg-white/10 mx-auto overflow-hidden">
                  <div
                    className="h-full bg-rose-500 transition-all"
                    style={{ width: `${active.progress ?? 5}%` }}
                  />
                </div>
              </div>
            ) : playUrl ? (
              <video
                key={playUrl}
                src={playUrl}
                controls
                playsInline
                className={`rounded-2xl bg-black max-h-72 ${
                  active?.aspect === '9:16'
                    ? 'w-40'
                    : active?.aspect === '1:1'
                      ? 'w-56'
                      : 'w-full max-w-lg'
                }`}
              />
            ) : active ? (
              <div
                className={`relative bg-gradient-to-br from-rose-600/30 to-amber-500/20 border border-white/10 rounded-2xl flex items-center justify-center ${
                  active.aspect === '9:16'
                    ? 'w-40 h-72'
                    : active.aspect === '1:1'
                      ? 'w-56 h-56'
                      : 'w-full max-w-lg aspect-video'
                }`}
              >
                {active.sourceImages[0] ? (
                  <img
                    src={active.sourceImages[0]}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover rounded-2xl opacity-50"
                  />
                ) : null}
                <div className="relative z-10 text-center px-4">
                  <p className="text-xs font-black text-white">{active.title}</p>
                  <p className="text-[10px] text-slate-300 mt-2 max-w-xs mx-auto">
                    {active.error || active.previewHint}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">生成样片后在此预览</p>
            )}
          </div>
          {active?.status === 'draft' && (
            <div className="px-4 py-3 border-t border-white/10 space-y-2">
              {active.draftVideoUrl && (
                <a
                  href={active.draftVideoUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="w-full rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-black py-2.5 inline-flex items-center justify-center gap-2"
                >
                  <Download size={16} /> 下载样片
                </a>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmFull()}
                className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-sm font-black py-2.5 inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {busy ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                确认样片 · 渲正片（1080P）
              </button>
            </div>
          )}
          {active?.status === 'ready' && active.videoUrl && (
            <div className="px-4 py-3 border-t border-white/10">
              <a
                href={active.videoUrl}
                target="_blank"
                rel="noreferrer"
                download
                className="w-full rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-black py-2.5 inline-flex items-center justify-center gap-2"
              >
                <Download size={16} /> 下载正片
              </a>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white overflow-hidden max-h-[32rem] flex flex-col">
          <div className="px-3 py-2.5 border-b border-slate-100 text-xs font-black text-slate-700">
            成片库 ({jobs.length})
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {jobs.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => setActiveId(j.id)}
                className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 ${
                  activeId === j.id ? 'bg-rose-50' : ''
                }`}
              >
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-slate-800 truncate">{j.title}</div>
                    <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {j.mode} · {j.status}
                      {j.draftConfirmed ? ' · 正片' : j.draftVideoUrl ? ' · 样片' : ''}
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
