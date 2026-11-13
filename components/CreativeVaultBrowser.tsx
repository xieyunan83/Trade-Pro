import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FolderOpen, Loader2, Trash2, X, Paintbrush, Box, Image, Film } from 'lucide-react';
import {
  VAULT_PREFIX,
  deleteVaultRef,
  downloadMediaFile,
  formatBytes,
  getRowBlobForVaultId,
  glbBlobLikelyHasTextures,
  listVaultMeta,
  notifyVaultChanged,
  type VaultKind,
  type VaultMeta,
} from '../services/creativeAssetVault';

type KindFilter = 'all' | VaultKind;

type Props = {
  open: boolean;
  onClose: () => void;
  /** 3D 工作台：把库内 GLB 设为当前任务原模（不新建任务、不耗额度） */
  onUseModel3dAsOriginal?: (vaultRef: string, meta: VaultMeta) => void | Promise<void>;
};

const kindLabel = (k: VaultKind | string) => {
  if (k === 'model3d') return '3D';
  if (k === 'image') return '图片';
  if (k === 'video') return '视频';
  return '其它';
};

const kindIcon = (k: VaultKind | string) => {
  if (k === 'model3d') return <Box size={14} />;
  if (k === 'image') return <Image size={14} />;
  if (k === 'video') return <Film size={14} />;
  return <FolderOpen size={14} />;
};

const shortId = (id: string) => (id.length > 28 ? `${id.slice(0, 12)}…${id.slice(-10)}` : id);

const fmtTime = (ts: number) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

/**
 * 本机素材库浏览器：列出 IndexedDB 里每一项，可下载 / 删除；
 * 在 3D 模块可「设为当前任务原模」（零额度找回彩色文件）。
 */
