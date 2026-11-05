import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Layers, Maximize2 } from 'lucide-react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fetchRemoteBlob, peekRemoteBlob, rememberRemoteBlob } from '../services/fetchRemoteBlob';
import { isVaultRef, resolveMediaUrl } from '../services/creativeAssetVault';

type Props = {
  src: string;
  className?: string;
  /** 0=贴合，1=最大炸开 */
  explode?: number;
  onPartsFound?: (names: string[]) => void;
};

const PART_PALETTE = [
  0xf43f5e, 0xf97316, 0xeab308, 0x22c55e, 0x14b8a6, 0x3b82f6, 0x8b5cf6, 0xec4899,
  0x06b6d4, 0x84cc16, 0xa855f7, 0xfb7185,
];

const resolveToObjectUrl = async (raw: string): Promise<{ url: string; owned: boolean }> => {
  const u = (raw || '').trim();
  if (!u) throw new Error('无模型地址');
  if (u.startsWith('blob:') || u.startsWith('data:')) return { url: u, owned: false };
  if (isVaultRef(u)) {
    const resolved = await resolveMediaUrl(u);
    if (!resolved) throw new Error('本机素材库找不到模型');
    return { url: resolved, owned: false };
  }
  if (/^https?:\/\//i.test(u)) {
    const peeked = peekRemoteBlob(u);
    if (peeked) return { url: URL.createObjectURL(peeked), owned: true };
    const blob = await fetchRemoteBlob(u, { timeoutMs: 90_000 });
    rememberRemoteBlob(u, blob);
    return { url: URL.createObjectURL(blob), owned: true };
  }
  throw new Error('不支持的模型地址');
};

