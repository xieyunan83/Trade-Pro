import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles, X, CheckCircle2, AlertTriangle, Square } from 'lucide-react';
import {
  abortAndClearEnrichmentQueue,
  clearFinishedEnrichmentJobs,
  dismissEnrichmentJob,
  getEnrichmentProgress,
  resumeEnrichmentQueue,
  stopEnrichmentQueue,
  subscribeEnrichmentJobs,
  type EnrichmentJob,
} from '../services/analysisEnrichmentQueue';

/** 左下角：背调补全进度（产品·市场·匹配 + 决策模型） */
export const EnrichmentPanel: React.FC = () => {
  const [jobs, setJobs] = useState<EnrichmentJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeEnrichmentJobs(setJobs), []);

  const progress = getEnrichmentProgress();
  if (!progress.total) return null;

  const active = progress.active > 0;
  const running = jobs.some((j) => j.status === 'running');
  const recent = jobs.slice().reverse().slice(0, 8);

  return (
    <div className="relative w-full shadow-2xl rounded-2xl border border-violet-200 bg-white overflow-hidden">
      <div className="flex items-stretch bg-gradient-to-r from-violet-700 to-indigo-600 text-white">
        <button
          type="button"
          className="flex-1 px-3 py-3 flex items-center gap-2 text-left"
          onClick={() => setCollapsed((v) => !v)}
        >
          <Sparkles size={16} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black truncate">背调补全 · 产品市场匹配</div>
            <div className="text-xs font-bold opacity-90 tabular-nums">
              {progress.completed}/{progress.total}
              {progress.failed ? ` · 失败 ${progress.failed}` : ''}
              {progress.runningName ? ` · ${progress.runningName}` : ''}
            </div>
          </div>
          <span className="text-xs font-bold opacity-90">{collapsed ? '展开' : '收起'}</span>
        </button>
        <button
          type="button"
          onClick={() => abortAndClearEnrichmentQueue()}
          className="shrink-0 px-3 border-l border-white/20 bg-rose-600/90 hover:bg-rose-600 text-sm font-extrabold inline-flex items-center gap-1"
          title="停止并清除全部"
        >
          <Square size={14} fill="currentColor" />
          停止
        </button>
      </div>
      {!collapsed && (
        <div className="p-3 max-h-72 overflow-y-auto space-y-2 bg-slate-50">
          <p className="text-sm text-slate-600 font-medium leading-relaxed">
            {running
              ? '补全进行中，可随时点「停止」结束并清除。'
              : active
                ? '有排队任务但未在跑。不需要就点「停止并清除」。'
                : '完成后会回写背调、画像与客户标签。'}
          </p>
          {active && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => abortAndClearEnrichmentQueue()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-3 py-2 text-sm font-extrabold"
              >
                <Square size={14} fill="currentColor" />
                停止并清除全部
              </button>
              {!running && (
                <button
                  type="button"
                  onClick={() => resumeEnrichmentQueue()}
                  className="rounded-xl border border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-900 px-3 py-2 text-sm font-extrabold"
                >
                  继续排队
                </button>
              )}
              {running && (
                <button
                  type="button"
                  onClick={() => stopEnrichmentQueue()}
                  className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm font-bold"
                >
                  仅暂停
                </button>
              )}
            </div>
          )}
          {recent.map((job) => (
            <div
              key={job.id}
              className="rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-sm flex items-start gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-800 truncate">{job.clientName}</div>
                <div className="text-xs text-slate-400 truncate">{job.domain}</div>
                {job.steps && (
                  <div className="text-xs text-violet-700/80 font-medium mt-0.5 truncate">{job.steps}</div>
                )}
                {job.error && (
                  <div className="text-xs text-rose-600 font-medium mt-0.5 line-clamp-2">{job.error}</div>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {job.status === 'running' || job.status === 'queued' ? (
                  <Loader2 size={16} className="animate-spin text-violet-600" />
                ) : job.status === 'completed' ? (
                  <CheckCircle2 size={16} className="text-emerald-600" />
                ) : (
                  <AlertTriangle size={16} className="text-rose-500" />
                )}
                <button
                  type="button"
                  onClick={() => dismissEnrichmentJob(job.id)}
                  className="text-slate-400 hover:text-slate-700 p-0.5"
                  title="取消/关闭"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          ))}
          {(progress.completed > 0 || progress.failed > 0) && !active && (
            <button
              type="button"
              onClick={() => clearFinishedEnrichmentJobs()}
              className="w-full text-sm font-bold text-slate-600 py-2 rounded-xl border border-slate-200 bg-white"
            >
              清除已完成
            </button>
          )}
        </div>
      )}
    </div>
  );
};
