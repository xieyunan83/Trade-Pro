import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Move3d, RotateCcw } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { isVaultRef } from '../services/creativeAssetVault';
import { loadGlbFromSource, resolveGlbSource } from '../services/glbSceneLoader';

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

/**
 * 可拖动环视的真实 3D 预览（Three.js + Draco）。
 * 本机 vault 走 ArrayBuffer 解析，避免 blob URL / 压缩网格导致黑屏失败。
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
    let raf = 0;
    setReady(false);
    setLoadErr(null);
    setPullPct(0);
    setPhase(isLocalSrc(srcTrim) ? 'resolve' : 'pull');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500);
    camera.position.set(1.6, 1.2, 1.8);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch (e: any) {
      setPhase('error');
      setLoadErr(`WebGL 不可用：${e?.message || e}。请换用支持硬件加速的浏览器/客户端。`);
      return;
    }
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
      const w = Math.max(host.clientWidth || 1, 1);
      const h = Math.max(host.clientHeight || 1, 1);
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
      if (Date.now() - lastProgressAt < 120_000) return;
      window.clearInterval(watchdog);
      setLoadErr('预览超时。请点「重试预览」或「立即下载 GLB」用本地查看器打开。');
      setPhase('error');
      setReady(false);
    }, 2500);

    (async () => {
      try {
        const source = await resolveGlbSource(srcTrim, (pct) => {
          if (disposed) return;
          lastProgressAt = Date.now();
          setPullPct(pct);
          if (pct < 100) setPhase('pull');
        });
        if (disposed) return;

        if (source.blob && source.remoteUrl) {
          try {
            onBlobRef.current?.(source.blob, source.remoteUrl);
          } catch {
            /* ignore */
          }
        }

        setPhase('viewer');
        setPullPct(100);
        lastProgressAt = Date.now();

        const gltf = await loadGlbFromSource(source, (pct) => {
          lastProgressAt = Date.now();
          setPullPct(pct);
        });
        if (disposed) return;

        const root = gltf.scene;
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

        // 布局可能尚未算出尺寸，再刷一次
        requestAnimationFrame(resize);

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
            ? '远程临时链已过期。正在尝试从本机素材库回挂；若仍失败请点「重试预览」。'
            : `${msg || '模型预览加载失败'}。可点「下载 GLB」保存——模型已生成，不会白费。`
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
                : '解析可旋转 3D 网格…'}
          </p>
          {phase === 'pull' ? (
            <div className="w-48 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pullPct}%` }} />
            </div>
          ) : null}
          <p className="text-[10px] text-slate-500 font-medium text-center max-w-xs">
            加载完成后可拖动旋转；上方平面图仅为提示，不是最终预览。
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
