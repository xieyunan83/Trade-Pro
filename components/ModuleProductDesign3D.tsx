import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  ExternalLink,
  KeyRound,
  Save,
} from 'lucide-react';
import type { User } from '../types';
import { ModuleType } from '../types';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import {
  type Model3dJob,
  type Model3dMode,
  type Model3dQuality,
  loadModel3dJobs,
  saveModel3dJobs,
  newCreativeId,
} from '../services/creativeStudioStore';
import {
  generateModel3d,
  getModel3dProviderStatus,
  hydrateModel3dProvider,
} from '../services/model3dService';
import { loadDataProviderLocal, saveDataProvider } from '../services/dataProviders';
import { consumeCreativeHandoff } from '../services/creativeAssetBridge';
import { CreativePipelineBar, CreativeRefPicker } from './CreativeRefPicker';
import { MODEL3D_SKILLS, type Model3dSkillId } from '../services/creativeSkills/model3dSkills';
import { Model3dOrbitViewer } from './Model3dOrbitViewer';

type Props = {
  currentUser: User;
  onNavigateModule?: (mod: ModuleType) => void;
};

/**
 * 产品设计 · 3D：图/文生 3D、品质档、真实 GLB 导出。
 */
export const ModuleProductDesign3D: React.FC<Props> = ({ currentUser, onNavigateModule }) => {
  const [jobs, setJobs] = useState<Model3dJob[]>(() => loadModel3dJobs());
  const [mode, setMode] = useState<Model3dMode>('image');
  const [modelSkillId, setModelSkillId] = useState<Model3dSkillId>('turntable_hero');
  const [quality, setQuality] = useState<Model3dQuality>('high_detail');
  const [prompt, setPrompt] = useState('');
  const [sourceImages, setSourceImages] = useState<string[]>([]);
  const [skuPick, setSkuPick] = useState('');
  const [skuName, setSkuName] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<'info' | 'error' | 'ok'>('info');
  const [activeId, setActiveId] = useState<string | null>(jobs[0]?.id || null);
  const [provider, setProvider] = useState(() => getModel3dProviderStatus());
  const [hydrating, setHydrating] = useState(true);
  const [quickKey, setQuickKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const active = jobs.find((j) => j.id === activeId) || null;
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'director';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHydrating(true);
      const st = await hydrateModel3dProvider();
      if (!cancelled) {
        setProvider(st);
        setHydrating(false);
        if (!st.ready) {
          setMsgTone('error');
          setMsg(st.detail);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handoff = consumeCreativeHandoff('design_3d');
    if (!handoff?.images?.[0]) return;
    setMode('image');
    setSourceImages(handoff.images.slice(0, 4));
    if (handoff.skuCode) setSkuPick(handoff.skuCode);
    if (handoff.skuName) setSkuName(handoff.skuName);
    setMsgTone('ok');
    setMsg(
      handoff.note
        ? `已从平面设计带入 ${Math.min(handoff.images.length, 4)} 张参考图：${handoff.note}`
        : `已从平面设计带入 ${Math.min(handoff.images.length, 4)} 张参考图（可多选多角度），可直接生成 3D`
    );
  }, []);

  const saveQuickKey = async () => {
    const key = quickKey.replace(/^\uFEFF/, '').replace(/^Bearer\s+/i, '').replace(/\s+/g, '').trim();
    if (!key) {
      setMsgTone('error');
      setMsg('请粘贴图生 3D API Key（千问 sk-… / Tripo tsk_… / 备选均可）');
      return;
    }
    setSavingKey(true);
    // sk- → 千问 MaaS · Tripo；tsk_ → Tripo 官方；其余 → 混元备选
    const target = /^sk-/i.test(key) ? 'qwen_tripo' : /^tsk_/i.test(key) ? 'tripo' : 'hunyuan3d';
    const prev = loadDataProviderLocal(target);
    await saveDataProvider(target, {
      ...prev,
      enabled: true,
      apiKey: key,
      ...(target === 'qwen_tripo'
        ? {
            apiBase: prev.apiBase?.trim() || 'https://cn-beijing.maas.qianwenaiapi.com',
            extra: { ...(prev.extra || {}), modelId: prev.extra?.modelId || 'Tripo/Tripo-H3.1' },
          }
        : {}),
    });
    const st = getModel3dProviderStatus();
    setProvider(st);
    setSavingKey(false);
    setQuickKey('');
    setMsgTone(st.ready ? 'ok' : 'error');
    setMsg(
      st.ready
        ? target === 'qwen_tripo'
          ? '千问通道 Key 已保存并启用，可以开始生成'
          : target === 'hunyuan3d'
            ? '3D 备选 Key 已保存并启用，可以开始生成'
            : '3D API 已保存并启用，可以开始生成'
        : st.detail
    );
  };

  const persist = (next: Model3dJob[]) => {
    setJobs(next);
    saveModel3dJobs(next);
  };

  const patchJob = (id: string, patch: Partial<Model3dJob>) => {
    setJobs((prev) => {
      const next = prev.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: Date.now() } : j));
      saveModel3dJobs(next);
      return next;
    });
  };

  const onPickImages = (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 4);
    list.forEach((file) => {
      if (!file.type.startsWith('image/')) {
        setMsgTone('error');
        setMsg('请上传图片文件');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setMsgTone('error');
        setMsg('单张图片请小于 10MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        setSourceImages((prev) => [...prev, String(reader.result || '')].slice(0, 4));
      reader.readAsDataURL(file);
    });
  };

  const runGenerate = async () => {
    const live = getModel3dProviderStatus();
    setProvider(live);
    if (!live.ready) {
      setMsgTone('error');
      setMsg(live.detail);
      window.alert(live.detail);
      return;
    }
    if (mode === 'image' && !sourceImages.length) {
      setMsgTone('error');
      setMsg('请先选用或上传产品图（可多选多角度）');
      window.alert('请先选用或上传产品图，再生成 3D');
      return;
    }
    if (mode === 'text' && !prompt.trim()) {
      setMsgTone('error');
      setMsg('请填写文字描述');
      window.alert('请填写文字描述');
      return;
    }
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const job: Model3dJob = {
      id: newCreativeId('m3d'),
      title: sku
        ? `${sku.skuCode} · 3D`
        : skuPick
          ? `${skuPick} · 3D`
          : mode === 'image'
            ? sourceImages.length > 1
              ? `多视图 3D · ${sourceImages.length} 张`
              : '图生 3D'
            : `文生 3D · ${prompt.trim().slice(0, 24)}`,
      mode,
      quality,
      prompt: prompt.trim(),
      sourceImage: sourceImages[0],
      sourceImages: sourceImages.slice(0, 4),
      skuCode: sku?.skuCode || skuPick || undefined,
      skuName: sku?.name || skuName,
      status: 'running',
      progress: 0,
      exportFormats: ['GLB'],
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    persist([job, ...jobs]);
    setActiveId(job.id);
    setBusy(true);
    setMsgTone('info');
    setMsg(
      sourceImages.length > 1
        ? `正在提交多视图 3D 任务（${sourceImages.length} 张）…`
        : '正在提交 3D 任务…'
    );

    const skill =
      MODEL3D_SKILLS.find((s) => s.id === modelSkillId) || MODEL3D_SKILLS[0];
    const fullPrompt = [
      prompt.trim() || skill.defaultPrompt,
      skill.negativeHints ? `Avoid: ${skill.negativeHints}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const result = await generateModel3d({
        mode,
        prompt: fullPrompt,
        sourceImage: sourceImages[0],
        sourceImages,
        quality,
        onProgress: (pct, status) => {
          const label =
            status === 'uploading' || status === 'uploaded'
              ? '上传参考图'
              : status === 'running'
                ? '重建网格'
                : status;
          patchJob(job.id, {
            progress: Math.round(pct),
            previewHint: `${label} ${Math.round(pct)}%`,
          });
          setMsgTone('info');
          setMsg(`${label} ${Math.round(pct)}%`);
        },
      });
      patchJob(job.id, {
        status: 'ready',
        progress: 100,
        providerTaskId: result.taskId,
        modelUrl: result.modelUrl,
        pbrModelUrl: result.pbrModelUrl,
        baseModelUrl: result.baseModelUrl,
        previewImageUrl: result.previewImageUrl,
        previewHint: '模型已就绪 · 可拖动环视 · 可下载 GLB',
        error: undefined,
      });
      setMsgTone('ok');
      setMsg('3D 模型已生成：右侧可拖动旋转查看，也可下载 GLB');
    } catch (e: any) {
      const { humanizeCreativeProviderError } = await import('../services/providerErrorMessage');
      const errText = humanizeCreativeProviderError(e?.message || e);
      // 先落失败态再弹窗，避免界面卡在「生成中 8%」
      patchJob(job.id, {
        status: 'failed',
        progress: 0,
        error: errText,
        previewHint: errText,
      });
      setBusy(false);
      setMsgTone('error');
      setMsg(errText);
      window.alert(`3D 生成失败：${errText}`);
      return;
    } finally {
      setBusy(false);
    }
  };

  const removeJob = (id: string) => {
    if (!confirm('删除该 3D 任务？')) return;
    const next = jobs.filter((j) => j.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
  };

  const downloadUrl = active?.pbrModelUrl || active?.modelUrl || active?.baseModelUrl;

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
              可选用平面设计出图或产品库图片作参考，真实生成可下载的 3D 网格（GLB）。
            </p>
            <div className="mt-2">
              <CreativePipelineBar current="3d" onNavigate={onNavigateModule} />
            </div>
          </div>
          <div
            className={`text-[10px] font-bold rounded-xl px-3 py-2 border ${
              hydrating
                ? 'text-slate-600 bg-slate-50 border-slate-200'
                : provider.ready
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : 'text-rose-800 bg-rose-50 border-rose-200'
            }`}
          >
            {hydrating ? '正在同步配置…' : provider.ready ? '3D 服务已就绪' : '需配置 API Key'}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 space-y-3">
          {!provider.ready && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 space-y-2">
              <div className="text-xs font-black text-rose-900 flex items-center gap-1.5">
                <KeyRound size={14} /> 尚未配置图生 3D API
              </div>
              <p className="text-[11px] text-rose-800/90 font-medium leading-relaxed">
                未配置 Key 时点击「生成」不会创建任务。请管理员在「系统管理 → 数据接入 → 千问通道 · Tripo 3D」启用并填写
                Key（格式通常以 tsk_ 开头）。
              </p>
              {isAdmin && (
                <div className="space-y-2 pt-1">
                  <label className="text-[10px] font-black text-rose-700 uppercase tracking-wider">
                    管理员快捷配置
                  </label>
                  <input
                    type="password"
                    value={quickKey}
                    onChange={(e) => setQuickKey(e.target.value)}
                    placeholder="粘贴 Key（tsk_ 主路径 / TokenHub 备选）"
                    className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    disabled={savingKey}
                    onClick={() => void saveQuickKey()}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-black py-2.5 disabled:opacity-60"
                  >
                    {savingKey ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    保存并启用
                  </button>
                </div>
              )}
            </div>
          )}
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

            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <Sparkles size={12} /> Skills
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar">
                {MODEL3D_SKILLS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setModelSkillId(s.id);
                      if (s.defaultPrompt) setPrompt(s.defaultPrompt);
                      setQuality(s.qualityHint);
                    }}
                    className={`w-full text-left rounded-xl border px-2.5 py-2 ${
                      modelSkillId === s.id
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-slate-100 hover:border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-black text-slate-800">{s.label}</span>
                      <span className="text-[9px] font-bold text-indigo-600/80">{s.category}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium mt-0.5">{s.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            {mode === 'image' ? (
              <div className="space-y-2">
                <CreativeRefPicker
                  value={sourceImages}
                  onChange={setSourceImages}
                  multiple
                  max={4}
                  accent="indigo"
                  title="从平面设计 / 产品库多选（最多 4 张，建议正面·侧面·背面）"
                  onSkuMeta={(meta) => {
                    if (meta?.skuCode) setSkuPick(meta.skuCode);
                    setSkuName(meta?.skuName);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full min-h-[100px] rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 flex flex-col items-center justify-center gap-2 text-indigo-800"
                >
                  <Upload size={22} />
                  <span className="text-xs font-black">
                    或本地上传（可多选）· 已选 {sourceImages.length}/4
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      onPickImages(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </button>
                <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                  多选 ≥2 张将按多视图重建（更贴近平面设计）；单张则走常规图生 3D。
                </p>
              </div>
            ) : null}

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                描述 / 补充提示
              </label>
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
                  <p className="text-[10px] text-slate-500 mt-1 font-medium">高面数 · PBR 纹理</p>
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
                  <p className="text-[10px] text-slate-500 mt-1 font-medium">智能减面 · 实时预览</p>
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Package size={10} /> 挂接产品库（可选）
              </label>
              <select
                value={skuPick}
                onChange={(e) => {
                  const id = e.target.value;
                  setSkuPick(id);
                  const s = skus.find((x) => x.id === id);
                  if (s?.images?.length && mode === 'image') {
                    setSourceImages(s.images.filter(Boolean).slice(0, 4));
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
              {skuPick && skus.find((s) => s.id === skuPick)?.images?.[0] ? (
                <p className="text-[10px] font-bold text-indigo-700 mt-1">
                  已带入产品库图片（可多选），可直接图生 3D 或增删参考
                </p>
              ) : null}
            </div>

            <button
              type="button"
              disabled={busy || hydrating}
              onClick={() => void runGenerate()}
              className={`w-full rounded-xl text-white text-sm font-black py-3 disabled:opacity-50 inline-flex items-center justify-center gap-2 ${
                provider.ready
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-slate-700 hover:bg-slate-800'
              }`}
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Box size={16} />}
              {busy
                ? `生成中… ${active?.progress ?? 0}%`
                : provider.ready
                  ? '生成 3D 模型'
                  : '生成 3D 模型（需先配置 Key）'}
            </button>
            {msg && (
              <p
                className={`text-xs font-bold rounded-xl px-3 py-2 border ${
                  msgTone === 'error'
                    ? 'text-rose-900 bg-rose-50 border-rose-200'
                    : msgTone === 'ok'
                      ? 'text-emerald-900 bg-emerald-50 border-emerald-200'
                      : 'text-indigo-900 bg-indigo-50 border-indigo-100'
                }`}
              >
                {msg}
              </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-slate-950 text-white overflow-hidden min-h-[400px] flex flex-col">
          <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between text-xs font-bold text-slate-300">
            <span>
              {active?.status === 'ready' && downloadUrl ? '3D 环视预览' : '视口预览'}
            </span>
            {active && (
              <span className="uppercase tracking-wider text-[10px] text-indigo-300">
                {active.status}
                {typeof active.progress === 'number' && active.status === 'running'
                  ? ` · ${active.progress}%`
                  : ''}{' '}
                · {active.quality === 'high_detail' ? '高细节' : '引擎就绪'}
              </span>
            )}
          </div>
          <div className="flex-1 relative flex items-stretch justify-center min-h-[300px]">
            {active?.status === 'running' ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-3 p-6">
                <Loader2 className="mx-auto animate-spin text-indigo-400" size={36} />
                <p className="text-sm font-bold text-slate-300">
                  {(active.previewHint || '').includes('upload') || (active.progress ?? 0) < 12
                    ? '正在上传参考图并重建网格…'
                    : '正在重建网格…'}
                </p>
                <div className="w-48 h-1.5 rounded-full bg-white/10 mx-auto overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${active.progress ?? 5}%` }}
                  />
                </div>
              </div>
            ) : active?.status === 'ready' && downloadUrl ? (
              <Model3dOrbitViewer
                src={downloadUrl}
                poster={active.previewImageUrl || active.sourceImage}
                className="flex-1"
              />
            ) : active?.previewImageUrl ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <img
                  src={active.previewImageUrl}
                  alt=""
                  className="max-h-72 rounded-2xl shadow-2xl shadow-indigo-500/20 object-contain"
                />
              </div>
            ) : active?.sourceImage ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="relative">
                  <img
                    src={active.sourceImage}
                    alt=""
                    className="relative max-h-64 rounded-2xl object-contain opacity-80"
                  />
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-black bg-indigo-500/90 px-2 py-1 rounded-lg whitespace-nowrap">
                    参考图
                  </div>
                </div>
              </div>
            ) : active ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-2 px-4">
                <p className="text-sm font-bold text-slate-300">{active.title}</p>
                <p className="text-xs text-slate-500">{active.error || active.previewHint}</p>
              </div>
            ) : (
              <p className="flex-1 flex items-center justify-center text-sm text-slate-500 font-medium">
                从左侧创建任务后在此预览；生成完成后可拖动旋转查看
              </p>
            )}
          </div>
          {active?.status === 'ready' && downloadUrl && (
            <div className="px-4 py-3 border-t border-white/10 flex flex-wrap gap-2">
              <a
                href={downloadUrl}
                target="_blank"
                rel="noreferrer"
                download
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-[11px] font-black px-3 py-2 text-white"
              >
                <Download size={12} /> 下载 GLB
              </a>
              {active.previewImageUrl && (
                <a
                  href={active.previewImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] font-black px-3 py-2"
                >
                  <ExternalLink size={12} /> 平面渲染图
                </a>
              )}
            </div>
          )}
        </div>

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
                      {j.modelUrl ? ' · GLB' : ''}
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
