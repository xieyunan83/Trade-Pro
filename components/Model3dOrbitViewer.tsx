import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Move3d, RotateCcw } from 'lucide-react';

type Props = {
  /** GLB / GLTF 地址（临时签名链也可） */
  src: string;
  /** 平面预览图作加载中海报 */
  poster?: string;
  className?: string;
  /** 默认自动慢转；拖动时用户接管 */
  autoRotate?: boolean;
};

/**
 * 可拖动环视的真实 3D 预览（@google/model-viewer）。
 * 鼠标拖动旋转、滚轮缩放、触控双指缩放。
 */
export const Model3dOrbitViewer: React.FC<Props> = ({
  src,
  poster,
  className = '',
  autoRotate = true,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [libOk, setLibOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await import('@google/model-viewer');
        if (!cancelled) setLibOk(true);
      } catch (e: any) {
        if (!cancelled) setLoadErr(e?.message || '3D 预览组件加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setReady(false);
    setLoadErr(null);
  }, [src]);

  useEffect(() => {
    if (!libOk || !hostRef.current || !src) return;
    const el = hostRef.current.querySelector('model-viewer');
    if (!el) return;

    const onLoad = () => setReady(true);
    const onError = () =>
      setLoadErr('模型加载失败（链接可能过期，请重新生成或下载后本地打开）');
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
    };
  }, [libOk, src]);

  const resetCamera = () => {
    const el = hostRef.current?.querySelector('model-viewer') as any;
    try {
      el?.resetTurntableRotation?.();
      if (el) el.cameraOrbit = '0deg 75deg 105%';
      el?.jumpCameraToGoal?.();
    } catch {
      /* ignore */
    }
  };

  if (loadErr && !libOk) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 p-6 text-center ${className}`}>
        <p className="text-sm text-rose-300 font-bold">{loadErr}</p>
        {poster ? (
          <img src={poster} alt="" className="max-h-48 rounded-xl object-contain opacity-80" />
        ) : null}
      </div>
    );
  }

  return (
    <div ref={hostRef} className={`relative w-full h-full min-h-[280px] ${className}`}>
      {!ready && !loadErr && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/60 pointer-events-none">
          <Loader2 className="animate-spin text-indigo-400" size={28} />
          <p className="text-xs font-bold text-slate-400">加载可旋转 3D 模型…</p>
        </div>
      )}
      {loadErr && libOk && (
        <div className="absolute top-2 left-2 right-2 z-20 rounded-lg bg-rose-950/80 border border-rose-500/40 px-2 py-1.5 text-[10px] font-bold text-rose-200">
          {loadErr}
          {poster ? ' · 下方仍显示平面预览图' : ''}
        </div>
      )}
      {libOk
        ? React.createElement('model-viewer', {
            src,
            poster: poster || undefined,
            alt: '3D 产品模型',
            'camera-controls': true,
            'touch-action': 'pan-y',
            ...(autoRotate ? { 'auto-rotate': true } : {}),
            'shadow-intensity': '1',
            exposure: '1',
            'environment-image': 'neutral',
            style: {
              width: '100%',
              height: '100%',
              minHeight: 280,
              background: 'transparent',
            },
          })
        : null}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 pointer-events-none">
        <span className="inline-flex items-center gap-1 rounded-lg bg-black/55 text-[10px] font-bold text-slate-200 px-2 py-1">
          <Move3d size={12} /> 拖动旋转 · 滚轮缩放
        </span>
        <button
          type="button"
          onClick={resetCamera}
          className="pointer-events-auto inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-bold text-white px-2 py-1"
          title="重置视角"
        >
          <RotateCcw size={12} /> 重置
        </button>
      </div>
    </div>
  );
};
