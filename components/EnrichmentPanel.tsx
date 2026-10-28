import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  clearFinishedEnrichmentJobs,
  getEnrichmentProgress,
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
  const recent = jobs.slice().reverse().slice(0, 8);

  return (
    <div className="fixed bottom-4 left-4 z-[60] w-[min(100vw-2rem,22rem)] shadow-2xl rounded-2xl border border-violet-200 bg-white/95 backdrop-blur overflow-hidden">
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-3 py-2.5 flex items-center gap-2">
        <Sparkles size={14} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-black truncate">背调补全 · 产品市场匹配</div>
          <div className="text-[10px] font-bold opacity-90">
            {progress.completed}/{progress.total}
            {progress.failed ? ` · 失败 ${progress.failed}` : ''}
            {progress.runningName ? ` · ${progress.runningName}` : ''}
          </div>
        </div>
        <button
          type="button"
          className="text-[10px] font-black underline opacity-90"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>
      {!collapsed && (
        <div className="p-2 max-h-64 overflow-y-auto space-y-1.5">
          <p className="text-[10px] text-slate-500 font-medium px-1 leading-relaxed">
            请保持本页打开。完成后会回写背调、画像与客户标签（含渠道/适市判定）。
          </p>
          {active && (
            <button
              type="button"
              onClick={() => stopEnrichmentQueue()}
              className="text-[10px] font-bold text-amber-700 px-1"
            >
              暂停后续排队
            </button>
          )}
          {recent.map((job) => (
            <div
              key={job.id}
              className="rounded-xl border border-slate-100 bg-slate-50 px-2.5 py-2 text-[11px]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-black text-slate-800 truncate">{job.clientName}</div>
                  <div className="text-slate-400 truncate">{job.domain}</div>
                  {job.steps && (
                    <div className="text-violet-700/80 font-medium mt-0.5 truncate">{job.steps}</div>
                  )}
                  {job.error && (
                    <div className="text-rose-600 font-medium mt-0.5 line-clamp-2">{job.error}</div>
                  )}
                </div>
                <div className="shrink-0">
                  {job.status === 'running' || job.status === 'queued' ? (
                    <Loader2 size={14} className="animate-spin text-violet-600" />
                  ) : job.status === 'completed' ? (
                    <CheckCircle2 size={14} className="text-emerald-600" />
                  ) : (
                    <AlertTriangle size={14} className="text-rose-500" />
                  )}
                </div>
              </div>
            </div>
          ))}
          {(progress.completed > 0 || progress.failed > 0) && !active && (
            <button
              type="button"
              onClick={() => clearFinishedEnrichmentJobs()}
              className="w-full text-[10px] font-black text-slate-500 py-1.5 flex items-center justify-center gap-1"
            >
              <X size={12} /> 清除已完成
            </button>
          )}
        </div>
      )}
    </div>
  );
};