const tintMaterial = (mat: THREE.Material, color: THREE.Color): THREE.Material => {
  try {
    const clone =
      typeof (mat as THREE.MeshStandardMaterial).clone === 'function'
        ? (mat as THREE.MeshStandardMaterial).clone()
        : new THREE.MeshStandardMaterial();
    if ((clone as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      const std = clone as THREE.MeshStandardMaterial;
      std.color.copy(color);
      std.emissive.copy(color).multiplyScalar(0.06);
      std.metalness = Math.min(0.35, std.metalness || 0.2);
      std.roughness = Math.max(0.45, std.roughness || 0.55);
      return std;
    }
    return clone;
  } catch {
    return new THREE.MeshStandardMaterial({
      color: color.clone(),
      metalness: 0.2,
      roughness: 0.55,
    });
  }
};

/**
 * 拆分结果预览：按网格部件着色 + 可炸开。
 * 注意：回调用 ref，避免父组件 setState 触发无限重载。
 */
export const Model3dPartsViewer: React.FC<Props> = ({
  src,
  className = '',
  explode = 0.35,
  onPartsFound,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const onPartsRef = useRef(onPartsFound);
  onPartsRef.current = onPartsFound;
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [partCount, setPartCount] = useState(0);
  const [explodeAmt, setExplodeAmt] = useState(explode);
  const explodeRef = useRef(explodeAmt);
  explodeRef.current = explodeAmt;
  const rootsRef = useRef<{ mesh: THREE.Object3D; origin: THREE.Vector3; dir: THREE.Vector3 }[]>(
    []
  );

  useEffect(() => {
    const host = hostRef.current;
    const srcTrim = (src || '').trim();
    if (!host || !srcTrim) return;

    let disposed = false;
    let ownedUrl: string | null = null;
    let raf = 0;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500);
    camera.position.set(1.6, 1.2, 1.8);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(3, 5, 2);
    scene.add(key);

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

    const applyExplode = () => {
      const t = explodeRef.current;
      const box = new THREE.Box3();
      for (const r of rootsRef.current) box.expandByObject(r.mesh);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = Math.max(size.x, size.y, size.z, 0.2) * 0.55;
      for (const r of rootsRef.current) {
        r.mesh.position.copy(r.origin).addScaledVector(r.dir, t * scale);
      }
    };

    const tick = () => {
      if (disposed) return;
      applyExplode();
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };

    setLoading(true);
    setErr(null);
    rootsRef.current = [];

    const watchdog = window.setTimeout(() => {
      if (disposed) return;
      setLoading((prev) => {
        if (!prev) return prev;
        setErr('部件预览超时。请点「整体环视」查看模型，或重新点「分件着色」重试。');
        return false;
      });
    }, 45_000);

    (async () => {
      try {
        const resolved = await resolveToObjectUrl(srcTrim);
        if (disposed) {
          if (resolved.owned) URL.revokeObjectURL(resolved.url);
          return;
        }
        if (resolved.owned) ownedUrl = resolved.url;

        const gltf = await new Promise<GLTF>((resolve, reject) => {
          const loader = new GLTFLoader();
          loader.load(
            resolved.url,
            resolve,
            undefined,
            (e) => reject(e instanceof Error ? e : new Error('GLB 解析失败'))
          );
        });
        if (disposed) return;

        const root = gltf.scene;
        scene.add(root);

        const meshes: THREE.Mesh[] = [];
        root.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
        });

        let units: THREE.Object3D[] = meshes;
        if (meshes.length <= 1) {
          const kids = root.children.filter((c) => {
            let has = false;
            c.traverse((o) => {
              if ((o as THREE.Mesh).isMesh) has = true;
            });
            return has;
          });
          if (kids.length > 1) units = kids;
        }

        // 过多细碎三角面时按父节点聚合，避免卡死
        if (units.length > 80) {
          const parents = new Map<string, THREE.Object3D>();
          for (const m of meshes) {
            const p = m.parent || m;
            const key = p.uuid;
            if (!parents.has(key)) parents.set(key, p);
          }
          if (parents.size > 1 && parents.size < units.length) {
            units = Array.from(parents.values());
          } else {
            units = meshes.slice(0, 64);
          }
        }

        const center = new THREE.Vector3();
        new THREE.Box3().setFromObject(root).getCenter(center);

        const names: string[] = [];
        units.forEach((unit, i) => {
          const color = new THREE.Color(PART_PALETTE[i % PART_PALETTE.length]);
          unit.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            if (Array.isArray(m.material)) {
              m.material = m.material.map((mat) => tintMaterial(mat, color));
            } else if (m.material) {
              m.material = tintMaterial(m.material, color);
            }
          });
          const ub = new THREE.Box3().setFromObject(unit);
          const uc = new THREE.Vector3();
          ub.getCenter(uc);
          const d = uc.clone().sub(center);
          if (d.lengthSq() < 1e-8) d.set((i % 3) - 1, 0.15, (Math.floor(i / 3) % 3) - 1);
          d.normalize();
          rootsRef.current.push({ mesh: unit, origin: unit.position.clone(), dir: d });
          names.push((unit.name || '').trim() || `部件 ${i + 1}`);
        });

        if (disposed) return;

        setPartCount(units.length);
        try {
          onPartsRef.current?.(names);
        } catch {
          /* ignore parent callback errors */
        }

        const fit = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const mid = new THREE.Vector3();
        fit.getSize(size);
        fit.getCenter(mid);
        const maxDim = Math.max(size.x, size.y, size.z, 0.1);
        camera.near = maxDim / 100;
        camera.far = maxDim * 100;
        camera.position.copy(mid).add(new THREE.Vector3(maxDim * 1.25, maxDim * 0.95, maxDim * 1.35));
        camera.updateProjectionMatrix();
        controls.target.copy(mid);
        controls.update();

        setLoading(false);
        window.clearTimeout(watchdog);
        tick();
      } catch (e: any) {
        if (!disposed) {
          window.clearTimeout(watchdog);
          setErr(e?.message || '部件预览加载失败，请改用「整体环视」');
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      window.clearTimeout(watchdog);
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
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
    // 仅随模型地址变化重建；切勿把 onPartsFound 放进依赖
  }, [src]);

  return (
    <div className={`relative w-full h-full min-h-0 bg-slate-950 ${className}`}>
      <div ref={hostRef} className="absolute inset-0" />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/70 z-10 pointer-events-none">
          <Loader2 className="animate-spin text-amber-300" size={28} />
          <p className="text-xs font-bold text-slate-300">正在按部件着色预览…</p>
          <p className="text-[10px] text-slate-500 font-medium">大模型首次加载约需数秒，请稍候</p>
        </div>
      )}
      {err && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 z-10 bg-slate-950/80">
          <p className="text-xs font-bold text-rose-300 text-center max-w-sm">{err}</p>
        </div>
      )}
      {!loading && !err && (
        <div className="absolute left-2 right-2 bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-black/55 border border-white/10 px-2.5 py-2 backdrop-blur-sm">
          <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-200">
            <Layers size={12} /> 已识别 {partCount} 个部件 · 不同颜色区分
          </span>
          <label className="ml-auto flex items-center gap-1.5 text-[9px] font-bold text-slate-300">
            <Maximize2 size={11} /> 炸开
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(explodeAmt * 100)}
              onChange={(e) => setExplodeAmt(Number(e.target.value) / 100)}
              className="w-24 accent-amber-400"
            />
          </label>
        </div>
      )}
    </div>
  );
};
