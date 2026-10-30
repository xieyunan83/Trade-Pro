import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { ModuleType } from '../types';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import {
  type VideoJob,
  type VideoMode,
  loadVideoJobs,
  saveVideoJobs,
  newCreativeId,
} from '../services/creativeStudioStore';
import { persistVideoJob } from '../services/creativeAssetPersist';
import { tryPersistMediaUrl } from '../services/creativeAssetVault';
import { CreativeStorageBadge } from './CreativeStorageBadge';
import { VaultImg, useVaultUrl } from './VaultMedia';
import {
  generateProductVideo,
  getVideoProviderStatus,
  hydrateVideoProvider,
} from '../services/wanVideoService';
import { humanizeCreativeProviderError } from '../services/providerErrorMessage';
import { consumeCreativeHandoff } from '../services/creativeAssetBridge';
import { CreativePipelineBar, CreativeRefPicker } from './CreativeRefPicker';
import { VIDEO_SKILLS, type VideoSkillId } from '../services/creativeSkills/videoSkills';
import { composeVideoGenerationPrompt } from '../services/creativeQualityKit';

type Props = {
  currentUser: User;
  onNavigateModule?: (mod: ModuleType) => void;
};

/**
 * 产品 AI 视频：文/图/多参考真实生视频；样片确认后正片。
 */
