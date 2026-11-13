import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Move3d, RotateCcw } from 'lucide-react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
  /** 平面预览图作加载中海报（仅转圈阶段；成功后不再盖住 3D） */
  poster?: string;
  className?: string;
  /** 默认自动慢转；拖动时用户接管 */
  autoRotate?: boolean;
  /** 直链下载（预览失败时强调） */
  downloadHref?: string;
  /** 成功拉到本机 Blob 时回调（用于写入素材库） */
  onLocalBlob?: (blob: Blob, sourceUrl: string) => void;
  /** 远程链 403/过期时通知父级尝试本机回挂 */
  onRemoteExpired?: () => void;
};

const isLocalSrc = (u: string) =>
  !!u &&
  (u.startsWith('blob:') ||
    u.startsWith('data:') ||
    isVaultRef(u) ||
    u.startsWith('vault:'));

const resolveToObjectUrl = async (
  raw: string
): Promise<{ url: string; owned: boolean; blob?: Blob }> => {
  const u = (raw || '').trim();
  if (!u) throw new Error('无模型地址');
  if (u.startsWith('blob:') || u.startsWith('data:')) return { url: u, owned: false };
  if (isVaultRef(u)) {
    const resolved = await resolveMediaUrl(u);
    if (!resolved || resolved.startsWith('vault:')) {
      throw new Error('本机素材库里找不到该 GLB，请重新生成或导入');
    }
    return { url: resolved, owned: false };
  }
  if (/^https?:\/\//i.test(u)) {
    const peeked = peekRemoteBlob(u);
    if (peeked) {
      return { url: URL.createObjectURL(peeked), owned: true, blob: peeked };
    }
    const blob = await fetchRemoteBlob(u, { timeoutMs: 180_000 });
    rememberRemoteBlob(u, blob);
    return { url: URL.createObjectURL(blob), owned: true, blob };
  }
  throw new Error('不支持的模型地址');
};

/**
 * 可拖动环视的真实 3D 预览（Three.js + GLTFLoader）。
 * 不再依赖 model-viewer（Electron / 严格 CSP 下常只剩平面海报）。
 */
