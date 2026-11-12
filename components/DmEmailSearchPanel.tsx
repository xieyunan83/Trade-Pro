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
    return {
      icon: <Hourglass size={14} className="text-amber-600" />,
      label: '排队中',
      tone: 'text-amber-800 bg-amber-50 border-amber-200/80',
    };
  }
  if (job.status === 'running') {
    return {
      icon: <Loader2 size={14} className="animate-spin text-teal-700" />,
      label: '搜索中',
      tone: 'text-teal-800 bg-teal-50 border-teal-200/80',
    };
  }
  if (job.status === 'completed') {
    return {
      icon: <CheckCircle2 size={14} className="text-emerald-700" />,
      label: '已完成',
      tone: 'text-emerald-800 bg-emerald-50 border-emerald-200/80',
    };
  }
  return {
    icon: <XCircle size={14} className="text-rose-600" />,
    label: '失败',
    tone: 'text-rose-800 bg-rose-50 border-rose-200/80',
  };
};

const resultLine = (job: DmEmailSearchJob): string => {
  if (job.status === 'failed' && job.error) return job.error.slice(0, 80);
  if (job.status === 'completed' && job.error) return job.error.slice(0, 80);
  if (job.status !== 'completed' || !job.stats) return '';
  const upgraded = job.stats.upgraded || 0;
  const added = job.stats.added || 0;
  const verified = job.stats.verified || 0;
  const credits = Number(job.stats.creditsCharged || 0);
  const creditBit =
    credits > 0 ? ` · 扣 ${Number.isInteger(credits) ? credits : credits.toFixed(1)} 分` : ' · 未扣分';
  if (upgraded + added + verified === 0) {
    return `本次无新增邮箱${creditBit}`;
  }
  return `新增 ${added} · 更新 ${upgraded} · 验证 ${verified}${
    job.stats.reFoundAfterInvalid ? ` · 无效重查 ${job.stats.reFoundAfterInvalid}` : ''
  }${creditBit}`;
};

/** 左下角：决策人邮箱后台任务（仅改 UI，不改队列逻辑） */
export const DmEmailSearchPanel: React.FC = () => {
  const [jobs, setJobs] = useState<DmEmailSearchJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeDmEmailSearchJobs(setJobs), []);

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const recent = jobs.slice(0, 8);
  if (recent.length === 0) return null;

  const running = jobs.some((j) => j.status === 'running');
  const finished = jobs.some((j) => j.status === 'completed' || j.status === 'failed');

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-teal-200/60 bg-white overflow-hidden shadow-[0_18px_40px_-24px_rgba(15,23,42,0.45),0_0_0_1px_rgba(20,184,166,0.06)]">
        <div className="flex items-center gap-2 px-3 py-2.5 bg-[linear-gradient(118deg,#0b1420_0%,#0c1c24_55%,#0a2422_100%)] text-white">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex-1 min-w-0 flex items-center gap-2 text-left"
          >
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-400/15 border border-teal-300/25 text-teal-200">
              <Users size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold tracking-tight truncate">决策人邮箱任务</span>
              <span className="block text-[10px] font-medium text-slate-400 truncate">
                {running ? '正在搜索' : active.length ? `${active.length} 项排队` : '近期任务'}
              </span>
            </span>
            {active.length > 0 && (
              <span className="shrink-0 rounded-md bg-teal-400/15 border border-teal-300/30 px-1.5 py-0.5 text-[10px] font-bold text-teal-100 tabular-nums">
                {active.length}
              </span>
            )}
            <span className="shrink-0 text-[10px] font-semibold text-slate-400">
              {collapsed ? '展开' : '收起'}
            </span>
          </button>
          {active.length > 0 && (
            <button
              type="button"
              onClick={() => abortAndClearDmEmailSearchQueue()}
              className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 hover:bg-rose-500/20 hover:border-rose-300/40 px-2 py-1.5 text-[10px] font-bold text-slate-200"
              title="停止并清除全部"
            >
              <Square size={11} fill="currentColor" />
              停止
            </button>
          )}
        </div>

        {!collapsed && (
          <div className="max-h-72 overflow-y-auto p-2.5 space-y-2 bg-slate-50/90">
            {recent.map((job) => {
              const ui = statusUi(job);
              const detail = resultLine(job);
              return (
                <div
                  key={job.id}
                  className="rounded-xl border border-slate-200/90 bg-white px-2.5 py-2 flex items-start gap-2"
                >
                  <div className="mt-0.5 shrink-0">{ui.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">{job.companyName}</div>
                        <div className="text-[10px] font-medium text-slate-500 truncate mt-0.5">
                          {job.domain}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${ui.tone}`}
                      >
                        {ui.label}
                      </span>
                    </div>
                    {detail ? (
                      <p className="text-[10px] font-medium text-slate-500 mt-1 leading-snug line-clamp-2">
                        {detail}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissDmEmailSearchJob(job.id)}
                    className="shrink-0 text-slate-300 hover:text-slate-600 p-0.5 mt-0.5"
                    title="关闭此项"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}

            <div className="flex items-center gap-2 pt-0.5">
              {active.length > 0 && (
                <button
                  type="button"
                  onClick={() => abortAndClearDmEmailSearchQueue()}
                  className="flex-1 text-[10px] font-bold text-rose-700 hover:text-rose-900 py-1.5 rounded-lg border border-rose-200/80 bg-rose-50/80"
                >
                  停止并清除全部
                </button>
              )}
              {finished && (
                <button
                  type="button"
                  onClick={() => clearFinishedDmEmailSearchJobs()}
                  className="flex-1 text-[10px] font-bold text-slate-600 hover:text-slate-800 py-1.5 rounded-lg border border-slate-200 bg-white"
                >
                  清除已结束
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
