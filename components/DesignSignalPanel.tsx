import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Hourglass, X, Sparkles } from 'lucide-react';
import {
  clearFinishedDesignSignalJobs,
  dismissDesignSignalJob,
  getDesignSignalProgress,
  stopDesignSignalQueue,
  subscribeDesignSignalJobs,
  type DesignSignalJob,
} from '../services/designSignalQueue';

const statusUi = (job: DesignSignalJob) => {
  if (job.status === 'queued') {
    return { icon: <Hourglass size={14} className="text-amber-500" />, label: '排队中', tone: 'text-amber-700' };
  }
  if (job.status === 'running') {
    return {
      icon: <Loader2 size={14} className="animate-spin text-teal-600" />,
      label: '补全中',
      tone: 'text-teal-700',
    };
  }
  if (job.status === 'completed') {
    return { icon: <CheckCircle2 size={14} className="text-emerald-600" />, label: '已完成', tone: 'text-emerald-700' };
  }
  return { icon: <XCircle size={14} className="text-red-500" />, label: '失败', tone: 'text-red-600' };
};

/** 左下角：设计信号轻量补全进度（可通宵挂机） */
export const DesignSignalPanel: React.FC = () => {
  const [jobs, setJobs] = useState<DesignSignalJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeDesignSignalJobs(setJobs), []);

  const progress = getDesignSignalProgress();
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const recent = jobs.slice(0, 12);
  if (recent.length === 0) return null;

  return (
    <div className="w-full shadow-lg">
      <div className="rounded-2xl border border-teal-200/80 bg-white/95 backdrop-blur-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-teal-600 to-cyan-600 text-white"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <Sparkles size={16} />
            设计信号补全
            {active.length > 0 && (
              <span className="bg-white/20 px-2 py-0.5 rounded-lg text-[10px]">
                {progress.completed + progress.failed}/{progress.total}
              </span>
            )}
          </span>
          <span className="text-[10px] font-semibold opacity-80">{collapsed ? '展开' : '收起'}</span>
        </button>

        {!collapsed && (
          <div className="max-h-72 overflow-y-auto p-3 space-y-2 bg-slate-50/90">
            {active.length > 0 && (
              <>
                <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden mb-1">
                  <div
                    className="h-full bg-teal-500 transition-all duration-500"
                    style={{
                      width: `${
                        progress.total
                          ? Math.round(((progress.completed + progress.failed) / progress.total) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <p className="text-[10px] font-bold text-slate-500 px-0.5">
                  请保持本页打开、电脑勿睡眠。刷新后会自动继续排队任务。
                </p>
                <button
                  type="button"
                  onClick={() => stopDesignSignalQueue()}
                  className="text-[10px] font-bold text-amber-700 hover:underline"
                >
                  暂停后续排队
                </button>
              </>
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
                      onClick={() => dismissDesignSignalJob(job.id)}
                      className="text-slate-300 hover:text-slate-500"
                      title="关闭"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              );
            })}
            {(progress.completed > 0 || progress.failed > 0) && active.length === 0 && (
              <button
                type="button"
                onClick={() => clearFinishedDesignSignalJobs()}
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
