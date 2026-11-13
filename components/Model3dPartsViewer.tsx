import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Layers, Maximize2 } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadGlbFromSource, resolveGlbSource } from '../services/glbSceneLoader';

type Props = {
  src: string;
  className?: string;
  /** 初始炸开 0~1 */
  explode?: number;
  onPartsFound?: (names: string[]) => void;
};

const PART_PALETTE = [
  0xf43f5e, 0xf97316, 0xeab308, 0x22c55e, 0x14b8a6, 0x3b82f6, 0x8b5cf6, 0xec4899,
  0x06b6d4, 0x84cc16, 0xa855f7, 0xfb7185,
];

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
 * Tripo / 千问 Segmentation 的 GLB 常见形态：
 * 1) 多个独立 Mesh / 节点
 * 2) 单 Mesh + geometry.groups（多材质槽）
 * 3) 单 Mesh + material[] 多材质
 * 预览必须把 2/3 拆成可炸开单元，否则永远「已识别 1 个部件」。
 */
const splitMeshByMaterialGroups = (mesh: THREE.Mesh): THREE.Object3D[] => {
  const geom = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!geom) return [mesh];
  const groups =
    Array.isArray(geom.groups) && geom.groups.length > 1
      ? geom.groups.slice().sort((a, b) => a.start - b.start)
      : null;
  const mats = Array.isArray(mesh.material) ? mesh.material : null;

  if (groups && groups.length > 1) {
    const parent = mesh.parent || mesh;
    const out: THREE.Object3D[] = [];
    mesh.visible = false;
    const srcIndex = geom.index;
    groups.forEach((g, i) => {
      if (!g || g.count <= 0) return;
      const partGeom = geom.clone();
      partGeom.clearGroups();
      if (srcIndex) {
        const arr = srcIndex.array as ArrayLike<number>;
        const sliced = (ArrayBuffer.isView(arr)
          ? (arr as Uint16Array | Uint32Array).slice(g.start, g.start + g.count)
          : Array.from(arr).slice(g.start, g.start + g.count)) as Uint16Array | Uint32Array | number[];
        partGeom.setIndex(
          new THREE.BufferAttribute(
            sliced instanceof Uint16Array || sliced instanceof Uint32Array
              ? sliced
              : new Uint32Array(sliced),
            1
          )
        );
        partGeom.addGroup(0, g.count, 0);
      } else {
        partGeom.setDrawRange(g.start, g.count);
      }
      const matSrc = mats
        ? mats[Math.min(g.materialIndex ?? i, mats.length - 1)]
        : (mesh.material as THREE.Material);
      const part = new THREE.Mesh(partGeom, matSrc);
      part.name = (mesh.name || 'part') + `_${i + 1}`;
      part.position.copy(mesh.position);
      part.quaternion.copy(mesh.quaternion);
      part.scale.copy(mesh.scale);
      parent.add(part);
      out.push(part);
    });
    return out.length ? out : [mesh];
  }

  if (mats && mats.length > 1 && (!groups || groups.length <= 1)) {
    // 多材质但无 groups：按材质克隆整网并只保留对应材质视觉区分（炸开仍可分色）
    const parent = mesh.parent || mesh;
    const out: THREE.Object3D[] = [];
    mesh.visible = false;
    mats.forEach((mat, i) => {
      const part = new THREE.Mesh(geom.clone(), mat);
      part.name = (mesh.name || 'part') + `_${i + 1}`;
      part.position.copy(mesh.position);
      part.quaternion.copy(mesh.quaternion);
      part.scale.copy(mesh.scale);
      parent.add(part);
      out.push(part);
    });
    return out.length > 1 ? out : [mesh];
  }

  return [mesh];
};

const collectPartUnits = (root: THREE.Object3D): THREE.Object3D[] => {
  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
  });

  // 优先：有名字的部件节点（Tripo 常标 Part / segment）
  const namedKids = root.children.filter((c) => {
    const n = (c.name || '').toLowerCase();
    let has = false;
    c.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) has = true;
    });
    return has && (/part|seg|piece|component|部件/i.test(n) || n.length > 0);
  });
  if (namedKids.length > 1) {
    return namedKids;
  }

  let units: THREE.Object3D[] = [];
  for (const m of meshes) {
    units.push(...splitMeshByMaterialGroups(m));
  }
  units = units.filter((u, i, arr) => arr.indexOf(u) === i);

  if (units.length <= 1) {
    const kids = root.children.filter((c) => {
      let has = false;
      c.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) has = true;
      });
      return has;
    });
    if (kids.length > 1) units = kids;
  }

  if (units.length > 80) {
    const parents = new Map<string, THREE.Object3D>();
    for (const m of meshes) {
      const p = m.parent || m;
      if (!parents.has(p.uuid)) parents.set(p.uuid, p);
    }
    if (parents.size > 1 && parents.size < units.length) {
      units = Array.from(parents.values());
    } else {
      units = units.slice(0, 64);
    }
  }

  return units.length ? units : meshes.length ? meshes : [root];
};

/**
 * 拆分结果预览：部件着色 + 可控炸开。
 * 炸开尺度按「加载时」包围盒固定，禁止每帧用已炸开包围盒累加（否则模型飞出视野）。
 */
