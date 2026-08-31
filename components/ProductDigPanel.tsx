import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Hourglass, X, PackageSearch } from 'lucide-react';
import {
  clearFinishedProductDigJobs,
  dismissProductDigJob,
  subscribeProductDigJobs,
  type ProductDigJob,
} from '../services/productDigQueue';

const statusUi = (job: ProductDigJob) => {
  if (job.status === 'queued') {
    return { icon: <Hourglass size={14} className="text-amber-500" />, label: '排队中', tone: 'text-amber-700' };
  }
  if (job.status === 'running') {
    return {
      icon: <Loader2 size={14} className="animate-spin text-emerald-600" />,
      label: '深挖中',
      tone: 'text-emerald-700',
    };
  }
  if (job.status === 'completed') {
    return { icon: <CheckCircle2 size={14} className="text-emerald-600" />, label: '已完成', tone: 'text-emerald-700' };
  }
  return { icon: <XCircle size={14} className="text-red-500" />, label: '失败', tone: 'text-red-600' };
};

export const ProductDigPanel: React.FC = () => {
  const [jobs, setJobs] = useState<ProductDigJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeProductDigJobs(setJobs), []);

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const done = jobs.filter((j) => j.status === 'completed').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const recent = jobs.slice(0, 10);
  if (recent.length === 0) return null;

  const progressTotal = jobs.length;
  const progressDone = done + failed;

  return (
    <div className="fixed bottom-4 left-4 z-[60] w-[min(100vw-2rem,22rem)] shadow-lg">
      <div className="rounded-2xl border border-emerald-200/80 bg-white/95 backdrop-blur-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <PackageSearch size={16} />
            产品深挖后台任务
            {active.length > 0 && (
              <span className="bg-white/20 px-2 py-0.5 rounded-lg text-[10px]">
                {progressDone}/{progressTotal}
              </span>
            )}
          </span>
          <span className="text-[10px] font-semibold opacity-80">{collapsed ? '展开' : '收起'}</span>
        </button>

        {!collapsed && (
          <div className="max-h-72 overflow-y-auto p-3 space-y-2 bg-slate-50/90">
            {active.length > 0 && (
              <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden mb-1">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${progressTotal ? Math.round((progressDone / progressTotal) * 100) : 0}%` }}
                />
              </div>
            )}
            {recent.map((job) => {
              const ui = statusUi(job);
              return (
                <div
                  key={job.id}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 flex items-start gap-2"
                >
                  <div className="mt-0.5">{ui.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-black text-slate-800 truncate">{job.clientName}</div>
                    <div className="text-[10px] font-bold text-slate-400 truncate">{job.domain}</div>
                    <div className={`text-[10px] font-black mt-1 ${ui.tone}`}>
                      {ui.label}
                      {job.status === 'failed' && job.error ? ` · ${job.error.slice(0, 40)}` : ''}
                    </div>
                  </div>
                  {(job.status === 'completed' || job.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => dismissProductDigJob(job.id)}
                      className="text-slate-300 hover:text-slate-500"
                      title="关闭"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              );
            })}
            {(done > 0 || failed > 0) && active.length === 0 && (
              <button
                type="button"
                onClick={() => clearFinishedProductDigJobs()}
                className="w-full text-[10px] font-bold text-slate-500 hover:text-slate-700 py-1"
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
