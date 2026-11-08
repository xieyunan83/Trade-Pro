import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Hourglass, X, Users, Square } from 'lucide-react';
import {
  abortAndClearDmEmailSearchQueue,
  clearFinishedDmEmailSearchJobs,
  dismissDmEmailSearchJob,
  subscribeDmEmailSearchJobs,
  type DmEmailSearchJob,
} from '../services/dmEmailSearchQueue';

const statusUi = (job: DmEmailSearchJob) => {
  if (job.status === 'queued') {
    return { icon: <Hourglass size={16} className="text-amber-500" />, label: '排队中', tone: 'text-amber-700' };
  }
  if (job.status === 'running') {
    return {
      icon: <Loader2 size={16} className="animate-spin text-cyan-600" />,
      label: '搜索中',
      tone: 'text-cyan-700',
    };
  }
  if (job.status === 'completed') {
    return { icon: <CheckCircle2 size={16} className="text-emerald-600" />, label: '已完成', tone: 'text-emerald-700' };
  }
  return { icon: <XCircle size={16} className="text-red-500" />, label: '失败', tone: 'text-red-600' };
};

export const DmEmailSearchPanel: React.FC = () => {
  const [jobs, setJobs] = useState<DmEmailSearchJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeDmEmailSearchJobs(setJobs), []);

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const recent = jobs.slice(0, 8);
  if (recent.length === 0) return null;

  return (
    <div className="w-full shadow-signal">
      <div className="rounded-2xl border border-cyan-200/70 bg-white overflow-hidden">
        <div className="flex items-stretch bg-gradient-to-r from-cyan-700 to-sky-600 text-white">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex-1 flex items-center justify-between gap-2 px-4 py-3.5 text-left"
          >
            <span className="flex items-center gap-2 text-base font-bold">
              <Users size={18} />
              决策人邮箱后台任务
              {active.length > 0 && (
                <span className="bg-white/20 px-2.5 py-0.5 rounded-lg text-sm font-extrabold">
                  {active.length} 进行中
                </span>
              )}
            </span>
            <span className="text-sm font-semibold opacity-90">{collapsed ? '展开' : '收起'}</span>
          </button>
          <button
            type="button"
            onClick={() => abortAndClearDmEmailSearchQueue()}
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
              <button
                type="button"
                onClick={() => abortAndClearDmEmailSearchQueue()}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-2 text-sm font-extrabold"
              >
                <Square size={14} fill="currentColor" />
                停止并清除全部
              </button>
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
                    <div className="text-sm font-bold text-slate-900 truncate">{job.companyName}</div>
                    <div className="text-xs font-medium text-slate-500 truncate">{job.domain}</div>
                    <div className={`text-xs font-bold mt-1 ${ui.tone}`}>
                      {ui.label}
                      {job.status === 'completed' && job.stats
                        ? (() => {
                            const upgraded = job.stats?.upgraded || 0;
                            const added = job.stats?.added || 0;
                            const verified = job.stats?.verified || 0;
                            if (upgraded + added + verified === 0) {
                              return ' · 本次无新增邮箱';
                            }
                            return ` · 新增${added} / 更新${upgraded} / 验证${verified}${
                              job.stats.reFoundAfterInvalid
                                ? ` / 无效重查${job.stats.reFoundAfterInvalid}`
                                : ''
                            }`;
                          })()
                        : ''}
                      {job.status === 'failed' && job.error ? ` · ${job.error.slice(0, 80)}` : ''}
                      {job.status === 'completed' && job.error ? ` · ${job.error.slice(0, 80)}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissDmEmailSearchJob(job.id)}
                    className="text-slate-400 hover:text-slate-700 p-0.5"
                    title="取消/关闭"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}
            {jobs.some((j) => j.status === 'completed' || j.status === 'failed') && (
              <button
                type="button"
                onClick={() => clearFinishedDmEmailSearchJobs()}
                className="w-full text-sm font-bold text-slate-600 hover:text-slate-800 py-2 rounded-xl border border-slate-200 bg-white"
              >
                清除已结束任务
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
