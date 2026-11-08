import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Hourglass, X, PackageSearch, Square } from 'lucide-react';
import {
  abortAndClearProductDigQueue,
  clearFinishedProductDigJobs,
  dismissProductDigJob,
  resumeProductDigQueue,
  stopProductDigQueue,
  subscribeProductDigJobs,
  type ProductDigJob,
} from '../services/productDigQueue';

const statusUi = (job: ProductDigJob) => {
  if (job.status === 'queued') {
    return { icon: <Hourglass size={16} className="text-amber-500" />, label: '排队中', tone: 'text-amber-700' };
  }
  if (job.status === 'running') {
    return {
      icon: <Loader2 size={16} className="animate-spin text-emerald-600" />,
      label: '深挖中',
      tone: 'text-emerald-700',
    };
  }
  if (job.status === 'completed') {
    return { icon: <CheckCircle2 size={16} className="text-emerald-600" />, label: '已完成', tone: 'text-emerald-700' };
  }
  return { icon: <XCircle size={16} className="text-red-500" />, label: '失败', tone: 'text-red-600' };
};

export const ProductDigPanel: React.FC = () => {
  const [jobs, setJobs] = useState<ProductDigJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeProductDigJobs(setJobs), []);

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const running = jobs.some((j) => j.status === 'running');
  const done = jobs.filter((j) => j.status === 'completed').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const recent = jobs.slice(0, 10);
  if (recent.length === 0) return null;

  const progressTotal = jobs.length;
  const progressDone = done + failed;

  return (
    <div className="w-full shadow-lg">
      <div className="rounded-2xl border border-emerald-200/80 bg-white overflow-hidden">
        <div className="flex items-stretch bg-gradient-to-r from-emerald-700 to-teal-600 text-white">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex-1 flex items-center justify-between gap-2 px-4 py-3.5 text-left"
          >
            <span className="flex items-center gap-2 text-base font-bold">
              <PackageSearch size={18} />
              产品品类补做
              {active.length > 0 && (
                <span className="bg-white/20 px-2.5 py-0.5 rounded-lg text-sm font-extrabold tabular-nums">
                  {progressDone}/{progressTotal}
                </span>
              )}
            </span>
            <span className="text-sm font-semibold opacity-90">{collapsed ? '展开' : '收起'}</span>
          </button>
          <button
            type="button"
            onClick={() => abortAndClearProductDigQueue()}
            className="shrink-0 px-3.5 border-l border-white/20 bg-rose-600/90 hover:bg-rose-600 text-sm font-extrabold inline-flex items-center gap-1.5"
            title="停止并清除全部"
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
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{
                      width: `${progressTotal ? Math.round((progressDone / progressTotal) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => abortAndClearProductDigQueue()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-2 text-sm font-extrabold"
                  >
                    <Square size={14} fill="currentColor" />
                    停止并清除全部
                  </button>
                  {!running && (
                    <button
                      type="button"
                      onClick={() => resumeProductDigQueue()}
                      className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 px-3.5 py-2 text-sm font-extrabold"
                    >
                      继续排队
                    </button>
                  )}
                  {running && (
                    <button
                      type="button"
                      onClick={() => stopProductDigQueue()}
                      className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-3.5 py-2 text-sm font-bold"
                    >
                      仅暂停
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
                      {job.status === 'failed' && job.error ? ` · ${job.error.slice(0, 80)}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissProductDigJob(job.id)}
                    className="text-slate-400 hover:text-slate-700"
                    title="取消/关闭"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}
            {(done > 0 || failed > 0) && active.length === 0 && (
              <button
                type="button"
                onClick={() => clearFinishedProductDigJobs()}
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
