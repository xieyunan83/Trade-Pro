import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Move3d, RotateCcw } from 'lucide-react';
import { fetchRemoteBlob } from '../services/fetchRemoteBlob';

type Props = {
  /** GLB / GLTF 地址（临时签名链也可） */
  src: string;
  /** 平面预览图作加载中海报 */
  poster?: string;
  className?: string;
  /** 默认自动慢转；拖动时用户接管 */
  autoRotate?: boolean;
  /** 直链下载（预览失败时强调） */
  downloadHref?: string;
  /** 成功拉到本机 Blob 时回调（用于写入素材库） */
  onLocalBlob?: (blob: Blob) => void;
};

/**
 * 可拖动环视的真实 3D 预览（@google/model-viewer）。
 * 先把远程 GLB 拉成 blob: 再交给 viewer，避免跨域/慢加载一直转圈。
 */
export const Model3dOrbitViewer: React.FC<Props> = ({
  src,
  poster,
  className = '',
  autoRotate = true,
  downloadHref,
  onLocalBlob,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const onBlobRef = useRef(onLocalBlob);
  onBlobRef.current = onLocalBlob;
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [libOk, setLibOk] = useState(false);
  const [viewSrc, setViewSrc] = useState('');
  const [pullPct, setPullPct] = useState(0);
  const [phase, setPhase] = useState<'pull' | 'viewer' | 'done' | 'error'>('pull');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await import('@google/model-viewer');
        if (!cancelled) setLibOk(true);
      } catch (e: any) {
        if (!cancelled) {
          setLoadErr(e?.message || '3D 预览组件加载失败');
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    readyRef.current = false;
    setReady(false);
    setLoadErr(null);
    setPullPct(0);
    setPhase('pull');
    setViewSrc('');

    const raw = (src || '').trim();
    if (!raw) {
      setLoadErr('没有模型地址');
      setPhase('error');
      return;
    }

    (async () => {
      try {
        // 已是本机地址则直接预览
        if (raw.startsWith('blob:') || raw.startsWith('data:')) {
          if (!cancelled) {
            setViewSrc(raw);
            setPhase('viewer');
            setPullPct(100);
          }
          return;
        }
        const blob = await fetchRemoteBlob(raw, {
          timeoutMs: 180_000,
          onProgress: (pct) => {
            if (!cancelled) setPullPct(pct);
          },
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setViewSrc(objectUrl);
        setPhase('viewer');
        setPullPct(100);
        try {
          onBlobRef.current?.(blob);
        } catch {
          /* ignore */
        }
      } catch (e: any) {
        if (cancelled) return;
        // 回退直连 model-viewer（部分 CDN 仅允许标签加载）
        setViewSrc(raw);
        setPhase('viewer');
        setLoadErr(
          String(e?.message || e) +
            '。若下方一直转圈，请立即点「下载 GLB」——模型已生成，不会白费。'
        );
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* ignore */
        }
      }
    };
  }, [src]);

  useEffect(() => {
    if (!libOk || !hostRef.current || !viewSrc || phase === 'pull') return;
    const el = hostRef.current.querySelector('model-viewer');
    if (!el) return;

    const onLoad = () => {
      readyRef.current = true;
      setReady(true);
      setPhase('done');
      setLoadErr(null);
    };
    const onError = () => {
      setLoadErr('模型预览加载失败。请立即下载 GLB 保存（模型已在云端生成成功，未白费）。');
      setPhase('error');
    };
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    const timer = window.setTimeout(() => {
      if (!readyRef.current) {
        setLoadErr('预览超时。请立即下载 GLB 保存到电脑，再用本地查看器打开。');
        setPhase('error');
      }
    }, 60_000);
    return () => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
      window.clearTimeout(timer);
    };
  }, [libOk, viewSrc, phase]);

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

  const dl = downloadHref || src;

  if (loadErr && !libOk) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${className}`}>
        <p className="text-sm text-rose-300 font-bold">{loadErr}</p>
        {poster ? (
          <img src={poster} alt="" className="max-h-48 rounded-xl object-contain opacity-80" />
        ) : null}
        {dl ? (
          <a
            href={dl}
            target="_blank"
            rel="noreferrer"
            download
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xs font-black px-3 py-2 text-white"
          >
            <Download size={14} /> 立即下载 GLB
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={hostRef} className={`relative w-full h-full min-h-[280px] ${className}`}>
      {!ready && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/70 pointer-events-none px-4">
          {poster ? (
            <img
              src={poster}
              alt=""
              className="max-h-40 rounded-xl object-contain opacity-70 mb-2"
            />
          ) : null}
          <Loader2 className="animate-spin text-indigo-400" size={28} />
          <p className="text-xs font-bold text-slate-300 text-center">
            {phase === 'pull'
              ? `正在下载模型到本机预览… ${pullPct}%`
              : '加载可旋转 3D 模型…'}
          </p>
          {phase === 'pull' ? (
            <div className="w-48 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pullPct}%` }} />
            </div>
          ) : null}
          <p className="text-[10px] text-slate-500 font-medium text-center max-w-xs">
            模型已生成成功。若长时间无响应，请点下方「下载 GLB」保存，不会白费额度。
          </p>
        </div>
      )}
      {loadErr && (
        <div className="absolute top-2 left-2 right-2 z-20 rounded-lg bg-rose-950/90 border border-rose-500/40 px-2 py-2 text-[10px] font-bold text-rose-100 space-y-1.5 pointer-events-auto">
          <p>{loadErr}</p>
          {dl ? (
            <a
              href={dl}
              target="_blank"
              rel="noreferrer"
              download
              className="inline-flex items-center gap-1 rounded-md bg-indigo-500 hover:bg-indigo-400 text-white px-2 py-1"
            >
              <Download size={12} /> 立即下载 GLB 保存
            </a>
          ) : null}
        </div>
      )}
      {libOk && viewSrc
        ? React.createElement('model-viewer', {
            src: viewSrc,
            poster: poster || undefined,
            alt: '3D 产品模型',
            crossorigin: 'anonymous',
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
