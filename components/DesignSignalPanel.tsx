import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Hourglass, X, Sparkles, Square } from 'lucide-react';
import {
  abortAndClearDesignSignalQueue,
  clearFinishedDesignSignalJobs,
  dismissDesignSignalJob,
  getDesignSignalProgress,
  resumeDesignSignalQueue,
  stopDesignSignalQueue,
  subscribeDesignSignalJobs,
  type DesignSignalJob,
} from '../services/designSignalQueue';

const statusUi = (job: DesignSignalJob) => {
  if (job.status === 'queued') {
    return { icon: <Hourglass size={16} className="text-amber-500" />, label: '排队中', tone: 'text-amber-700' };
  }
  if (job.status === 'running') {
    return {
      icon: <Loader2 size={16} className="animate-spin text-teal-600" />,
      label: '补全中',
      tone: 'text-teal-700',
    };
  }
  if (job.status === 'completed') {
    return { icon: <CheckCircle2 size={16} className="text-emerald-600" />, label: '已完成', tone: 'text-emerald-700' };
  }
  return { icon: <XCircle size={16} className="text-red-500" />, label: '失败', tone: 'text-red-600' };
};

/** 左下角：设计信号轻量补全进度（可通宵挂机） */
export const DesignSignalPanel: React.FC = () => {
  const [jobs, setJobs] = useState<DesignSignalJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeDesignSignalJobs(setJobs), []);

  const progress = getDesignSignalProgress();
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const running = jobs.some((j) => j.status === 'running');
  const recent = jobs.slice(0, 12);
  if (recent.length === 0) return null;

  const doneCount = progress.completed + progress.failed;

  return (
    <div className="w-full shadow-xl">
      <div className="rounded-2xl border border-teal-300/90 bg-white overflow-hidden ring-1 ring-teal-500/10">
        <div className="flex items-stretch bg-gradient-to-r from-teal-700 via-teal-600 to-cyan-600 text-white">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex-1 flex items-center justify-between gap-2 px-4 py-3.5 text-left"
          >
            <span className="flex items-center gap-2 text-base font-bold">
              <Sparkles size={18} />
              设计信号补全
              <span className="bg-white/25 px-2.5 py-0.5 rounded-lg text-sm font-extrabold tabular-nums">
                {doneCount}/{progress.total}
              </span>
            </span>
            <span className="text-sm font-semibold opacity-90">{collapsed ? '展开' : '收起'}</span>
          </button>
          <button
            type="button"
            onClick={() => abortAndClearDesignSignalQueue()}
            className="shrink-0 px-3.5 border-l border-white/20 bg-rose-600/90 hover:bg-rose-600 text-sm font-extrabold inline-flex items-center gap-1.5"
            title="停止并清除全部任务"
          >
            <Square size={14} fill="currentColor" />
            停止
          </button>
        </div>

        {!collapsed && (
          <div className="max-h-80 overflow-y-auto p-3.5 space-y-2.5 bg-slate-50">
            {active.length > 0 && (
              <>
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-teal-500 transition-all duration-500"
                    style={{
                      width: `${
                        progress.total ? Math.round((doneCount / progress.total) * 100) : 0
                      }%`,
                    }}
                  />
                </div>
                <p className="text-sm font-semibold text-slate-600 leading-snug">
                  {running
                    ? '正在补全中。可随时点右上角「停止」结束并清除。'
                    : '任务在排队但未在跑（多半上次暂停或刷新后未续跑）。不需要就点「停止并清除」。'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => abortAndClearDesignSignalQueue()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-2 text-sm font-extrabold shadow-sm"
                  >
                    <Square size={14} fill="currentColor" />
                    停止并清除全部
                  </button>
                  {!running && (
                    <button
                      type="button"
                      onClick={() => resumeDesignSignalQueue()}
                      className="inline-flex items-center justify-center rounded-xl border border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-900 px-3.5 py-2 text-sm font-extrabold"
                    >
                      继续排队
                    </button>
                  )}
                  {running && (
                    <button
                      type="button"
                      onClick={() => stopDesignSignalQueue()}
                      className="inline-flex items-center justify-center rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 px-3.5 py-2 text-sm font-bold"
                    >
                      仅暂停（保留队列）
                    </button>
                  )}
                </div>
              </>
            )}
            {recent.map((job) => {
              const ui = statusUi(job);
              return (
                <div
                  key={job.id}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 flex items-start gap-2.5"
                >
                  <div className="mt-0.5">{ui.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900 truncate">{job.clientName}</div>
                    <div className="text-xs font-medium text-slate-500 truncate">{job.domain}</div>
                    <div className={`text-xs font-bold mt-1 ${ui.tone}`}>
                      {ui.label}
                      {job.status === 'failed' && job.error ? ` · ${job.error.slice(0, 48)}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissDesignSignalJob(job.id)}
                    className="text-slate-400 hover:text-slate-700 p-0.5"
                    title={job.status === 'queued' || job.status === 'running' ? '取消此任务' : '关闭'}
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}
            {(progress.completed > 0 || progress.failed > 0) && active.length === 0 && (
              <button
                type="button"
                onClick={() => clearFinishedDesignSignalJobs()}
                className="w-full text-sm font-bold text-slate-600 hover:text-slate-800 py-2 rounded-xl border border-slate-200 bg-white"
              >
                清除已完成记录
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