export const Model3dPartsViewer: React.FC<Props> = ({
  src,
  className = '',
  explode = 0.25,
  onPartsFound,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const onPartsRef = useRef(onPartsFound);
  onPartsRef.current = onPartsFound;
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [partCount, setPartCount] = useState(0);
  const [explodeAmt, setExplodeAmt] = useState(() => Math.min(0.45, Math.max(0, explode)));
  const explodeRef = useRef(explodeAmt);
  explodeRef.current = explodeAmt;
  const rootsRef = useRef<{ mesh: THREE.Object3D; origin: THREE.Vector3; dir: THREE.Vector3 }[]>(
    []
  );
  const explodeScaleRef = useRef(0.3);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const homeRef = useRef<{
    pos: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const srcTrim = (src || '').trim();
    if (!host || !srcTrim) return;

    let disposed = false;
    let raf = 0;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500);
    camera.position.set(1.6, 1.2, 1.8);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // 确保画布可接收拖拽（覆盖层用 pointer-events-none）
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    let envRt: THREE.WebGLRenderTarget | null = null;
    try {
      envRt = pmrem.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = envRt.texture;
    } catch {
      /* 环境光失败不阻断分件预览 */
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.autoRotate = false; // 拆分查看时关闭自转，方便拖动观察
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;
    cameraRef.current = camera;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
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
      const scale = explodeScaleRef.current;
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

    let lastProgressAt = Date.now();
    const watchdog = window.setInterval(() => {
      if (disposed) return;
      if (Date.now() - lastProgressAt < 90_000) return;
      window.clearInterval(watchdog);
      setLoading((prev) => {
        if (!prev) return prev;
        setErr('部件预览较慢。请点「整体环视」或「原模」查看；文件仍在本机可下载。');
        return false;
      });
    }, 2000);

    (async () => {
      try {
        const source = await resolveGlbSource(srcTrim);
        lastProgressAt = Date.now();
        if (disposed) return;

        const gltf = await loadGlbFromSource(
          source,
          () => {
            lastProgressAt = Date.now();
          },
          renderer
        );
        if (disposed) return;

        const root = gltf.scene;
        scene.add(root);

        // 先归零到世界原点附近，避免生成模型自带大偏移
        root.updateMatrixWorld(true);
        const preBox = new THREE.Box3().setFromObject(root);
        const preCenter = new THREE.Vector3();
        preBox.getCenter(preCenter);
        root.position.sub(preCenter);
        root.updateMatrixWorld(true);

        const units = collectPartUnits(root);

        const whole = new THREE.Box3().setFromObject(root);
        const center = new THREE.Vector3();
        const size0 = new THREE.Vector3();
        whole.getCenter(center);
        whole.getSize(size0);
        // 固定炸开半径：相对原模对角线，绝不每帧重算
        explodeScaleRef.current = Math.max(size0.x, size0.y, size0.z, 0.15) * 0.45;

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

        // 初始按当前炸开量摆一次，再框入视野
        applyExplode();
        const fit = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const mid = new THREE.Vector3();
        fit.getSize(size);
        fit.getCenter(mid);
        const maxDim = Math.max(size.x, size.y, size.z, 0.1);
        camera.near = Math.max(maxDim / 200, 0.001);
        camera.far = maxDim * 80;
        camera.position.set(mid.x + maxDim * 1.35, mid.y + maxDim * 0.85, mid.z + maxDim * 1.35);
        camera.updateProjectionMatrix();
        controls.target.copy(mid);
        controls.minDistance = maxDim * 0.15;
        controls.maxDistance = maxDim * 12;
        controls.update();
        homeRef.current = {
          pos: camera.position.clone(),
          target: mid.clone(),
        };
        controls.saveState();

        setPartCount(units.length);
        try {
          onPartsRef.current?.(names);
        } catch {
          /* ignore */
        }

        setLoading(false);
        window.clearInterval(watchdog);
        tick();
      } catch (e: any) {
        if (!disposed) {
          window.clearInterval(watchdog);
          setErr(e?.message || '部件预览加载失败，请改用「整体环视」或「原模」');
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      window.clearInterval(watchdog);
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      controlsRef.current = null;
      scene.environment = null;
      envRt?.dispose?.();
      pmrem.dispose();
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
  }, [src]);

  const resetView = () => {
    setExplodeAmt(0.2);
    const c = controlsRef.current;
    const cam = cameraRef.current;
    const home = homeRef.current;
    if (c && cam && home) {
      cam.position.copy(home.pos);
      c.target.copy(home.target);
      c.update();
    } else if (c) {
      c.reset();
    }
  };

  return (
    <div className={`relative w-full h-full min-h-0 bg-slate-950 ${className}`}>
      <div ref={hostRef} className="absolute inset-0 z-0" />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/70 z-10 pointer-events-none">
          <Loader2 className="animate-spin text-amber-300" size={28} />
          <p className="text-xs font-bold text-slate-300">正在按部件着色预览…</p>
        </div>
      )}
      {err && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 z-10 pointer-events-none">
          <p className="text-xs font-bold text-rose-300 text-center max-w-sm">{err}</p>
        </div>
      )}
      {!loading && !err && (
        <div className="absolute left-2 right-2 bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-black/55 border border-white/10 px-2.5 py-2 backdrop-blur-sm pointer-events-auto">
          <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-200 pointer-events-none">
            <Layers size={12} /> 已识别 {partCount} 个部件 · 拖拽旋转 / 滚轮缩放
          </span>
          <button
            type="button"
            onClick={resetView}
            className="text-[9px] font-black text-slate-200 underline-offset-2 hover:underline"
          >
            复位视角
          </button>
          <label className="ml-auto flex items-center gap-1.5 text-[9px] font-bold text-slate-300">
            <Maximize2 size={11} /> 炸开
            <input
              type="range"
              min={0}
              max={80}
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
