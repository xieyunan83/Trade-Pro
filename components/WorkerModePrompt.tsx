import React, { useEffect, useState } from 'react';
import { Cpu, Moon, Sun, X } from 'lucide-react';
import {
  describeWorkerSchedule,
  getWorkerModeStatus,
  subscribeWorkerMode,
  type WorkerModeStatus,
} from '../services/workerMode';

type Props = {
  open: boolean;
  onConfirm: () => void;
  onDecline: () => void;
};

/** admin 进入业务页时：确认是否本机挂机执行 */
export const WorkerModePrompt: React.FC<Props> = ({ open, onConfirm, onDecline }) => {
  const [status, setStatus] = useState<WorkerModeStatus>(() => getWorkerModeStatus());
  useEffect(() => subscribeWorkerMode(setStatus), []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          <div className="rounded-xl bg-indigo-50 text-indigo-700 p-2.5 shrink-0">
            <Cpu size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-black text-slate-900">
              {status.active ? '继续本机挂机执行？' : '本机挂机执行任务？'}
            </h2>
            <p className="text-[12px] text-slate-600 mt-1.5 leading-relaxed font-medium">
              {status.active
                ? '本机此前已开启挂机。确认后继续按日程跑队列；选「否」将停止本机自动作业。'
                : '管理员进入业务工作台。确认后，本机会按日程自动跑队列（其它电脑可只浏览业务）。'}
            </p>
          </div>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 p-1"
            onClick={onDecline}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 space-y-2.5">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 flex gap-2.5">
            <Moon size={14} className="text-indigo-500 mt-0.5 shrink-0" />
            <div className="text-[11px] text-slate-700 leading-snug">
              <span className="font-black">夜间 22:00–08:00</span>
              ：全量背调并行（当前可用 Key {status.qwenKeyCount} 把 → 并行最多{' '}
              {Math.min(2, Math.max(1, status.qwenKeyCount || 1))} 路）+ 联系人等重补全
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 flex gap-2.5">
            <Sun size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <div className="text-[11px] text-slate-700 leading-snug">
              <span className="font-black">白天</span>
              ：仅轻量补全（品类匹配、邮箱入队等），不抢优惠时段算力
            </div>
          </div>
        </div>

        <div className="px-5 py-4 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onDecline}
            className="px-3.5 py-2 rounded-xl text-[12px] font-bold text-slate-600 hover:bg-slate-100"
          >
            否，仅浏览业务
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3.5 py-2 rounded-xl text-[12px] font-black text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm"
          >
            {status.active ? '是，继续挂机' : '是，开始挂机执行'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** 左下角弱提示：挂机进行中 */
export const WorkerModeBadge: React.FC<{ onStop?: () => void }> = ({ onStop }) => {
  const [status, setStatus] = useState<WorkerModeStatus>(() => getWorkerModeStatus());
  useEffect(() => subscribeWorkerMode(setStatus), []);
  if (!status.active) return null;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-950/95 text-indigo-50 shadow-xl overflow-hidden">
      <div className="px-3 py-2 flex items-start gap-2">
        <Cpu size={14} className="text-indigo-300 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black truncate">挂机执行中</div>
          <div className="text-[10px] font-semibold text-indigo-200/90 mt-0.5 leading-snug">
            {describeWorkerSchedule()}
          </div>
        </div>
        {onStop && (
          <button
            type="button"
            className="text-[9px] font-bold text-indigo-300 hover:text-white shrink-0"
            onClick={onStop}
            title="停止本机挂机"
          >
            停止
          </button>
        )}
      </div>
    </div>
  );
};
