import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Hourglass, X, Users } from 'lucide-react';
import {
  clearFinishedDmEmailSearchJobs,
  dismissDmEmailSearchJob,
  subscribeDmEmailSearchJobs,
  type DmEmailSearchJob,
} from '../services/dmEmailSearchQueue';

const statusUi = (job: DmEmailSearchJob) => {
  if (job.status === 'queued') {
    return { icon: <Hourglass size={14} className="text-amber-500" />, label: '排队中', tone: 'text-amber-700' };
  }
  if (job.status === 'running') {
    return {
      icon: <Loader2 size={14} className="animate-spin text-cyan-600" />,
      label: '搜索中',
      tone: 'text-cyan-700',
    };
  }
  if (job.status === 'completed') {
    return { icon: <CheckCircle2 size={14} className="text-emerald-600" />, label: '已完成', tone: 'text-emerald-700' };
  }
  return { icon: <XCircle size={14} className="text-red-500" />, label: '失败', tone: 'text-red-600' };
};

export const DmEmailSearchPanel: React.FC = () => {
  const [jobs, setJobs] = useState<DmEmailSearchJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeDmEmailSearchJobs(setJobs), []);

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const recent = jobs.slice(0, 8);
  if (recent.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[min(100vw-2rem,22rem)] shadow-signal">
      <div className="rounded-2xl border border-cyan-200/70 bg-white/90 backdrop-blur-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-cyan-600 to-sky-600 text-white"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <Users size={16} />
            决策人邮箱后台任务
            {active.length > 0 && (
              <span className="bg-white/20 px-2 py-0.5 rounded-lg text-[10px]">{active.length} 进行中</span>
            )}
          </span>
          <span className="text-[10px] font-semibold opacity-80">{collapsed ? '展开' : '收起'}</span>
        </button>

        {!collapsed && (
          <div className="max-h-72 overflow-y-auto p-3 space-y-2 bg-slate-50/90">
            {recent.map((job) => {
              const ui = statusUi(job);
              return (
                <div
                  key={job.id}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 flex items-start gap-2"
                >
                  <div className="mt-0.5">{ui.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-black text-slate-800 truncate">{job.companyName}</div>
                    <div className="text-[10px] font-bold text-slate-400 truncate">{job.domain}</div>
                    <div className={`text-[10px] font-black mt-1 ${ui.tone}`}>
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
                      {job.status === 'failed' && job.error ? ` · ${job.error.slice(0, 60)}` : ''}
                    </div>
                  </div>
                  {(job.status === 'completed' || job.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => dismissDmEmailSearchJob(job.id)}
                      className="text-slate-300 hover:text-slate-500 p-0.5"
                      title="关闭"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              );
            })}
            {jobs.some((j) => j.status === 'completed' || j.status === 'failed') && (
              <button
                type="button"
                onClick={() => clearFinishedDmEmailSearchJobs()}
                className="w-full text-[11px] font-black text-slate-500 hover:text-slate-700 py-1"
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
