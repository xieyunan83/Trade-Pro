import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, Trash2, Loader2 } from 'lucide-react';
import {
  clearVault,
  enforceVaultQuota,
  formatBytes,
  getVaultStats,
  VAULT_DB_NAME,
} from '../services/creativeAssetVault';

type Props = {
  className?: string;
  /** 紧凑一行（嵌在模块顶栏） */
  compact?: boolean;
};

/**
 * 本机 IndexedDB 素材库用量；无总容量硬限制，可清理/清空。
 */
export const CreativeStorageBadge: React.FC<Props> = ({ className = '', compact }) => {
  const [bytes, setBytes] = useState(0);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

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
    // 进创作模块立刻扫库会卡死；空闲后再统计
    let idleId = 0;
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') {
      idleId = ric(run, { timeout: 12_000 });
    } else {
      idleId = window.setTimeout(run, 6_000) as unknown as number;
    }
    const t = window.setInterval(() => void refresh(), 120_000);
    const onVault = () => {
      window.setTimeout(run, 2_500);
    };
    window.addEventListener('trade-pro-vault-changed', onVault);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      window.removeEventListener('trade-pro-vault-changed', onVault);
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
    try {
      await enforceVaultQuota(150 * 1024 * 1024);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    if (
      !window.confirm(
        '清空本机创作素材库？已生成的图片 / 3D / 视频预览将无法再打开（可重新生成）。'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await clearVault();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 px-2 py-1 text-[10px] font-bold ${className}`}
        title="本机素材库，无总容量上限"
      >
        <HardDrive size={12} />
        本机素材 {formatBytes(bytes)}
        {count ? ` · ${count} 个` : ''}
        <button
          type="button"
          disabled={busy || bytes <= 0}
          onClick={() => void onTrim()}
          className="underline decoration-dotted hover:text-slate-900 disabled:opacity-40"
        >
          {busy ? '…' : '清理旧文件'}
        </button>
        <button
          type="button"
          disabled={busy || bytes <= 0}
          onClick={() => void onClear()}
          className="underline decoration-dotted text-rose-600 hover:text-rose-800 disabled:opacity-40"
        >
          清空
        </button>
      </div>
    );
  }

  return (
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
          素材保存在本机应用空间。可点清理旧文件或清空后重新生成。
        </div>
      </div>
      <button
        type="button"
        disabled={busy || bytes <= 0}
        onClick={() => void onTrim()}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
        清理旧文件
      </button>
      <button
        type="button"
        disabled={busy || bytes <= 0}
        onClick={() => void onClear()}
        className="text-[10px] text-rose-600 hover:text-rose-800 underline disabled:opacity-50"
      >
        清空全部
      </button>
    </div>
  );
};
