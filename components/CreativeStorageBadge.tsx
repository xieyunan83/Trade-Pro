import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, Trash2, Loader2, FolderOpen } from 'lucide-react';
import {
  enforceVaultQuota,
  formatBytes,
  getVaultStats,
  notifyVaultChanged,
  type VaultMeta,
} from '../services/creativeAssetVault';
import { clearAllCreativeLocalMedia } from '../services/creativeAssetPersist';
import { CreativeVaultBrowser } from './CreativeVaultBrowser';

type Props = {
  className?: string;
  /** 紧凑一行（嵌在模块顶栏） */
  compact?: boolean;
  /** 3D：从库内选 GLB 设为当前任务原模 */
  onUseModel3dAsOriginal?: (vaultRef: string, meta: VaultMeta) => void | Promise<void>;
};

/**
 * 本机 IndexedDB 素材库用量；无总容量硬限制，可浏览/清理/清空。
 */
export const CreativeStorageBadge: React.FC<Props> = ({
  className = '',
  compact,
  onUseModel3dAsOriginal,
}) => {
  const [bytes, setBytes] = useState(0);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await getVaultStats();
      setBytes(s.bytes);
      setCount(s.count);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void refresh();
    };
    let idleId = 0;
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') {
      idleId = ric(run, { timeout: 8_000 });
    } else {
      idleId = window.setTimeout(run, 2_000) as unknown as number;
    }
    const t = window.setInterval(() => void refresh(), 120_000);
    const onVault = () => {
      window.setTimeout(run, 400);
    };
    window.addEventListener('trade-pro-vault-changed', onVault);
    window.addEventListener('trade-pro-creative-media-cleared', onVault);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      window.removeEventListener('trade-pro-vault-changed', onVault);
      window.removeEventListener('trade-pro-creative-media-cleared', onVault);
      try {
        const cic = (
          window as Window & { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback;
        if (typeof cic === 'function') cic(idleId);
        else window.clearTimeout(idleId);
      } catch {
        /* ignore */
      }
    };
  }, [refresh]);

  const onTrim = async () => {
    if (
      !window.confirm(
        '删除一批最久未访问的本机素材（约腾出 150MB）？画布上仍引用这些文件的预览可能裂图。'
      )
    ) {
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const removed = await enforceVaultQuota(150 * 1024 * 1024);
      notifyVaultChanged();
      await refresh();
      setHint(removed > 0 ? `已清理 ${removed} 个旧文件` : '没有可清理的旧文件（或索引为空）');
      window.alert(
        removed > 0
          ? `已清理 ${removed} 个最久未访问的本机素材。`
          : '没有删掉文件。若用量仍很大，请直接点「清空」。'
      );
    } catch (e: any) {
      const msg = e?.message || String(e);
      setHint(`清理失败：${msg}`);
      window.alert(`清理失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    if (
      !window.confirm(
        '清空本机创作素材库？平面/3D/视频/包装里已生成的预览将无法再打开（可重新生成）。'
      )
    ) {
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const report = await clearAllCreativeLocalMedia();
      setBytes(0);
      setCount(0);
      await refresh();
      if (!report.ok) {
        const msg = report.error || '未知错误';
        setHint(`清空失败：${msg}`);
        window.alert(`清空失败：${msg}`);
        return;
      }
      const detail = `已清空本机素材库（原先约 ${report.vaultMetaBefore} 个文件索引）。\n平面素材 ${report.designAssetsCleared} · 包装 ${report.packagingAssetsCleared} · 3D任务 ${report.model3dJobsTouched} · 视频 ${report.videoJobsTouched}`;
      setHint('已清空');
      window.alert(detail);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setHint(`清空失败：${msg}`);
      window.alert(`清空失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const browser = (
    <CreativeVaultBrowser
      open={browseOpen}
      onClose={() => setBrowseOpen(false)}
      onUseModel3dAsOriginal={onUseModel3dAsOriginal}
    />
  );

  if (compact) {
    return (
      <>
        <div
          className={`inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 px-2 py-1 text-[10px] font-bold ${className}`}
          title="本机素材库，无总容量上限"
        >
          <HardDrive size={12} />
          本机素材 {formatBytes(bytes)}
          {count ? ` · ${count} 个` : ''}
          <button
            type="button"
            onClick={() => setBrowseOpen(true)}
            className="underline decoration-dotted hover:text-teal-800 text-teal-700"
          >
            查看
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onTrim()}
            className="underline decoration-dotted hover:text-slate-900 disabled:opacity-40"
          >
            {busy ? '…' : '清理旧文件'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onClear()}
            className="underline decoration-dotted text-rose-600 hover:text-rose-800 disabled:opacity-40"
          >
            清空
          </button>
          {hint ? <span className="text-emerald-700 font-medium">{hint}</span> : null}
        </div>
        {browser}
      </>
    );
  }

  return (
    <>
      <div
        className={`rounded-xl border border-teal-200/70 bg-teal-50/40 px-3 py-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-700 ${className}`}
      >
        <HardDrive size={14} className="text-teal-700 shrink-0" />
        <div className="min-w-0 flex-1">
          <div>
            本机素材库 · {count} 个 · {formatBytes(bytes)}
            <span className="text-slate-400 font-medium"> · 无总容量上限</span>
          </div>
          <div className="text-[10px] font-medium text-slate-500 mt-0.5 leading-snug">
            点「查看」可浏览每个文件；「清空」会真正删除本机库。
          </div>
          {hint ? (
            <div className="text-[10px] font-bold text-emerald-700 mt-0.5">{hint}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setBrowseOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-white px-2 py-1 text-teal-800 hover:bg-teal-50"
        >
          <FolderOpen size={12} />
          查看
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onTrim()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          清理旧文件
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onClear()}
          className="text-[10px] text-rose-600 hover:text-rose-800 underline disabled:opacity-50"
        >
          清空全部
        </button>
      </div>
      {browser}
    </>
  );
};