export const CreativeVaultBrowser: React.FC<Props> = ({
  open,
  onClose,
  onUseModel3dAsOriginal,
}) => {
  const [rows, setRows] = useState<VaultMeta[]>([]);
  const [filter, setFilter] = useState<KindFilter>('all');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [texMap, setTexMap] = useState<Record<string, boolean | 'checking'>>({});
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await listVaultMeta();
      list.sort((a, b) => (b.lastAccessAt || b.createdAt || 0) - (a.lastAccessAt || a.createdAt || 0));
      setRows(list);
    } catch (e: any) {
      setErr(e?.message || '读取本机素材失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  /** 打开后异步检测 3D 是否带贴图（便于找出彩色原模） */
  useEffect(() => {
    if (!open) return;
    const models = rows.filter((r) => r.kind === 'model3d');
    if (!models.length) return;
    let cancelled = false;
    void (async () => {
      for (const m of models) {
        if (cancelled) return;
        setTexMap((prev) => (prev[m.id] !== undefined ? prev : { ...prev, [m.id]: 'checking' }));
        try {
          const blob = await getRowBlobForVaultId(m.id);
          const has = blob ? await glbBlobLikelyHasTextures(blob) : false;
          if (cancelled) return;
          setTexMap((prev) => ({ ...prev, [m.id]: has }));
        } catch {
          if (cancelled) return;
          setTexMap((prev) => ({ ...prev, [m.id]: false }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, rows]);

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.kind === filter)),
    [rows, filter]
  );

  const totalBytes = useMemo(() => rows.reduce((s, r) => s + (r.size || 0), 0), [rows]);

  const onDownload = async (m: VaultMeta) => {
    setBusyId(m.id);
    try {
      const ext =
        m.kind === 'model3d'
          ? 'glb'
          : m.kind === 'video'
            ? 'mp4'
            : m.mime?.includes('png')
              ? 'png'
              : 'bin';
      await downloadMediaFile(`${VAULT_PREFIX}${m.id}`, `${m.sourceHint || m.id}.${ext}`);
    } catch (e: any) {
      window.alert(e?.message || '下载失败');
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (m: VaultMeta) => {
    if (!window.confirm(`删除本机文件？\n${m.id}\n约 ${formatBytes(m.size)}`)) return;
    setBusyId(m.id);
    try {
      await deleteVaultRef(`${VAULT_PREFIX}${m.id}`);
      notifyVaultChanged();
      await refresh();
    } catch (e: any) {
      window.alert(e?.message || '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const onUseOrig = async (m: VaultMeta) => {
    if (!onUseModel3dAsOriginal) return;
    setBusyId(m.id);
    try {
      await onUseModel3dAsOriginal(`${VAULT_PREFIX}${m.id}`, m);
      onClose();
    } catch (e: any) {
      window.alert(e?.message || '绑定失败');
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-950/55 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="本机素材库"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[min(88vh,40rem)] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-100 bg-slate-50">
          <div className="min-w-0">
            <div className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <FolderOpen size={16} className="text-teal-700" />
              本机素材库
            </div>
            <div className="text-[10px] font-bold text-slate-500 mt-0.5">
              {rows.length} 个 · {formatBytes(totalBytes)} · 仅本机，不耗云端额度
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/80"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-slate-100">
          {(
            [
              { id: 'all' as const, label: '全部' },
              { id: 'model3d' as const, label: '3D' },
              { id: 'image' as const, label: '图片' },
              { id: 'video' as const, label: '视频' },
              { id: 'other' as const, label: '其它' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-black ${
                filter === t.id
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
            className="ml-auto rounded-lg px-2 py-1 text-[10px] font-bold text-teal-800 hover:bg-teal-50 disabled:opacity-50"
          >
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>

        {err ? (
          <div className="px-3 py-2 text-[11px] font-bold text-rose-600">{err}</div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
          {loading && !visible.length ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-xs font-bold">
              <Loader2 className="animate-spin" size={18} /> 读取本机库…
            </div>
          ) : null}
          {!loading && !visible.length ? (
            <div className="py-10 text-center text-xs font-bold text-slate-400">
              没有素材。生成/导入后会出现在这里。
            </div>
          ) : null}
          {visible.map((m) => {
            const tex = texMap[m.id];
            const busy = busyId === m.id;
            return (
              <div
                key={m.id}
                className="rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 py-2 flex flex-wrap items-start gap-2"
              >
                <div className="mt-0.5 text-teal-700 shrink-0">{kindIcon(m.kind)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-black text-slate-800 break-all">
                    {shortId(m.id)}
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span>{kindLabel(m.kind)}</span>
                    <span>{formatBytes(m.size)}</span>
                    <span>访问 {fmtTime(m.lastAccessAt)}</span>
                    {m.sourceHint ? (
                      <span className="text-slate-400 truncate max-w-[12rem]" title={m.sourceHint}>
                        {m.sourceHint}
                      </span>
                    ) : null}
                    {m.kind === 'model3d' ? (
                      <span
                        className={
                          tex === true
                            ? 'text-emerald-700'
                            : tex === false
                              ? 'text-amber-700'
                              : 'text-slate-400'
                        }
                      >
                        {tex === 'checking' || tex === undefined
                          ? '检测贴图…'
                          : tex
                            ? '疑似有贴图'
                            : '疑似无贴图（灰模）'}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 shrink-0">
                  {m.kind === 'model3d' && onUseModel3dAsOriginal ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onUseOrig(m)}
                      className="inline-flex items-center gap-0.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[9px] font-black px-2 py-1 disabled:opacity-50"
                      title="设为当前任务原模，不耗额度"
                    >
                      {busy ? <Loader2 size={11} className="animate-spin" /> : <Paintbrush size={11} />}
                      设为原模
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onDownload(m)}
                    className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white text-[9px] font-black px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Download size={11} /> 下载
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onDelete(m)}
                    className="inline-flex items-center gap-0.5 rounded-lg text-[9px] font-black px-2 py-1 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Trash2 size={11} /> 删
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-3 py-2 border-t border-slate-100 text-[9px] font-medium text-slate-500 leading-relaxed">
          优先选「疑似有贴图」的 3D 设为原模（零额度）。若列表里全是灰模，说明彩色副本曾被拆分/回填覆盖且云端临时链已过期，只能重新贴图或重新生成——请勿点「清空」。
        </div>
      </div>
    </div>
  );
};