export const Model3dOrbitViewer: React.FC<Props> = ({
  src,
  stableKey,
  poster,
  className = '',
  autoRotate = true,
  downloadHref,
  onLocalBlob,
  onRemoteExpired,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const onBlobRef = useRef(onLocalBlob);
  onBlobRef.current = onLocalBlob;
  const onExpiredRef = useRef(onRemoteExpired);
  onExpiredRef.current = onRemoteExpired;
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const homeRef = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pullPct, setPullPct] = useState(0);
  const [phase, setPhase] = useState<'resolve' | 'pull' | 'viewer' | 'done' | 'error'>('resolve');
  const [retryTick, setRetryTick] = useState(0);

  const srcTrim = (src || '').trim();
  const loadKey = [
    stableKey || '',
    isLocalSrc(srcTrim) ? srcTrim : srcTrim ? 'remote' : 'empty',
    String(retryTick),
  ].join('|');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!srcTrim) {
      setPhase('resolve');
      setReady(false);
      setLoadErr(null);
      return;
    }

    let disposed = false;
    let ownedUrl: string | null = null;
    let raf = 0;
    setReady(false);
    setLoadErr(null);
    setPullPct(0);
    setPhase('resolve');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500);
    camera.position.set(1.6, 1.2, 1.8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.autoRotate = autoRotateRef.current;
    controls.autoRotateSpeed = 0.9;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    // 用户一拖就接管，停止自转
    const stopAuto = () => {
      controls.autoRotate = false;
    };
    controls.addEventListener('start', stopAuto);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(3, 5, 2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa5b4fc, 0.35);
    fill.position.set(-2, 1, -2);
    scene.add(fill);

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const tick = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };

    let lastProgressAt = Date.now();
    const watchdog = window.setInterval(() => {
      if (disposed) return;
      if (Date.now() - lastProgressAt < 90_000) return;
      window.clearInterval(watchdog);
      setLoadErr('预览较慢。模型多半已在本机，请点「立即下载 GLB」或「重试预览」。');
      setPhase('error');
      setReady(false);
    }, 2500);

    (async () => {
      try {
        const remote = /^https?:\/\//i.test(srcTrim);
        if (remote && !peekRemoteBlob(srcTrim)) setPhase('pull');
        else setPhase('resolve');

        const resolved = await resolveToObjectUrl(srcTrim);
        lastProgressAt = Date.now();
        if (disposed) {
          if (resolved.owned) URL.revokeObjectURL(resolved.url);
          return;
        }
        if (resolved.owned) ownedUrl = resolved.url;
        if (resolved.blob && remote) {
          try {
            onBlobRef.current?.(resolved.blob, srcTrim);
          } catch {
            /* ignore */
          }
        }

        setPhase('viewer');
        setPullPct(100);

        const gltf = await new Promise<THREE.Group>((resolve, reject) => {
          new GLTFLoader().load(
            resolved.url,
            (g) => resolve(g.scene),
            (ev) => {
              lastProgressAt = Date.now();
              if (ev.total > 0) {
                setPullPct(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
              }
            },
            (e) => reject(e instanceof Error ? e : new Error('GLB 解析失败'))
          );
        });
        if (disposed) return;

        const root = gltf;
        scene.add(root);
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const mid = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(mid);
        const maxDim = Math.max(size.x, size.y, size.z, 0.1);
        root.position.sub(mid);

        camera.near = Math.max(maxDim / 200, 0.001);
        camera.far = maxDim * 80;
        camera.position.set(maxDim * 1.35, maxDim * 0.85, maxDim * 1.35);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.minDistance = maxDim * 0.15;
        controls.maxDistance = maxDim * 12;
        controls.update();
        homeRef.current = {
          pos: camera.position.clone(),
          target: controls.target.clone(),
        };

        window.clearInterval(watchdog);
        setReady(true);
        setPhase('done');
        setLoadErr(null);
        tick();
      } catch (e: any) {
        if (disposed) return;
        window.clearInterval(watchdog);
        const msg = String(e?.message || e);
        const expired = /403|401|410|Expired|forbidden/i.test(msg);
        if (expired) {
          try {
            onExpiredRef.current?.();
          } catch {
            /* ignore */
          }
        }
        setPhase('error');
        setReady(false);
        setLoadErr(
          expired
            ? '远程临时链已过期。正在尝试从本机素材库回挂；若仍失败请点「重试预览」，或重新生成 / 导入本地 GLB。'
            : /GLB|解析|模型/i.test(msg)
              ? `${msg}。请点「下载 GLB」保存——模型已生成，不会白费。`
              : '模型预览加载失败。请立即下载 GLB 保存（模型已在云端生成成功，未白费）。'
        );
      }
    })();

    return () => {
      disposed = true;
      window.clearInterval(watchdog);
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.removeEventListener('start', stopAuto);
      controls.dispose();
      controlsRef.current = null;
      cameraRef.current = null;
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry?.dispose?.();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((x) => x?.dispose?.());
      });
      if (ownedUrl) {
        try {
          URL.revokeObjectURL(ownedUrl);
        } catch {
          /* ignore */
        }
      }
      host.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  const resetCamera = () => {
    const c = controlsRef.current;
    const cam = cameraRef.current;
    const home = homeRef.current;
    if (c && cam && home) {
      cam.position.copy(home.pos);
      c.target.copy(home.target);
      c.autoRotate = autoRotateRef.current;
      c.update();
    } else if (c) {
      c.reset();
    }
  };

  const dl = downloadHref || (isVaultRef(srcTrim) ? '' : srcTrim);
  const showSpinner = !ready && phase !== 'error';

  return (
    <div className={`relative w-full h-full min-h-[280px] ${className}`}>
      {/* 画布单独挂载，避免 React 覆盖层被 innerHTML 清掉 */}
      <div ref={hostRef} className="absolute inset-0" />
      {showSpinner && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/75 pointer-events-none px-4">
          {poster ? (
            <img
              src={poster}
              alt=""
              className="max-h-28 rounded-xl object-contain opacity-50 mb-1"
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
            模型已生成成功。加载完成后可拖动旋转；平面图仅为加载提示。
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
      {ready && (
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
      )}
    </div>
  );
};
