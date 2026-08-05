import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Upload,
  Loader2,
  Download,
  Image as ImageIcon,
  Trash2,
  Sparkles,
  AlertTriangle,
  Smartphone,
} from 'lucide-react';
import { generateWanImage } from '../services/wanImageService';
import {
  DEFAULT_MULTI_FIELDS,
  DEFAULT_SINGLE_FIELDS,
  MultiPosterFields,
  SinglePosterFields,
  buildMultiProductPosterPrompt,
  buildSingleProductPosterPrompt,
  REMOVE_BG_PROMPT,
} from '../services/posterTemplates';

const LOGO_LS = 'trade_scout_brand_logo';

type PosterMode = 'single' | 'multi';
type LogoMode = 'builtin' | 'custom' | 'none';

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export const ModulePosterStudio: React.FC = () => {
  const [mode, setMode] = useState<PosterMode>('single');
  const [productImages, setProductImages] = useState<string[]>([]);
  const [cutouts, setCutouts] = useState<string[]>([]);
  const [logoMode, setLogoMode] = useState<LogoMode>('builtin');
  const [builtinLogo, setBuiltinLogo] = useState('');
  const [customLogo, setCustomLogo] = useState('');
  const [singleFields, setSingleFields] = useState<SinglePosterFields>(DEFAULT_SINGLE_FIELDS);
  const [multiFields, setMultiFields] = useState<MultiPosterFields>(DEFAULT_MULTI_FIELDS);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

  useEffect(() => {
    const saved = localStorage.getItem(LOGO_LS) || '';
    setBuiltinLogo(saved);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (e: any) {
      setError(e?.message || '无法打开摄像头，请检查权限或改用上传');
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.92);
    setProductImages((prev) => (mode === 'single' ? [data] : [...prev, data].slice(0, 6)));
    setCutouts([]);
    stopCamera();
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      urls.push(await fileToDataUrl(f));
    }
    setProductImages((prev) => {
      if (mode === 'single') return [urls[0]];
      return [...prev, ...urls].slice(0, 6);
    });
    setCutouts([]);
  };

  const saveBuiltinLogo = async (file: File) => {
    const data = await fileToDataUrl(file);
    localStorage.setItem(LOGO_LS, data);
    setBuiltinLogo(data);
  };

  const removeBgOne = async (img: string): Promise<string> => {
    const res = await generateWanImage({
      prompt: REMOVE_BG_PROMPT,
      referenceImages: [img],
      size: '2K',
      n: 1,
      thinkingMode: true,
      watermark: false,
    });
    return res.images[0];
  };

  /** 参考图顺序：LOGO（可选）→ 原图（外观主依据）→ 抠图（干净合成） */
  const buildReferenceStack = (originals: string[], cut: string[], logo?: string): string[] => {
    const refs: string[] = [];
    if (logo) refs.push(logo);
    for (const o of originals) {
      if (o?.trim()) refs.push(o);
    }
    for (const c of cut) {
      if (c?.trim() && !refs.includes(c)) refs.push(c);
    }
    return refs.slice(0, 8);
  };

  const handleCutout = async () => {
    if (!productImages.length) {
      setError('请先拍照或上传产品图');
      return;
    }
    setLoading(true);
    setError(null);
    setStep('正在扣除背景，只保留产品…');
    try {
      const outs: string[] = [];
      for (let i = 0; i < productImages.length; i++) {
        setStep(`扣背景 ${i + 1}/${productImages.length}…`);
        outs.push(await removeBgOne(productImages[i]));
      }
      setCutouts(outs);
      setStep('');
    } catch (e: any) {
      setError(e?.message || '扣背景失败');
    } finally {
      setLoading(false);
    }
  };

  const logoForGen = (): string | undefined => {
    if (logoMode === 'none') return undefined;
    if (logoMode === 'custom') return customLogo || undefined;
    return builtinLogo || undefined;
  };

  const handleGenerate = async () => {
    const originals = productImages;
    if (!originals.length) {
      setError('请先上传/拍摄产品图');
      return;
    }
    if (logoMode === 'builtin' && !builtinLogo) {
      const ok = confirm('尚未保存内置 LOGO。是否先上传一个 LOGO？取消则无 LOGO 继续生成。');
      if (ok) {
        logoRef.current?.click();
        return;
      }
      setLogoMode('none');
    }
    if (logoMode === 'custom' && !customLogo) {
      setError('请上传自定义 LOGO，或选择「不要 LOGO」');
      return;
    }

    setLoading(true);
    setError(null);
    setResultUrl(null);
    try {
      let workingCutouts = cutouts;
      if (!workingCutouts.length) {
        setStep('先扣除背景，便于长图合成…');
        workingCutouts = [];
        for (let i = 0; i < originals.length; i++) {
          setStep(`扣背景 ${i + 1}/${originals.length}…`);
          workingCutouts.push(await removeBgOne(originals[i]));
        }
        setCutouts(workingCutouts);
      }

      setStep('分析产品外观与卖点，生成电商长图（约需 1–2 分钟）…');
      const logo = logoForGen();
      const refs = buildReferenceStack(originals, workingCutouts, logo);

      const prompt =
        mode === 'single'
          ? buildSingleProductPosterPrompt(singleFields, logoMode === 'builtin' && !logo ? 'none' : logoMode)
          : buildMultiProductPosterPrompt(
              multiFields,
              Math.max(originals.length, workingCutouts.length),
              logoMode === 'builtin' && !logo ? 'none' : logoMode
            );

      const res = await generateWanImage({
        prompt,
        referenceImages: refs,
        size: '2K',
        n: 1,
        thinkingMode: true,
        watermark: false,
        timeoutMs: 180_000,
      });
      setResultUrl(res.images[0]);
      setStep('');
    } catch (e: any) {
      setError(e?.message || '海报生成失败');
    } finally {
      setLoading(false);
    }
  };

  const updateSingle = (key: keyof SinglePosterFields, value: string | boolean) =>
    setSingleFields((p) => ({ ...p, [key]: value }));

  const updateMulti = (key: keyof MultiPosterFields, value: string) =>
    setMultiFields((p) => ({ ...p, [key]: value }));

  return (
    <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6 animate-fade-in pb-24 md:pb-10">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-black text-slate-800 mb-2 flex items-center gap-2">
          <Sparkles className="text-pink-600" /> 产品海报工作室
        </h2>
        <p className="text-sm text-slate-500 font-medium mb-4">
          {isMobile ? '手机可拍照或上传' : '电脑端请上传产品图'} → 扣背景 → 填资料 → 选 LOGO → 生成电商长图。
          万相会先分析产品外观，再结合你填写的名称/型号/尺寸/卖点等，生成英文详情页长图（场景、功能、参数、适用人群）。
        </p>

        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => {
              setMode('single');
              setProductImages((p) => (p[0] ? [p[0]] : []));
            }}
            className={`flex-1 py-3 rounded-xl text-sm font-black touch-manipulation ${
              mode === 'single' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600'
            }`}
          >
            方案一：单品电商长图
          </button>
          <button
            type="button"
            onClick={() => setMode('multi')}
            className={`flex-1 py-3 rounded-xl text-sm font-black touch-manipulation ${
              mode === 'multi' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600'
            }`}
          >
            方案二：多品系列长图
          </button>
        </div>

        {/* 拍照（手机/平板） / 上传（全端） */}
        <div className={`grid gap-2 mb-4 ${isMobile ? 'grid-cols-2' : 'grid-cols-3'}`}>
          <button
            type="button"
            onClick={startCamera}
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 text-white text-xs font-black touch-manipulation md:hidden"
          >
            <Camera size={16} /> 打开摄像头
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 text-xs font-black touch-manipulation"
          >
            <Upload size={16} /> {isMobile ? '相册/上传' : '上传产品图'}
          </button>
          <button
            type="button"
            disabled={loading || !productImages.length}
            onClick={handleCutout}
            className="flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 text-xs font-black disabled:opacity-40 touch-manipulation"
          >
            扣掉背景
          </button>
          <button
            type="button"
            onClick={() => {
              setProductImages([]);
              setCutouts([]);
              setResultUrl(null);
            }}
            className="flex items-center justify-center gap-2 py-3 rounded-xl border border-red-100 text-red-500 text-xs font-black touch-manipulation"
          >
            <Trash2 size={16} /> 清空图
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture={isMobile ? 'environment' : undefined}
            multiple={mode === 'multi'}
            className="hidden"
            onChange={(e) => onPickFiles(e.target.files)}
          />
        </div>

        {cameraOpen && (
          <div className="mb-4 rounded-2xl overflow-hidden border border-slate-200 bg-black">
            <video ref={videoRef} playsInline muted className="w-full max-h-[50vh] object-contain" />
            <div className="flex gap-2 p-3 bg-slate-900">
              <button type="button" onClick={capturePhoto} className="flex-1 py-3 rounded-xl bg-white text-slate-900 font-black text-sm">
                拍照
              </button>
              <button type="button" onClick={stopCamera} className="px-4 py-3 rounded-xl text-white text-sm font-bold">
                取消
              </button>
            </div>
          </div>
        )}

        {(productImages.length > 0 || cutouts.length > 0) && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            {(cutouts.length ? cutouts : productImages).map((src, i) => (
              <img key={i} src={src} alt="" className="h-24 w-24 object-contain rounded-xl border bg-slate-50 flex-shrink-0" />
            ))}
            {cutouts.length > 0 && (
              <span className="text-[10px] font-black text-emerald-600 self-center whitespace-nowrap">已扣背景</span>
            )}
          </div>
        )}

        {/* LOGO */}
        <div className="mb-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-3">
          <div className="text-xs font-black text-slate-700 flex items-center gap-2">
            <ImageIcon size={14} /> LOGO 选项（每次生成前确认）
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'builtin' as const, label: '使用内置 LOGO' },
                { id: 'custom' as const, label: '上传新 LOGO' },
                { id: 'none' as const, label: '不要 LOGO' },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setLogoMode(o.id)}
                className={`px-3 py-2 rounded-xl text-[11px] font-black touch-manipulation ${
                  logoMode === o.id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {builtinLogo && (
              <img src={builtinLogo} alt="logo" className="h-10 object-contain bg-white rounded border px-2" />
            )}
            <button
              type="button"
              onClick={() => logoRef.current?.click()}
              className="text-[11px] font-black text-blue-600"
            >
              {builtinLogo ? '更新内置 LOGO' : '上传并保存为内置 LOGO'}
            </button>
            <input
              ref={logoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (logoMode === 'custom') setCustomLogo(await fileToDataUrl(f));
                else await saveBuiltinLogo(f);
              }}
            />
            {logoMode === 'custom' && customLogo && (
              <img src={customLogo} alt="custom" className="h-10 object-contain bg-white rounded border px-2" />
            )}
          </div>
        </div>

        {/* 资料表单 */}
        {mode === 'single' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {(
              [
                ['productName', '产品名称（海报大标题）'],
                ['modelNo', '型号 NO'],
                ['seriesName', '系列 NAME'],
                ['size', '产品尺寸 SIZE'],
                ['packingAmount', '装箱量'],
                ['grossWeight', '毛重'],
                ['netWeight', '净重'],
                ['boxSize', '外箱/彩盒尺寸'],
                ['age', '适龄'],
                ['benefit1', '卖点1'],
                ['benefit2', '卖点2'],
                ['benefit3', '卖点3'],
              ] as [keyof SinglePosterFields, string][]
            ).map(([key, label]) => (
              <div key={key}>
                <label className="block text-[10px] font-black text-slate-400 mb-1">{label}</label>
                <input
                  value={String(singleFields[key] ?? '')}
                  onChange={(e) => updateSingle(key, e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {(
              [
                ['collectionTitle', '系列标题'],
                ['brandName', '品牌名'],
                ['year', '年份'],
                ['mainModel', '主型号'],
                ['mainFeatures', '卖点说明'],
                ['productSize', '产品尺寸'],
                ['packageSize', '包装尺寸'],
                ['contactEmail', '页脚邮箱'],
              ] as [keyof MultiPosterFields, string][]
            ).map(([key, label]) => (
              <div key={key}>
                <label className="block text-[10px] font-black text-slate-400 mb-1">{label}</label>
                <input
                  value={multiFields[key]}
                  onChange={(e) => updateMulti(key, e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
                />
              </div>
            ))}
            <p className="sm:col-span-2 text-[11px] text-slate-400 font-bold flex items-center gap-1">
              <Smartphone size={12} /> 多品模式请上传 2–6 张产品图（主图 + 颜色款）
            </p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-600 text-sm font-bold flex gap-2">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        <button
          type="button"
          disabled={loading || !productImages.length}
          onClick={handleGenerate}
          className="w-full py-4 rounded-xl bg-pink-600 hover:bg-pink-700 text-white font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50 touch-manipulation"
        >
          {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
          {loading ? step || '生成中…' : '确认并生成海报'}
        </button>
      </div>

      {resultUrl && (
        <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="font-black text-slate-800">生成结果</h3>
            <a
              href={resultUrl}
              download="product-poster.png"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-black text-blue-600"
            >
              <Download size={16} /> 下载
            </a>
          </div>
          <img src={resultUrl} alt="poster" className="w-full rounded-xl border border-slate-100" />
        </div>
      )}
    </div>
  );
};
