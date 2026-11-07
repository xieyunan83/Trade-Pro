import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  RefreshCw,
} from 'lucide-react';
import type { Client, HistoryItem } from '../types';
import {
  type ClassifiedBatchBgRow,
  type BatchBgClassifyStats,
  downloadBatchBackgroundTemplate,
  parseBatchBackgroundExcel,
  enrichBatchRowsMissingDomains,
  classifyBatchBackgroundRows,
  summarizeBatchBgClasses,
} from '../services/batchBackgroundExcel';
import {
  clearExcelBatchDraft,
  loadExcelBatchDraft,
  saveExcelBatchDraft,
} from '../services/excelBatchDraftStore';

type Props = {
  open: boolean;
  onClose: () => void;
  history: HistoryItem[];
  crmClients: Client[];
  /** 用户确认开始：待背调 + 仅合并补充 + 历史补 CRM */
  onStart: (payload: {
    toAnalyze: ClassifiedBatchBgRow[];
    toMergeUpdate: ClassifiedBatchBgRow[];
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

  // 打开面板时恢复未开始的草稿（防休眠/刷新白干）
  useEffect(() => {
    if (!open) return;
    if (rows.length || busy) return;
    const draft = loadExcelBatchDraft();
    if (!draft?.rows?.length) return;
    setRows(draft.rows);
    setStats(draft.stats);
    setFileName(draft.fileName || '');
    setMode(draft.mode || 'economy');
    setMsg(
      draft.msg ||
        `已恢复上次导入草稿（${draft.stats.total} 行，${new Date(draft.savedAt).toLocaleString('zh-CN')}），可直接开始批量处理。`
    );
  }, [open]);

  // 打开时锁滚动，避免用户以为对话框「掉到页面下面」
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const reset = (clearDraft = false) => {
    setRows([]);
    setStats(null);
    setMsg(null);
    setFileName('');
    if (clearDraft) clearExcelBatchDraft();
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const parsed = await parseBatchBackgroundExcel(file);
      const missing = parsed.filter((r) => !(r.website || '').trim()).length;
      if (missing > 0) {
        setMsg(
          `已读入 ${parsed.length} 行（缺网址 ${missing}）。大批量将用邮箱@后缀快速推断域名，几秒到一两分钟内可点开始…`
        );
      }
      const { rows: enriched, guessed, modeUsed } = await enrichBatchRowsMissingDomains(
        parsed,
        (done, total) => {
          if (done === total || done % 500 === 0) {
            setMsg(`域名快速推断中 ${done}/${total}…`);
          }
        }
      );
      const classified = classifyBatchBackgroundRows(enriched, history, crmClients);
      const s = summarizeBatchBgClasses(classified);
      const summary =
        `已解析 ${s.total} 行：待背调 ${s.needAnalyze} · 仅补充 ${s.mergeUpdate} · 跳过 ${s.skipCrm + s.skipHistory} · 无效 ${s.invalid}` +
        (guessed
          ? ` · 域名${modeUsed === 'soft' ? '软推断' : '核验'}成功 ${guessed}`
          : missing
            ? ' · 部分缺网址未能推断域名'
            : '') +
        (modeUsed === 'soft' && missing > 60
          ? '（大批量已跳过逐条开网页，避免卡死；任务入队后可挂机/夜间续跑）'
          : '');
      setRows(classified);
      setStats(s);
      setFileName(file.name);
      setMsg(summary);
      saveExcelBatchDraft({
        savedAt: Date.now(),
        fileName: file.name,
        mode,
        stats: s,
        rows: classified,
        msg: summary,
      });
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
    const toMergeUpdate = rows.filter((r) => r.class === 'merge_update');
    const toCrmFromHistory = rows.filter(
      (r) => r.class === 'skip_history' && r.historyItem?.data
    );
    if (!toAnalyze.length && !toMergeUpdate.length && !toCrmFromHistory.length) {
      setMsg(
        stats.skipCrm
          ? '全部客户已在库中且表格无新字段可补充，无需重复消耗额度。'
          : '没有可执行的任务（请检查表格内容）。'
      );
      return;
    }
    onStart({ toAnalyze, toMergeUpdate, toCrmFromHistory, stats, mode });
    reset(true);
    onClose();
  };

  const classLabel = (c: ClassifiedBatchBgRow['class']) => {
    if (c === 'need_analyze') return { text: '待背调', tone: 'text-cyan-700 bg-cyan-50' };
    if (c === 'merge_update') return { text: '仅补充', tone: 'text-indigo-700 bg-indigo-50' };
    if (c === 'skip_crm') return { text: '跳过·CRM', tone: 'text-slate-600 bg-slate-100' };
    if (c === 'skip_history') return { text: '跳过·补CRM', tone: 'text-amber-800 bg-amber-50' };
    return { text: '无效', tone: 'text-rose-700 bg-rose-50' };
  };

  // 挂到 body：保证相对视口正中居中，压过左下任务条；不改其它模块布局
  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="excel-batch-title"
    >
      <div className="bg-white w-full max-w-3xl max-h-[min(90vh,880px)] rounded-3xl shadow-2xl flex flex-col animate-fade-in overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-cyan-700 font-black text-xs uppercase tracking-widest">
              <FileSpreadsheet size={14} /> Excel 批量背调
            </div>
            <h3 id="excel-batch-title" className="text-lg sm:text-xl font-extrabold text-slate-900 mt-1">
              导入表格 · 批量背景调查与产品分析
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-1 max-w-xl">
              模板含公司/国家/简介/联系人/地址/邮编/电话/传真/邮件/网站等名录字段。无网站可用邮件@后缀猜域名；超 20 家可夜间静默。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              // 关闭不删草稿，休眠回来可继续
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
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="rounded-xl border border-cyan-100 bg-cyan-50/60 px-3 py-2">
                <div className="text-[10px] font-black text-cyan-700 uppercase">待背调</div>
                <div className="text-lg font-black text-cyan-900">{stats.needAnalyze}</div>
              </div>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2">
                <div className="text-[10px] font-black text-indigo-700 uppercase flex items-center gap-1">
                  <RefreshCw size={10} /> 仅补充
                </div>
                <div className="text-lg font-black text-indigo-950">{stats.mergeUpdate}</div>
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
                    <th className="px-3 py-2">联系人</th>
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
                          {r.domainGuessed ? (
                            <span className="ml-1 text-[10px] font-black text-indigo-600">推断</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">
                          {r.contacts?.length || 0}
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
              背调模式（仅「待背调」客户）
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
              if (rows.length && !confirm('取消将清除本机导入草稿，确定？')) return;
              reset(true);
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
            <Play size={16} /> 开始批量处理
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
