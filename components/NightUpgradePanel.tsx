import React, { useEffect, useState } from 'react';
import { Moon, Loader2, Square } from 'lucide-react';
import {
  abortAndClearNightUpgrade,
  getNightUpgradeStatus,
  setNightSilentUpgradeEnabled,
  subscribeNightUpgrade,
  type NightUpgradeStatus,
} from '../services/nightSilentUpgrade';
import { stopAllBackgroundWork } from '../services/stopAllBackgroundWork';

/** 左下角弱提示：仅夜间有任务时显示，不打断操作 */
export const NightUpgradePanel: React.FC = () => {
  const [status, setStatus] = useState<NightUpgradeStatus>(() => getNightUpgradeStatus());

  useEffect(() => subscribeNightUpgrade(setStatus), []);

  if (!status.enabled) return null;
  const busy =
    status.inWindow && (status.queued > 0 || status.running > 0 || status.completedTonight > 0);
  if (!busy && !status.inWindow) return null;
  if (!status.inWindow && status.completedTonight === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-900/95 text-slate-100 shadow-xl overflow-hidden">
      <div className="px-3 py-2.5 flex items-start gap-2">
        <Moon size={16} className="text-indigo-300 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black truncate">
            {status.inWindow ? '夜间静默补全中' : '昨夜静默补全'}
          </div>
          <div className="text-xs font-semibold text-slate-400 mt-0.5 leading-snug">
            {status.inWindow
              ? `待补 ${status.queued} · 完成 ${status.completedTonight}${
                  status.failedTonight ? ` · 失败 ${status.failedTonight}` : ''
                }`
              : `完成 ${status.completedTonight} 家旧客户补齐`}
            {status.current
              ? ` · ${status.current.clientName}${
                  status.current.kind === 'linkedin_locate'
                    ? '（联系人）'
                    : status.current.kind === 'catalog_match'
                      ? '（品类匹配）'
                      : ''
                }`
              : ''}
          </div>
          {status.running > 0 && (
            <div className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-200 font-bold">
              <Loader2 size={12} className="animate-spin" /> 后台补全中，可继续操作
            </div>
          )}
          {status.inWindow && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-1.5 text-xs font-extrabold"
                onClick={() => {
                  stopAllBackgroundWork();
                  abortAndClearNightUpgrade();
                }}
                title="停止挂机补全及所有子任务"
              >
                <Square size={12} fill="currentColor" />
                停止全部
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-600 text-slate-300 hover:text-white px-2.5 py-1.5 text-xs font-bold"
                onClick={() => setNightSilentUpgradeEnabled(false)}
                title="今晚暂停（不清空其它队列）"
              >
                仅暂停挂机
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
