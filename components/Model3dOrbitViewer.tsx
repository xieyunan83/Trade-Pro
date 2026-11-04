import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Move3d, RotateCcw } from 'lucide-react';
import { fetchRemoteBlob, peekRemoteBlob, rememberRemoteBlob } from '../services/fetchRemoteBlob';
import { isVaultRef, resolveMediaUrl } from '../services/creativeAssetVault';

type Props = {
  /** GLB / GLTF 地址：vault: / blob: / https 均可 */
  src: string;
  /**
   * 任务级稳定键。同一任务下仅当「本机可用地址升级」时切换预览源，
   * 避免 https→vault 整页重下；也不会在 src 从空变为本机 blob 时卡住不加载。
   */
  stableKey?: string;
  /** 平面预览图作加载中海报 */
  poster?: string;
  className?: string;
  /** 默认自动慢转；拖动时用户接管 */
  autoRotate?: boolean;
  /** 直链下载（预览失败时强调） */
  downloadHref?: string;
  /** 成功拉到本机 Blob 时回调（用于写入素材库） */
  onLocalBlob?: (blob: Blob, sourceUrl: string) => void;
};

const isLocalSrc = (u: string) =>
  !!u &&
  (u.startsWith('blob:') ||
    u.startsWith('data:') ||
    isVaultRef(u) ||
    u.startsWith('vault:'));

/**
 * 可拖动环视的真实 3D 预览（@google/model-viewer）。
 * 优先 vault/blob 本机素材；远程只拉一次。自定义元素用命令式挂载，避免 React 重渲染拆掉已加载模型。
 */
