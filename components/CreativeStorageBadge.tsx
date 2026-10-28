import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, Trash2, Loader2 } from 'lucide-react';
import {
  clearVault,
  enforceVaultQuota,
  formatBytes,
  getVaultStats,
  VAULT_SOFT_QUOTA_BYTES,
} from '../services/creativeAssetVault';

type Props = {
  className?: string;
  /** 紧凑一行（嵌在模块顶栏） */
  compact?: boolean;
};

/**
 * 演示期素材库用量提示：本机 IndexedDB，带软上限与清理。
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
    void refresh();
    const t = window.setInterval(() => void refresh(), 12_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const onTrim = async () => {
    setBusy(true);
    try {
      // 主动腾出约 30% 配额
      await enforceVaultQuota(Math.floor(VAULT_SOFT_QUOTA_BYTES * 0.3));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    if (!window.confirm('清空本机创作素材库？已生成的图片 / 3D / 视频预览将无法再打开（可重新生成）。')) {
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

  const pct = Math.min(100, Math.round((bytes / VAULT_SOFT_QUOTA_BYTES) * 100));
  const warn = pct >= 80;

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-bold ${
          warn
            ? 'border-amber-300 bg-amber-50 text-amber-900'
            : 'border-slate-200 bg-white text-slate-600'
        } ${className}`}
        title="素材保存在本机浏览器 IndexedDB，不依赖临时外链"
      >
        <HardDrive size={12} />
        本机素材 {formatBytes(bytes)} · {pct}%
        <button
          type="button"
          disabled={busy}
          onClick={() => void onTrim()}
          className="underline decoration-dotted hover:text-slate-900 disabled:opacity-50"
        >
          {busy ? '…' : '清理旧文件'}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border px-3 py-2 flex flex-wrap items-center gap-2 text-xs font-bold ${
        warn
          ? 'border-amber-300 bg-amber-50 text-amber-950'
          : 'border-cyan-200/80 bg-cyan-50/50 text-slate-700'
      } ${className}`}
    >
      <HardDrive size={14} className="text-cyan-700 shrink-0" />
      <div className="min-w-0 flex-1">
        <div>
          本机素材库（演示期）· {count} 个 · {formatBytes(bytes)} /{' '}
          {formatBytes(VAULT_SOFT_QUOTA_BYTES)}（{pct}%）
        </div>
        <div className="text-[10px] font-medium text-slate-500 mt-0.5">
          图片 / 3D / 视频生成后自动下载到本机 IndexedDB，避免供应商临时链接过期丢失；接近上限会自动淘汰最旧文件。
        </div>
        <div className="mt-1.5 h-1 rounded-full bg-slate-200/80 overflow-hidden max-w-xs">
          <div
            className={`h-full transition-all ${warn ? 'bg-amber-500' : 'bg-cyan-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
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
        className="text-[10px] text-slate-400 hover:text-rose-600 underline disabled:opacity-50"
      >
        清空
      </button>
    </div>
  );
};
