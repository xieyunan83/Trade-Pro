import React, { useEffect, useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Hourglass,
  X,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import {
  clearFinishedSiteBuildJobs,
  dismissSiteBuildJob,
  subscribeSiteBuildJobs,
  type SiteBuildJob,
} from '../services/siteBuildPipeline';

const statusUi = (job: SiteBuildJob) => {
  if (job.status === 'queued') {
    return { icon: <Hourglass size={14} className="text-amber-500" />, label: '排队中', tone: 'text-amber-700' };
  }
  if (job.status === 'running') {
    return {
      icon: <Loader2 size={14} className="animate-spin text-teal-600" />,
      label: '后台生成中',
      tone: 'text-teal-700',
    };
  }
  if (job.status === 'completed') {
    return { icon: <CheckCircle2 size={14} className="text-emerald-600" />, label: '已完成', tone: 'text-emerald-700' };
  }
  if (job.status === 'cancelled') {
    return { icon: <XCircle size={14} className="text-slate-400" />, label: '已取消', tone: 'text-slate-500' };
  }
  return { icon: <XCircle size={14} className="text-red-500" />, label: '失败', tone: 'text-red-600' };
};

export const SiteBuildPanel: React.FC = () => {
  const [jobs, setJobs] = useState<SiteBuildJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeSiteBuildJobs(setJobs), []);

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const recent = jobs.slice(0, 6);
  if (recent.length === 0) return null;

  return (
    <div className="w-full shadow-signal">
      <div className="rounded-2xl border border-teal-200/70 bg-white/90 backdrop-blur-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-teal-700 to-cyan-700 text-white"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <Sparkles size={16} />
            一键建站后台任务
            {active.length > 0 && (
              <span className="bg-white/20 px-2 py-0.5 rounded-lg text-[10px]">{active.length} 进行中</span>
            )}
          </span>
          <span className="text-[10px] font-semibold opacity-80">{collapsed ? '展开' : '收起'}</span>
        </button>

        {!collapsed && (
          <div className="max-h-80 overflow-y-auto p-3 space-y-2 bg-slate-50/90">
            {active.length > 0 ? (
              <p className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                任务在本客户端后台执行，请勿关闭或刷新页面；可继续使用其它功能。
              </p>
            ) : null}

            {recent.map((job) => {
              const ui = statusUi(job);
              return (
                <div
                  key={job.id}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 space-y-1.5"
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">{ui.icon}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-black text-slate-800 truncate">
                        {job.form.brandName || job.title || '未命名网站'}
                      </div>
                      <div className={`text-[10px] font-black mt-0.5 ${ui.tone}`}>
                        {ui.label}
                        {job.status === 'running' || job.status === 'queued'
                          ? ` · ${job.progressPct}%`
                          : null}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-snug line-clamp-2">
                        {job.error || job.statusText}
                      </p>
                      {(job.status === 'running' || job.status === 'queued') && (
                        <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-teal-500 transition-all duration-500"
                            style={{ width: `${Math.max(4, job.progressPct)}%` }}
                          />
                        </div>
                      )}
                      {job.status === 'running' || job.status === 'queued' ? (
                        <ul className="mt-1.5 space-y-0.5">
                          {job.steps
                            .filter((s) => s.status !== 'skipped')
                            .map((s) => (
                              <li
                                key={s.id}
                                className={`text-[9px] font-bold ${
                                  s.status === 'done'
                                    ? 'text-emerald-600'
                                    : s.status === 'running'
                                      ? 'text-teal-700'
                                      : s.status === 'failed'
                                        ? 'text-rose-600'
                                        : 'text-slate-400'
                                }`}
                              >
                                {s.status === 'done'
                                  ? '✓'
                                  : s.status === 'running'
                                    ? '…'
                                    : s.status === 'failed'
                                      ? '✕'
                                      : '○'}{' '}
                                {s.label}
                              </li>
                            ))}
                        </ul>
                      ) : null}
                      {job.status === 'completed' && job.projectId ? (
                        <button
                          type="button"
                          className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-black text-teal-700 hover:underline"
                          onClick={() => {
                            try {
                              window.location.hash = '#/module/site_builder';
                              window.setTimeout(() => {
                                window.dispatchEvent(
                                  new CustomEvent('tp-open-site-project', {
                                    detail: { projectId: job.projectId },
                                  })
                                );
                              }, 120);
                            } catch {
                              /* ignore */
                            }
                          }}
                        >
                          <ExternalLink size={11} /> 打开成品网站
                        </button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
                      title="移除"
                      onClick={() => dismissSiteBuildJob(job.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              );
            })}

            {jobs.some((j) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') ? (
              <button
                type="button"
                onClick={() => clearFinishedSiteBuildJobs()}
                className="w-full text-[10px] font-bold text-slate-500 hover:text-slate-700 py-1"
              >
                清除已结束任务
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