export const Model3dOrbitViewer: React.FC<Props> = ({
  src,
  stableKey,
  poster,
  className = '',
  autoRotate = true,
  downloadHref,
  onLocalBlob,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLElement | null>(null);
  const onBlobRef = useRef(onLocalBlob);
  onBlobRef.current = onLocalBlob;
  const readyRef = useRef(false);
  const objectUrlRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [libOk, setLibOk] = useState(false);
  const [viewSrc, setViewSrc] = useState('');
  const [pullPct, setPullPct] = useState(0);
  const [phase, setPhase] = useState<'resolve' | 'pull' | 'viewer' | 'done' | 'error'>('resolve');
  const [retryTick, setRetryTick] = useState(0);

  // 本机地址变化必须触发重载；纯 https 换签可忽略（靠 stableKey）
  const srcTrim = (src || '').trim();
  const loadKey = [
    stableKey || '',
    isLocalSrc(srcTrim) ? srcTrim : srcTrim ? 'remote' : 'empty',
    String(retryTick),
  ].join('|');

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
    readyRef.current = false;
    setReady(false);
    setLoadErr(null);
    setPullPct(0);
    setPhase('resolve');
    setViewSrc('');

    const raw = srcTrim;
    if (!raw) {
      // 父级还在解析 vault → blob；等 src 就绪，不要报死错
      setPhase('resolve');
      return;
    }

    const revokeOwned = () => {
      if (objectUrlRef.current) {
        try {
          URL.revokeObjectURL(objectUrlRef.current);
        } catch {
          /* ignore */
        }
        objectUrlRef.current = null;
      }
    };

    (async () => {
      try {
        // 1) 已是 blob/data
        if (raw.startsWith('blob:') || raw.startsWith('data:')) {
          if (!cancelled) {
            setViewSrc(raw);
            setPhase('viewer');
            setPullPct(100);
          }
          return;
        }

        // 2) 本机素材库 vault: —— 应瞬间出 blob，禁止走远程下载
        if (isVaultRef(raw)) {
          setPhase('resolve');
          const local = await resolveMediaUrl(raw);
          if (cancelled) return;
          if (!local || local.startsWith('vault:')) {
            throw new Error('本机素材库里找不到该 GLB，请重新生成或导入');
          }
          setViewSrc(local);
          setPhase('viewer');
          setPullPct(100);
          return;
        }

        // 3) 会话内存已有同一远程文件
        const mem = peekRemoteBlob(raw);
        if (mem) {
          const ou = URL.createObjectURL(mem);
          objectUrlRef.current = ou;
          if (!cancelled) {
            setViewSrc(ou);
            setPhase('viewer');
            setPullPct(100);
          }
          return;
        }

        // 4) 远程拉取
        setPhase('pull');
        const blob = await fetchRemoteBlob(raw, {
          timeoutMs: 180_000,
          onProgress: (pct) => {
            if (!cancelled) setPullPct(pct);
          },
        });
        if (cancelled) return;
        rememberRemoteBlob(raw, blob);
        revokeOwned();
        const ou = URL.createObjectURL(blob);
        objectUrlRef.current = ou;
        setViewSrc(ou);
        setPhase('viewer');
        setPullPct(100);
        try {
          onBlobRef.current?.(blob, raw);
        } catch {
          /* ignore */
        }
      } catch (e: any) {
        if (cancelled) return;
        setPhase('error');
        setLoadErr(
          String(e?.message || e) +
            '。请点「下载 GLB」保存到电脑——模型已生成，不会白费。'
        );
      }
    })();

    return () => {
      cancelled = true;
      revokeOwned();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  // 命令式挂载 model-viewer：避免 React 每次 render 拆掉已解析的 WebGL 场景
  useEffect(() => {
    if (!libOk || !hostRef.current || !viewSrc || phase === 'pull' || phase === 'resolve') {
      return;
    }
    const host = hostRef.current;
    let el = viewerRef.current;
    if (!el || el.parentElement !== host) {
      host.querySelectorAll('model-viewer').forEach((n) => n.remove());
      el = document.createElement('model-viewer') as HTMLElement;
      el.setAttribute('alt', '3D 产品模型');
      el.setAttribute('camera-controls', '');
      el.setAttribute('touch-action', 'pan-y');
      el.setAttribute('shadow-intensity', '1');
      el.setAttribute('exposure', '1');
      el.setAttribute('environment-image', 'neutral');
      if (autoRotate) el.setAttribute('auto-rotate', '');
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.minHeight = '280px';
      el.style.background = 'transparent';
      host.insertBefore(el, host.firstChild);
      viewerRef.current = el;
    }

    // blob:/data: 不要加 crossorigin，否则部分环境会卡死 load
    if (viewSrc.startsWith('blob:') || viewSrc.startsWith('data:')) {
      el.removeAttribute('crossorigin');
    } else {
      el.setAttribute('crossorigin', 'anonymous');
    }
    if (poster) el.setAttribute('poster', poster);
    else el.removeAttribute('poster');

    const onLoad = () => {
      readyRef.current = true;
      setReady(true);
      setPhase('done');
      setLoadErr(null);
    };
    const onError = () => {
      readyRef.current = false;
      setReady(false);
      setLoadErr('模型预览加载失败。请立即下载 GLB 保存（模型已在云端生成成功，未白费）。');
      setPhase('error');
    };

    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);

    const prev = el.getAttribute('src');
    if (prev !== viewSrc) {
      readyRef.current = false;
      setReady(false);
      el.setAttribute('src', viewSrc);
    } else if ((el as any).loaded) {
      onLoad();
    }

    // 本机 blob 应很快；远程解析可稍长。超时后停转圈，保留下载入口
    const timeoutMs = viewSrc.startsWith('blob:') || viewSrc.startsWith('data:') ? 45_000 : 120_000;
    const timer = window.setTimeout(() => {
      if (!readyRef.current) {
        setLoadErr(
          '预览超时。模型文件多半已在本机，请点「立即下载 GLB」保存后用本地查看器打开；也可点下方重试预览。'
        );
        setPhase('error');
      }
    }, timeoutMs);

    return () => {
      el?.removeEventListener('load', onLoad);
      el?.removeEventListener('error', onError);
      window.clearTimeout(timer);
    };
  }, [libOk, viewSrc, phase, poster, autoRotate]);

  useEffect(() => {
    return () => {
      const el = viewerRef.current;
      if (el?.parentElement) el.parentElement.removeChild(el);
      viewerRef.current = null;
    };
  }, []);

  const resetCamera = () => {
    const el = viewerRef.current as any;
    try {
      el?.resetTurntableRotation?.();
      if (el) el.cameraOrbit = '0deg 75deg 105%';
      el?.jumpCameraToGoal?.();
    } catch {
      /* ignore */
    }
  };

  const dl = downloadHref || (isVaultRef(srcTrim) ? '' : srcTrim);

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

  const showSpinner = !ready && phase !== 'error';

  return (
    <div ref={hostRef} className={`relative w-full h-full min-h-[280px] ${className}`}>
      {showSpinner && (
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
              : phase === 'resolve'
                ? '正在从本机素材库打开模型…'
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
          <div className="flex flex-wrap gap-1.5">
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
            <button
              type="button"
              onClick={() => {
                setLoadErr(null);
                setRetryTick((n) => n + 1);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-white/15 hover:bg-white/25 text-white px-2 py-1"
            >
              重试预览
            </button>
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 pointer-events-none z-10">
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
