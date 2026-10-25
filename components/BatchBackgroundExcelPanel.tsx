import React, { useRef, useState } from 'react';
import {
  Download,
  Upload,
  FileSpreadsheet,
  Loader2,
  Play,
  X,
  SkipForward,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { Client, HistoryItem } from '../types';
import {
  type ClassifiedBatchBgRow,
  type BatchBgClassifyStats,
  downloadBatchBackgroundTemplate,
  parseBatchBackgroundExcel,
  classifyBatchBackgroundRows,
  summarizeBatchBgClasses,
} from '../services/batchBackgroundExcel';

type Props = {
  open: boolean;
  onClose: () => void;
  history: HistoryItem[];
  crmClients: Client[];
  /** 用户确认开始：仅传入需真实背调的行 + 需从历史补入 CRM 的行 */
  onStart: (payload: {
    toAnalyze: ClassifiedBatchBgRow[];
    toCrmFromHistory: ClassifiedBatchBgRow[];
    stats: BatchBgClassifyStats;
    mode: 'economy' | 'detailed';
  }) => void;
};

/**
 * 背景调查 · Excel 批量：下载模板 → 上传填写 → 预览去重 → 开始批量背调/产品分析
 */
export const BatchBackgroundExcelPanel: React.FC<Props> = ({
  open,
  onClose,
  history,
  crmClients,
  onStart,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ClassifiedBatchBgRow[]>([]);
  const [stats, setStats] = useState<BatchBgClassifyStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<'economy' | 'detailed'>('economy');

  if (!open) return null;

  const reset = () => {
    setRows([]);
    setStats(null);
    setMsg(null);
    setFileName('');
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const parsed = await parseBatchBackgroundExcel(file);
      const classified = classifyBatchBackgroundRows(parsed, history, crmClients);
      const s = summarizeBatchBgClasses(classified);
      setRows(classified);
      setStats(s);
      setFileName(file.name);
      setMsg(
        `已解析 ${s.total} 行：待背调 ${s.needAnalyze} · 跳过 ${s.skipCrm + s.skipHistory} · 无效 ${s.invalid}`
      );
    } catch (e: any) {
      setRows([]);
      setStats(null);
      setMsg(e?.message || '解析失败');
    } finally {
      setBusy(false);
    }
  };

  const handleStart = () => {
    if (!stats) {
      setMsg('请先上传填写好的 Excel');
      return;
    }
    const toAnalyze = rows.filter((r) => r.class === 'need_analyze');
    const toCrmFromHistory = rows.filter(
      (r) => r.class === 'skip_history' && r.historyItem?.data
    );
    if (!toAnalyze.length && !toCrmFromHistory.length) {
      setMsg(
        stats.skipCrm
          ? '全部客户已在 CRM 背调过，无需重复消耗额度。'
          : '没有可执行的任务（请检查表格内容）。'
      );
      return;
    }
    onStart({ toAnalyze, toCrmFromHistory, stats, mode });
    reset();
    onClose();
  };

  const classLabel = (c: ClassifiedBatchBgRow['class']) => {
    if (c === 'need_analyze') return { text: '待背调', tone: 'text-cyan-700 bg-cyan-50' };
    if (c === 'skip_crm') return { text: '跳过·CRM', tone: 'text-slate-600 bg-slate-100' };
    if (c === 'skip_history') return { text: '跳过·补CRM', tone: 'text-amber-800 bg-amber-50' };
    return { text: '无效', tone: 'text-rose-700 bg-rose-50' };
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm">
      <div className="bg-white w-full max-w-3xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col animate-fade-in overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-cyan-700 font-black text-xs uppercase tracking-widest">
              <FileSpreadsheet size={14} /> Excel 批量背调
            </div>
            <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 mt-1">
              导入表格 · 批量背景调查与产品分析
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-1 max-w-xl">
              下载模板填写后上传。已背调客户自动跳过；完成后写入 CRM。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-4 space-y-3 overflow-y-auto flex-1">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                try {
                  downloadBatchBackgroundTemplate();
                } catch (e: any) {
                  setMsg(e?.message || '下载失败');
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-black text-slate-700"
            >
              <Download size={14} /> 下载 Excel 模板
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-2 text-xs font-black disabled:opacity-50"
            >
              {busy ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
              上传已填写表格
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              className="hidden"
              onChange={(e) => {
                void onPickFile(e.target.files?.[0] || null);
                e.target.value = '';
              }}
            />
            {fileName && (
              <span className="text-[11px] font-bold text-slate-400 self-center truncate max-w-[12rem]">
                {fileName}
              </span>
            )}
          </div>

          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-xl border border-cyan-100 bg-cyan-50/60 px-3 py-2">
                <div className="text-[10px] font-black text-cyan-700 uppercase">待背调</div>
                <div className="text-lg font-black text-cyan-900">{stats.needAnalyze}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1">
                  <SkipForward size={10} /> CRM 已有
                </div>
                <div className="text-lg font-black text-slate-800">{stats.skipCrm}</div>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2">
                <div className="text-[10px] font-black text-amber-800 uppercase">历史→CRM</div>
                <div className="text-lg font-black text-amber-950">{stats.skipHistory}</div>
              </div>
              <div className="rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2">
                <div className="text-[10px] font-black text-rose-600 uppercase flex items-center gap-1">
                  <AlertCircle size={10} /> 无效
                </div>
                <div className="text-lg font-black text-rose-900">{stats.invalid}</div>
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="rounded-2xl border border-slate-200 overflow-hidden max-h-56 overflow-y-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-slate-500 font-black">
                    <th className="px-3 py-2">行</th>
                    <th className="px-3 py-2">公司</th>
                    <th className="px-3 py-2">网址</th>
                    <th className="px-3 py-2">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(0, 80).map((r) => {
                    const lab = classLabel(r.class);
                    return (
                      <tr key={`${r.rowIndex}-${r.website}-${r.companyName}`}>
                        <td className="px-3 py-1.5 text-slate-400 font-mono">{r.rowIndex}</td>
                        <td className="px-3 py-1.5 font-bold text-slate-800 truncate max-w-[8rem]">
                          {r.companyName || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500 truncate max-w-[10rem]">
                          {r.website || '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-block rounded-md px-1.5 py-0.5 font-black ${lab.tone}`}>
                            {lab.text}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 80 && (
                <p className="text-[10px] text-slate-400 text-center py-2">仅预览前 80 行</p>
              )}
            </div>
          )}

          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              背调模式
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('economy')}
                className={`rounded-xl border p-3 text-left ${
                  mode === 'economy' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'
                }`}
              >
                <div className="text-xs font-black text-slate-800">经济模式</div>
                <p className="text-[10px] text-slate-500 mt-0.5">更快 · 省额度 · 推荐批量</p>
              </button>
              <button
                type="button"
                onClick={() => setMode('detailed')}
                className={`rounded-xl border p-3 text-left ${
                  mode === 'detailed' ? 'border-violet-500 bg-violet-50' : 'border-slate-200'
                }`}
              >
                <div className="text-xs font-black text-slate-800">详细模式</div>
                <p className="text-[10px] text-slate-500 mt-0.5">更深情报 · 更耗额度</p>
              </button>
            </div>
          </div>

          {msg && (
            <p className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 flex items-start gap-2">
              <CheckCircle2 size={14} className="text-cyan-600 mt-0.5 flex-shrink-0" />
              {msg}
            </p>
          )}
        </div>

        <div className="px-5 sm:px-6 py-4 border-t border-slate-100 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || !stats}
            onClick={handleStart}
            className="rounded-xl bg-slate-900 hover:bg-cyan-700 text-white px-5 py-2.5 text-sm font-black inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Play size={16} /> 开始批量背调
          </button>
        </div>
      </div>
    </div>
  );
};