export const ModuleProductAiVideo: React.FC<Props> = ({ currentUser, onNavigateModule }) => {
  const [jobs, setJobs] = useState<VideoJob[]>(() => loadVideoJobs());
  const [mode, setMode] = useState<VideoMode>('image');
  const [videoSkillId, setVideoSkillId] = useState<VideoSkillId>('hero_orbit');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState(
    () => VIDEO_SKILLS.find((s) => s.id === 'hero_orbit')?.negativeHints || ''
  );
  const [storyboard, setStoryboard] = useState('');
  const [durationSec, setDurationSec] = useState<4 | 5 | 8 | 10>(5);
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [images, setImages] = useState<string[]>([]);
  const [skuPick, setSkuPick] = useState('');
  const [skuName, setSkuName] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(jobs[0]?.id || null);
  const [provider, setProvider] = useState(() => getVideoProviderStatus());
  const fileRef = useRef<HTMLInputElement>(null);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const active = jobs.find((j) => j.id === activeId) || null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const st = await hydrateVideoProvider();
      try {
        const raw = loadVideoJobs();
        const migrated: VideoJob[] = [];
        for (const j of raw) migrated.push(await persistVideoJob(j));
        if (!cancelled) {
          saveVideoJobs(migrated);
          setJobs(migrated);
        }
      } catch (e) {
        console.warn('video jobs migrate', e);
      }
      if (!cancelled) setProvider(st);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handoff = consumeCreativeHandoff('ai_video');
    if (!handoff?.images?.length) return;
    setMode(handoff.images.length > 1 ? 'reference' : 'image');
    void (async () => {
      const imgs = await Promise.all(
        handoff.images.slice(0, 6).map((u) => tryPersistMediaUrl(u, 'image'))
      );
      setImages(imgs);
    })();
    if (handoff.skuCode) setSkuPick(handoff.skuCode);
    if (handoff.skuName) setSkuName(handoff.skuName);
    if (!prompt.trim()) {
      setPrompt(
        handoff.images.length > 1
          ? 'Keep product identity consistent, smooth orbit around product, studio lighting, clean background'
          : 'Product hero video, gentle camera push-in, studio lighting, clean background'
      );
    }
    setMsg(
      handoff.note
        ? `已从平面设计带入 ${handoff.images.length} 张参考图：${handoff.note}`
        : `已带入 ${handoff.images.length} 张参考图，可直接生成样片`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅启动时消费一次交接包
  }, []);

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
    if (list.length > 1 || images.length >= 1) setMode('reference');
    list.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      if (file.size > 18 * 1024 * 1024) {
        setMsg('单张图片请小于 18MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        setImages((prev) => {
          const next = [...prev, String(reader.result || '')].slice(0, 6);
          if (next.length > 1) setMode('reference');
          return next;
        });
      reader.readAsDataURL(file);
    });
  };

  const activeVideoSkill =
    VIDEO_SKILLS.find((s) => s.id === videoSkillId) || VIDEO_SKILLS[0];

  const buildVideoPromptParts = (hasRefs: boolean) =>
    composeVideoGenerationPrompt({
      basePrompt: prompt.trim() || activeVideoSkill.defaultPrompt,
      storyboard: storyboard.trim() || undefined,
      hasReferenceImages: hasRefs,
      skillNegative: negativePrompt.trim() || activeVideoSkill.negativeHints,
    });

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
    const effectiveMode: VideoMode =
      mode === 'text' ? 'text' : images.length > 1 ? 'reference' : mode === 'reference' ? 'reference' : 'image';
    if (effectiveMode === 'reference' && mode !== 'reference') setMode('reference');
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const job: VideoJob = {
      id: newCreativeId('vid'),
      title: sku
        ? `${sku.skuCode} · ${durationSec}s`
        : skuPick
          ? `${skuPick} · ${durationSec}s`
          : `视频 · ${prompt.trim().slice(0, 20) || '未命名'}`,
      mode: effectiveMode,
      prompt: prompt.trim(),
      storyboard: storyboard.trim() || undefined,
      durationSec,
      aspect,
      sourceImages: images,
      skuCode: sku?.skuCode || skuPick || undefined,
      skuName: sku?.name || skuName,
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
    setMsg(
      effectiveMode === 'reference'
        ? `正在提交多参考样片（${images.length} 张）…`
        : '正在提交样片任务…'
    );

    try {
      const parts = buildVideoPromptParts(images.length > 0);
      const result = await generateProductVideo({
        mode: effectiveMode,
        prompt: parts.prompt || 'Product showcase, smooth camera orbit, studio lighting',
        sourceImage: images[0],
        referenceImages: images.slice(1),
        durationSec,
        aspect,
        resolution: '720P',
        tier: 'draft',
        negativePrompt: parts.negative,
        onProgress: (pct, status) => {
          patchJob(job.id, {
            progress: Math.round(pct),
            previewHint: `样片生成中 ${Math.round(pct)}% · ${status}`,
          });
          setMsg(`样片生成中 ${Math.round(pct)}%`);
        },
      });
      const vaulted = await persistVideoJob({
        ...job,
        status: 'draft',
        progress: 100,
        providerTaskId: result.taskId,
        draftVideoUrl: result.videoUrl,
        previewHint: '样片已就绪（已存本机）。确认后进入正片。',
        error: undefined,
        updatedAt: Date.now(),
      });
      patchJob(job.id, {
        status: 'draft',
        progress: 100,
        providerTaskId: vaulted.providerTaskId,
        draftVideoUrl: vaulted.draftVideoUrl,
        previewHint: vaulted.previewHint,
        error: undefined,
      });
      setMsg('样片已完成并写入本机 — 确认后再出正片以控制成本');
    } catch (e: any) {
      const errText = humanizeCreativeProviderError(e?.message || e);
      patchJob(job.id, {
        status: 'failed',
        progress: 0,
        error: errText,
        previewHint: errText,
      });
      setBusy(false);
      setMsg(errText);
      window.alert(`视频生成失败：${errText}`);
      return;
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
      const fullParts = composeVideoGenerationPrompt({
        basePrompt: active.prompt || activeVideoSkill.defaultPrompt || 'Product hero video, cinematic lighting',
        storyboard: active.storyboard,
        hasReferenceImages: (active.sourceImages || []).length > 0,
        skillNegative: negativePrompt.trim() || activeVideoSkill.negativeHints,
      });
      const result = await generateProductVideo({
        mode: active.mode,
        prompt: fullParts.prompt,
        sourceImage: active.sourceImages[0],
        referenceImages: active.sourceImages.slice(1),
        durationSec: active.durationSec,
        aspect: active.aspect,
        resolution: '1080P',
        tier: 'full',
        negativePrompt: fullParts.negative,
        onProgress: (pct, status) => {
          patchJob(active.id, {
            progress: Math.round(pct),
            previewHint: `正片生成中 ${Math.round(pct)}% · ${status}`,
          });
          setMsg(`正片生成中 ${Math.round(pct)}%`);
        },
      });
      const vaulted = await persistVideoJob({
        ...active,
        status: 'ready',
        progress: 100,
        draftConfirmed: true,
        providerTaskId: result.taskId,
        videoUrl: result.videoUrl,
        previewHint: '正片已完成（已存本机），可下载成片',
        error: undefined,
        updatedAt: Date.now(),
      });
      patchJob(active.id, {
        status: 'ready',
        progress: 100,
        draftConfirmed: true,
        providerTaskId: vaulted.providerTaskId,
        videoUrl: vaulted.videoUrl,
        draftVideoUrl: vaulted.draftVideoUrl,
        previewHint: vaulted.previewHint,
        error: undefined,
      });
      setMsg('正片已完成并写入本机');
    } catch (e: any) {
      const errText = humanizeCreativeProviderError(e?.message || e);
      patchJob(active.id, {
        status: 'draft',
        error: errText,
        previewHint: `${errText}（可重试正片）`,
      });
      setMsg(errText);
      window.alert(`正片生成失败：${errText}`);
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

  const draftUrl = useVaultUrl(active?.draftVideoUrl);
  const fullUrl = useVaultUrl(active?.videoUrl);
  const playUrl = fullUrl || draftUrl;

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
              可直接选用平面多角度套图或产品库图片；有参考时锁定产品身份并关闭提示扩写防漂移。先出样片确认，再渲正片。
            </p>
            <div className="mt-2">
              <CreativePipelineBar current="video" onNavigate={onNavigateModule} />
            </div>
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

            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                Skills
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-0.5">
                {VIDEO_SKILLS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setVideoSkillId(s.id);
                      if (s.defaultPrompt) setPrompt(s.defaultPrompt);
                      setNegativePrompt(s.negativeHints || '');
                      if (s.storyboardZh) setStoryboard(s.storyboardZh);
                      if (s.aspectHint.includes('9:16')) setAspect('9:16');
                      else if (s.aspectHint.includes('1:1')) setAspect('1:1');
                      else if (s.aspectHint.includes('16:9')) setAspect('16:9');
                    }}
                    className={`w-full text-left rounded-xl border px-2.5 py-2 transition-colors ${
                      videoSkillId === s.id
                        ? 'border-rose-400 bg-rose-50'
                        : 'border-slate-100 hover:border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-slate-800">{s.label}</span>
                      <span className="text-[9px] font-bold text-rose-600/80">{s.category}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium mt-0.5 leading-snug">
                      {s.hint}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {(mode === 'image' || mode === 'reference') && (
              <div className="space-y-2">
                <CreativeRefPicker
                  value={images}
                  onChange={(urls) => {
                    setImages(urls);
                    // 多选时自动切到多参考，保证下游按多图生成
                    if (urls.length > 1 && mode === 'image') setMode('reference');
                  }}
                  multiple
                  max={6}
                  accent="rose"
                  title="从平面设计 / 产品库多选（可点 × 去掉多余图）"
                  onSkuMeta={(meta) => {
                    if (meta?.skuCode) setSkuPick(meta.skuCode);
                    setSkuName(meta?.skuName);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/40 py-3 text-xs font-black text-rose-800"
                >
                  或本地上传参考图（可多选）· 已选 {images.length}/6
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addImages(e.target.files);
                    e.target.value = '';
                  }}
                />
                <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                  可连续勾选多张；选 ≥2 张时自动按多参考生成。
                </p>
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
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  负向约束（不想出现的）
                </label>
                <button
                  type="button"
                  onClick={() => setNegativePrompt(activeVideoSkill.negativeHints || '')}
                  className="text-[9px] font-bold text-rose-600 hover:text-rose-800"
                >
                  恢复 Skill 默认
                </button>
              </div>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={2}
                placeholder="如：变形、闪烁、水印、乱码字幕…"
                className="mt-1 w-full rounded-xl border border-rose-100 bg-rose-50/40 px-3 py-2 text-xs font-medium text-slate-700 resize-y"
              />
              <p className="text-[9px] text-slate-400 font-medium mt-1">
                写入视频负向通道；另叠加通用拒绝项。
              </p>
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
                onChange={(e) => {
                  const id = e.target.value;
                  setSkuPick(id);
                  const s = skus.find((x) => x.id === id);
                  if (s?.images?.length && (mode === 'image' || mode === 'reference')) {
                    setImages(s.images.slice(0, 6));
                  }
                }}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">不挂接</option>
                {skus.slice(0, 80).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.skuCode} · {s.name}
                    {s.images?.length ? ' · 有图' : ''}
                  </option>
                ))}
              </select>
              {skuPick && skus.find((s) => s.id === skuPick)?.images?.length ? (
                <p className="text-[10px] font-bold text-rose-700 mt-1">
                  已带入产品库图片，可用于图生/多参考视频
                </p>
              ) : null}
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
          <div className="px-4 py-2.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-300">
            <span>预览台</span>
            <CreativeStorageBadge compact className="!bg-white/10 !border-white/20 !text-slate-200" />
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
                  <VaultImg
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
                  href={draftUrl || undefined}
                  target={draftUrl?.startsWith('http') ? '_blank' : undefined}
                  rel="noreferrer"
                  download={`${(active.title || 'sample').replace(/\s+/g, '_')}-样片.mp4`}
                  onClick={(e) => {
                    if (!draftUrl) {
                      e.preventDefault();
                      window.alert('样片还在准备本机地址，请稍等再点下载');
                    }
                  }}
                  className={`w-full rounded-xl text-white text-sm font-black py-2.5 inline-flex items-center justify-center gap-2 ${
                    draftUrl ? 'bg-white/10 hover:bg-white/15' : 'bg-white/5 opacity-60 cursor-wait'
                  }`}
                >
                  <Download size={16} /> {draftUrl ? '下载样片' : '准备下载…'}
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
                href={fullUrl || undefined}
                target={fullUrl?.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
                download={`${(active.title || 'video').replace(/\s+/g, '_')}-正片.mp4`}
                onClick={(e) => {
                  if (!fullUrl) {
                    e.preventDefault();
                    window.alert('正片还在准备本机地址，请稍等再点下载');
                  }
                }}
                className={`w-full rounded-xl text-white text-sm font-black py-2.5 inline-flex items-center justify-center gap-2 ${
                  fullUrl ? 'bg-indigo-500 hover:bg-indigo-400' : 'bg-indigo-500/40 opacity-60 cursor-wait'
                }`}
              >
                <Download size={16} /> {fullUrl ? '下载正片' : '准备下载…'}
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
